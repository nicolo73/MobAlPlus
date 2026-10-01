-- MobAlPlus : fonctions de lecture, d'ingestion et de maintenance

-- Début (UTC) d'un jour de reading_day
CREATE OR REPLACE FUNCTION day_start(d date) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT (d::timestamp AT TIME ZONE 'UTC') $$;

CREATE OR REPLACE FUNCTION setting_int(p_key text) RETURNS int
LANGUAGE sql STABLE AS $$ SELECT (value #>> '{}')::int FROM app_setting WHERE key = p_key $$;

-- Devine la grandeur à partir du libellé de colonne Mobile Alerts
CREATE OR REPLACE FUNCTION guess_property(label text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN l LIKE '%temp%' THEN 'temperature'
    WHEN l LIKE '%hygro%' OR l LIKE '%humid%' OR l LIKE '%feucht%' THEN 'humidity'
    WHEN l LIKE '%pluie%' OR l LIKE '%rain%' OR l LIKE '%regen%' THEN 'rain'
    ELSE 'unknown' END
  FROM (SELECT translate(lower(coalesce(label, '')), 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc') AS l) x
$$;

-- ---------------------------------------------------------------------------
-- Lecture
-- ---------------------------------------------------------------------------

-- Mesures brutes d'un canal sur [p_from, p_to[, tous niveaux de stockage confondus
CREATE OR REPLACE FUNCTION channel_readings(p_channel int, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (ts timestamptz, value real)
LANGUAGE sql STABLE AS $$
  SELECT r.ts, r.value FROM reading r
  WHERE r.channel_id = p_channel AND r.ts >= p_from AND r.ts < p_to
  UNION ALL
  SELECT x.ts, x.value
  FROM reading_day d
  CROSS JOIN LATERAL (
    SELECT day_start(d.day) + make_interval(secs => u.t) AS ts, u.v AS value
    FROM unnest(d.t, d.v) AS u(t, v)
  ) x
  WHERE d.channel_id = p_channel
    AND d.day BETWEEN (p_from AT TIME ZONE 'UTC')::date AND (p_to AT TIME ZONE 'UTC')::date
    AND x.ts >= p_from AND x.ts < p_to
$$;

-- Observations d'une série : mesures des canaux affectés à la série, corrections appliquées
CREATE OR REPLACE FUNCTION series_observations(p_series int, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (ts timestamptz, value real, quality text, channel_id int, raw_value real)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (r.ts)
         r.ts,
         CASE WHEN c.action = 'replace' THEN c.value ELSE r.value END,
         CASE WHEN c.action = 'reject'  THEN 'rejected'
              WHEN c.action = 'replace' THEN 'corrected'
              ELSE 'ok' END,
         dep.channel_id,
         r.value
  FROM deployment dep
  CROSS JOIN LATERAL channel_readings(
    dep.channel_id,
    greatest(p_from, coalesce(lower(dep.valid), '-infinity')),
    least(p_to, coalesce(upper(dep.valid), 'infinity'))) r
  LEFT JOIN LATERAL (
    SELECT c.action, c.value FROM correction c
    WHERE c.channel_id = dep.channel_id AND c.ts_range @> r.ts
    ORDER BY c.created_at DESC LIMIT 1
  ) c ON true
  WHERE dep.series_id = p_series AND dep.valid && tstzrange(p_from, p_to)
  ORDER BY r.ts
$$;

-- Données d'affichage d'une série. Au-delà de p_max_points, on ne renvoie que de vrais points :
-- le minimum et le maximum de chaque intervalle (les pics sont toujours visibles).
CREATE OR REPLACE FUNCTION series_data(p_series int, p_from timestamptz, p_to timestamptz,
                                       p_max_points int DEFAULT 2000)
RETURNS TABLE (ts timestamptz, value real, quality text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM series_observations(p_series, p_from, p_to);
  IF n <= p_max_points THEN
    RETURN QUERY SELECT o.ts, o.value, o.quality FROM series_observations(p_series, p_from, p_to) o;
    RETURN;
  END IF;
  RETURN QUERY
  WITH o AS (
    SELECT o.ts, o.value, o.quality,
           width_bucket(extract(epoch FROM o.ts), extract(epoch FROM p_from), extract(epoch FROM p_to),
                        greatest(p_max_points / 2, 1)) AS bk
    FROM series_observations(p_series, p_from, p_to) o
    WHERE o.quality <> 'rejected'
  ), ranked AS (
    SELECT o.*, row_number() OVER (PARTITION BY bk ORDER BY o.value, o.ts) AS rmin,
                row_number() OVER (PARTITION BY bk ORDER BY o.value DESC, o.ts) AS rmax
    FROM o
  )
  SELECT r.ts, r.value, r.quality FROM ranked r WHERE r.rmin = 1 OR r.rmax = 1 ORDER BY r.ts;
END $$;

-- Vues « tout l'historique » (requêtes ponctuelles, future API SensorThings)
CREATE OR REPLACE VIEW reading_all AS
SELECT channel_id, ts, value FROM reading
UNION ALL
SELECT d.channel_id, day_start(d.day) + make_interval(secs => u.t), u.v
FROM reading_day d, unnest(d.t, d.v) AS u(t, v);

CREATE OR REPLACE VIEW observation AS
SELECT d.series_id, r.ts,
       CASE WHEN c.action = 'replace' THEN c.value ELSE r.value END AS value,
       CASE WHEN c.action = 'reject' THEN 'rejected' WHEN c.action = 'replace' THEN 'corrected'
            ELSE 'ok' END AS quality,
       r.channel_id, r.value AS raw_value
FROM reading_all r
JOIN deployment d ON d.channel_id = r.channel_id AND d.valid @> r.ts
LEFT JOIN LATERAL (
  SELECT c.action, c.value FROM correction c
  WHERE c.channel_id = r.channel_id AND c.ts_range @> r.ts
  ORDER BY c.created_at DESC LIMIT 1
) c ON true;

-- ---------------------------------------------------------------------------
-- Ingestion (appelée par le collecteur)
-- ---------------------------------------------------------------------------

-- Crée les canaux manquants d'un capteur à partir des libellés de colonnes
CREATE OR REPLACE FUNCTION ensure_channels(p_device int, p_width int, p_headers text[])
RETURNS void LANGUAGE sql AS $$
  INSERT INTO device_channel (device_id, channel_no, property_id, label)
  SELECT p_device, i, op.id, p_headers[i]
  FROM generate_series(1, p_width) i
  JOIN observed_property op ON op.code = guess_property(p_headers[i])
  ON CONFLICT (device_id, channel_no) DO UPDATE
    SET label = coalesce(device_channel.label, EXCLUDED.label)
$$;

-- Capteurs à collecter et date à partir de laquelle collecter.
-- Par défaut : depuis la dernière mesure reçue, ou au plus 2 h avant la fin de la dernière période
-- interrogée (pour franchir les périodes sans mesure), sans remonter au-delà des 90 jours du site.
-- p_lookback (ex. '3 days') force une relecture, pour rattraper des mesures transmises en retard.
-- Les capteurs collectés le moins récemment passent en premier.
CREATE OR REPLACE FUNCTION collect_targets(p_lookback interval DEFAULT NULL)
RETURNS TABLE (ma_id text, since timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT d.ma_id,
         CASE WHEN p_lookback IS NOT NULL THEN now() - p_lookback
         ELSE greatest(coalesce(s.last_ts, '-infinity'),
                       coalesce(s.synced_until - interval '2 hours', '-infinity'),
                       coalesce((SELECT max(r.ts) FROM reading r JOIN device_channel c ON c.id = r.channel_id
                                 WHERE c.device_id = d.id), '-infinity'),
                       now() - interval '90 days') END
  FROM device d LEFT JOIN device_sync s ON s.device_id = d.id
  WHERE d.active
  ORDER BY s.last_run NULLS FIRST, d.ma_id
$$;

-- p_rows : [{"ts": "2026-10-01T10:00:00Z", "v": [21.4, 55, null, ...]}, ...]  (v[i] = canal i+1)
CREATE OR REPLACE FUNCTION ingest_readings(p_ma_id text, p_device_name text, p_headers text[],
                                           p_rows jsonb, p_run_at timestamptz DEFAULT now(),
                                           p_synced_until timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_device int;
  v_width int;
  v_inserted int := 0;
  v_received int := jsonb_array_length(coalesce(p_rows, '[]'));
  v_last timestamptz;
BEGIN
  SELECT id INTO v_device FROM device WHERE ma_id = upper(p_ma_id);
  IF v_device IS NULL THEN
    RAISE EXCEPTION 'Capteur inconnu : %', p_ma_id;
  END IF;

  IF v_received > 0 THEN
    SELECT max(jsonb_array_length(r -> 'v')), max((r ->> 'ts')::timestamptz)
      INTO v_width, v_last FROM jsonb_array_elements(p_rows) r;
    PERFORM ensure_channels(v_device, v_width, p_headers);

    INSERT INTO reading (channel_id, ts, value)
    SELECT c.id, (r ->> 'ts')::timestamptz, (r -> 'v' ->> (c.channel_no - 1))::real
    FROM jsonb_array_elements(p_rows) r
    JOIN device_channel c ON c.device_id = v_device
    WHERE (r -> 'v' ->> (c.channel_no - 1)) IS NOT NULL
    ON CONFLICT (channel_id, ts) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  IF p_device_name IS NOT NULL THEN
    UPDATE device SET ma_name = p_device_name WHERE id = v_device;
  END IF;

  INSERT INTO device_sync (device_id, last_ts, synced_until, last_run, status, message, nb_imported)
  VALUES (v_device, v_last, p_synced_until, p_run_at, CASE WHEN v_received > 0 THEN 'OK' ELSE 'NO_DATA' END,
          format('%s mesures reçues, %s valeurs insérées', v_received, v_inserted), v_inserted)
  ON CONFLICT (device_id) DO UPDATE SET
    last_ts = greatest(device_sync.last_ts, EXCLUDED.last_ts),
    synced_until = greatest(device_sync.synced_until, EXCLUDED.synced_until),
    last_run = EXCLUDED.last_run,
    status = EXCLUDED.status, message = EXCLUDED.message, nb_imported = EXCLUDED.nb_imported;

  RETURN jsonb_build_object('received', v_received, 'inserted', v_inserted, 'last_ts', v_last);
END $$;

CREATE OR REPLACE FUNCTION record_sync_error(p_ma_id text, p_message text, p_run_at timestamptz DEFAULT now())
RETURNS void LANGUAGE sql AS $$
  INSERT INTO device_sync (device_id, last_run, status, message, nb_imported)
  SELECT id, p_run_at, 'ERROR', left(p_message, 500), 0 FROM device WHERE ma_id = upper(p_ma_id)
  ON CONFLICT (device_id) DO UPDATE SET
    last_run = EXCLUDED.last_run, status = 'ERROR', message = EXCLUDED.message, nb_imported = 0
$$;

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------

-- Niveau 1 -> 2 : déplace les mesures antérieures à p_before (par défaut : hot_days) dans reading_day,
-- sans perte. Fusionne avec les jours déjà compactés (imports tardifs). Renvoie le nombre de valeurs déplacées.
CREATE OR REPLACE FUNCTION compact_readings(p_before timestamptz DEFAULT NULL)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_before timestamptz;
  v_moved int;
BEGIN
  v_before := day_start(((coalesce(p_before, now() - make_interval(days => setting_int('hot_days'))))
                         AT TIME ZONE 'UTC')::date);
  WITH moved AS (
    DELETE FROM reading WHERE ts < v_before RETURNING channel_id, ts, value
  ), keys AS (
    SELECT DISTINCT channel_id, (ts AT TIME ZONE 'UTC')::date AS day FROM moved
  ), merged AS (
    SELECT channel_id, (ts AT TIME ZONE 'UTC')::date AS day, ts, value FROM moved
    UNION ALL
    SELECT d.channel_id, d.day, day_start(d.day) + make_interval(secs => u.t), u.v
    FROM reading_day d JOIN keys k USING (channel_id, day), unnest(d.t, d.v) AS u(t, v)
  ), agg AS (
    SELECT channel_id, day,
           array_agg(extract(epoch FROM ts - day_start(day))::int ORDER BY ts) AS t,
           array_agg(value ORDER BY ts) AS v
    FROM (SELECT DISTINCT ON (channel_id, ts) * FROM merged ORDER BY channel_id, ts) m
    GROUP BY channel_id, day
  ), ins AS (
    INSERT INTO reading_day (channel_id, day, t, v, n_raw, simplified)
    SELECT channel_id, day, t, v, cardinality(t), false FROM agg
    ON CONFLICT (channel_id, day) DO UPDATE
      SET t = EXCLUDED.t, v = EXCLUDED.v, n_raw = EXCLUDED.n_raw, simplified = false
    RETURNING 1
  )
  SELECT count(*) INTO v_moved FROM moved;
  RETURN v_moved;
END $$;

-- Points significatifs d'une courbe : premier, dernier, minimum, maximum, et points de rupture
-- (Douglas-Peucker sur l'écart vertical : un point est supprimé s'il est à moins de p_tol de la droite
-- reliant les points conservés qui l'encadrent).
CREATE OR REPLACE FUNCTION simplify_points(p_t int[], p_v real[], p_tol real,
                                           OUT t int[], OUT v real[])
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n int := coalesce(cardinality(p_t), 0);
  keep boolean[];
  starts int[];
  ends int[];
  s int; e int; i int; idx int;
  dmax double precision; d double precision; expected double precision;
  imin int := 1; imax int := 1;
BEGIN
  IF n <= 2 OR p_tol IS NULL THEN
    t := p_t; v := p_v; RETURN;
  END IF;
  keep := array_fill(false, ARRAY[n]);
  keep[1] := true; keep[n] := true;
  FOR i IN 2..n LOOP
    IF p_v[i] < p_v[imin] THEN imin := i; END IF;
    IF p_v[i] > p_v[imax] THEN imax := i; END IF;
  END LOOP;
  keep[imin] := true; keep[imax] := true;

  starts := ARRAY[1]; ends := ARRAY[n];
  WHILE cardinality(starts) > 0 LOOP
    s := starts[cardinality(starts)]; e := ends[cardinality(ends)];
    starts := starts[1:cardinality(starts) - 1]; ends := ends[1:cardinality(ends) - 1];
    CONTINUE WHEN e - s < 2;
    dmax := -1; idx := 0;
    FOR i IN s + 1 .. e - 1 LOOP
      IF p_t[e] = p_t[s] THEN
        expected := p_v[s];
      ELSE
        expected := p_v[s] + (p_v[e] - p_v[s]) * (p_t[i] - p_t[s])::double precision / (p_t[e] - p_t[s]);
      END IF;
      d := abs(p_v[i] - expected);
      IF d > dmax THEN dmax := d; idx := i; END IF;
    END LOOP;
    IF dmax > p_tol THEN
      keep[idx] := true;
      starts := starts || ARRAY[s, idx];
      ends := ends || ARRAY[idx, e];
    END IF;
  END LOOP;

  SELECT array_agg(p_t[k] ORDER BY k), array_agg(p_v[k] ORDER BY k)
    INTO t, v FROM generate_subscripts(p_t, 1) k WHERE keep[k];
END $$;

-- Niveau 2 -> 3 : au-delà de simplify_after_days, ne garde que les points significatifs.
-- Les valeurs rejetées (corrections) sont d'abord écartées pour ne pas fausser les extrêmes.
CREATE OR REPLACE FUNCTION simplify_old(p_before date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_before date := coalesce(p_before, current_date - setting_int('simplify_after_days'));
  rec record;
  ft int[]; fv real[];
  s record;
  v_days int := 0; v_before_pts bigint := 0; v_after_pts bigint := 0;
BEGIN
  FOR rec IN
    SELECT d.channel_id, d.day, d.t, d.v, op.simplify_tolerance AS tol
    FROM reading_day d
    JOIN device_channel c ON c.id = d.channel_id
    JOIN observed_property op ON op.id = c.property_id
    WHERE NOT d.simplified AND d.day < v_before
  LOOP
    SELECT coalesce(array_agg(u.t ORDER BY u.o), '{}'), coalesce(array_agg(u.v ORDER BY u.o), '{}')
      INTO ft, fv
    FROM unnest(rec.t, rec.v) WITH ORDINALITY AS u(t, v, o)
    WHERE NOT EXISTS (
      SELECT 1 FROM correction c
      WHERE c.channel_id = rec.channel_id AND c.action = 'reject'
        AND c.ts_range @> (day_start(rec.day) + make_interval(secs => u.t)));
    s := simplify_points(ft, fv, rec.tol);
    UPDATE reading_day SET t = coalesce(s.t, '{}'), v = coalesce(s.v, '{}'), simplified = true
    WHERE channel_id = rec.channel_id AND day = rec.day;
    v_days := v_days + 1;
    v_before_pts := v_before_pts + cardinality(rec.t);
    v_after_pts := v_after_pts + coalesce(cardinality(s.t), 0);
  END LOOP;
  RETURN jsonb_build_object('days', v_days, 'points_before', v_before_pts, 'points_after', v_after_pts);
END $$;

-- Tâche de nuit : compactage puis simplification
CREATE OR REPLACE FUNCTION run_maintenance() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := jsonb_build_object('compacted', compact_readings(), 'simplified', simplify_old());
  INSERT INTO maintenance_log (task, details) VALUES ('maintenance', v_result);
  RETURN v_result;
END $$;

-- ---------------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION stats() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH per_channel AS (
    SELECT channel_id, count(*) AS n, min(ts) AS first_ts, max(ts) AS last_ts
    FROM reading GROUP BY channel_id
    UNION ALL
    SELECT channel_id, sum(cardinality(t)), day_start(min(day)), day_start(max(day)) + interval '1 day'
    FROM reading_day GROUP BY channel_id
  ), per_device AS (
    SELECT c.device_id, count(DISTINCT c.id) AS channels, coalesce(sum(p.n), 0) AS n,
           min(p.first_ts) AS first_ts
    FROM device_channel c LEFT JOIN per_channel p ON p.channel_id = c.id
    GROUP BY c.device_id
  )
  SELECT jsonb_build_object(
    'db_size_bytes', pg_database_size(current_database()),
    'tables', (SELECT jsonb_object_agg(relname, pg_total_relation_size(oid))
               FROM pg_class WHERE relname IN ('reading', 'reading_day', 'correction', 'annotation')
                 AND relnamespace = 'public'::regnamespace),
    'counts', jsonb_build_object(
      'devices', (SELECT count(*) FROM device),
      'active_devices', (SELECT count(*) FROM device WHERE active),
      'channels', (SELECT count(*) FROM device_channel),
      'places', (SELECT count(*) FROM place),
      'series', (SELECT count(*) FROM series),
      'active_deployments', (SELECT count(*) FROM deployment WHERE upper_inf(valid)),
      'corrections', (SELECT count(*) FROM correction),
      'annotations', (SELECT count(*) FROM annotation)),
    'values', jsonb_build_object(
      'recent', (SELECT count(*) FROM reading),
      'compacted', (SELECT coalesce(sum(cardinality(t)), 0) FROM reading_day WHERE NOT simplified),
      'simplified', (SELECT coalesce(sum(cardinality(t)), 0) FROM reading_day WHERE simplified),
      'simplified_raw', (SELECT coalesce(sum(n_raw), 0) FROM reading_day WHERE simplified)),
    'devices', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'ma_id', d.ma_id, 'name', coalesce(d.name, d.ma_name), 'active', d.active,
        'channels', pd.channels, 'values', pd.n, 'first_ts', pd.first_ts,
        'last_ts', s.last_ts, 'last_run', s.last_run, 'status', s.status, 'message', s.message)
        ORDER BY d.ma_id), '[]')
      FROM device d LEFT JOIN per_device pd ON pd.device_id = d.id
      LEFT JOIN device_sync s ON s.device_id = d.id),
    'last_maintenance', (SELECT to_jsonb(m) FROM maintenance_log m ORDER BY run_at DESC LIMIT 1),
    'settings', (SELECT jsonb_object_agg(key, value) FROM app_setting)
  )
$$;
