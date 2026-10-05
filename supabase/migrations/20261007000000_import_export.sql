-- MobAlPlus : export CSV et import depuis l'application
--
-- Format MobAlPlus (une ligne par mesure, identique à l'export et à l'import) :
--   date;emplacement;grandeur;valeur;unite;qualite;capteur;canal
--   2026-10-05T14:10:00+02:00;Salon;temperature;21,4;°C;ok;07XXXXXXXXXX;1
-- La date porte toujours son fuseau (décalage +02:00, ou Z pour UTC) : elle est sans ambiguïté.

-- ---------------------------------------------------------------------------
-- Compactage limité à certains canaux (utilisé après un import)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION compact_channel_readings(p_channels int[], p_before timestamptz DEFAULT NULL)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_before timestamptz;
  v_moved int;
BEGIN
  v_before := day_start(((coalesce(p_before, now() - make_interval(days => setting_int('hot_days'))))
                         AT TIME ZONE 'UTC')::date);
  WITH moved AS (
    DELETE FROM reading
    WHERE ts < v_before AND (p_channels IS NULL OR channel_id = ANY (p_channels))
    RETURNING channel_id, ts, value
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

-- La maintenance de nuit utilise la même logique, sur tous les canaux
CREATE OR REPLACE FUNCTION compact_readings(p_before timestamptz DEFAULT NULL)
RETURNS int LANGUAGE sql AS $$ SELECT compact_channel_readings(NULL, p_before) $$;

-- Étend vers le passé la première affectation d'un canal, quand des mesures plus anciennes sont
-- importées (sinon elles ne seraient rattachées à aucun emplacement). Sans empiéter sur une
-- affectation antérieure de la même série (capteur remplacé). Renvoie 1 si étendue.
CREATE OR REPLACE FUNCTION extend_first_deployment(p_channel int, p_before timestamptz)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_dep record;
  v_floor timestamptz;
BEGIN
  SELECT id, series_id, lower(valid) AS lo, upper(valid) AS hi INTO v_dep
  FROM deployment WHERE channel_id = p_channel ORDER BY lower(valid) NULLS FIRST LIMIT 1;
  IF v_dep.id IS NULL OR v_dep.lo IS NULL OR p_before >= v_dep.lo THEN
    RETURN 0;
  END IF;
  SELECT max(upper(valid)) INTO v_floor FROM deployment
  WHERE series_id = v_dep.series_id AND id <> v_dep.id AND upper(valid) <= v_dep.lo;
  UPDATE deployment SET valid = tstzrange(v_floor, v_dep.hi, '[)') WHERE id = v_dep.id;
  RETURN 1;
END $$;

-- ---------------------------------------------------------------------------
-- Export
-- ---------------------------------------------------------------------------

-- Horodatage ISO 8601 dans le fuseau demandé, avec son décalage (« Z » en UTC)
CREATE OR REPLACE FUNCTION fmt_ts(p_ts timestamptz, p_tz text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_tz IN ('UTC', 'Z') THEN to_char(p_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ELSE to_char(p_ts AT TIME ZONE p_tz, 'YYYY-MM-DD"T"HH24:MI:SS')
       || CASE WHEN off < interval '0' THEN '-' ELSE '+' END
       || to_char(CASE WHEN off < interval '0' THEN -off ELSE off END, 'HH24:MI') END
  FROM (SELECT (p_ts AT TIME ZONE p_tz) - (p_ts AT TIME ZONE 'UTC') AS off) x
$$;

CREATE OR REPLACE FUNCTION csv_field(p text, p_sep text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~ ('[' || p_sep || '"\n\r]') THEN '"' || replace(p, '"', '""') || '"' ELSE p END
$$;

-- Lignes CSV (sans en-tête) des séries demandées sur [p_from, p_to[, dans l'ordre chronologique.
-- Renvoie un seul texte : l'application découpe les longues périodes en plusieurs appels.
-- Droits de l'appelant (RLS) : seules les séries de ses maisons sont exportées.
CREATE OR REPLACE FUNCTION export_csv(p_series int[], p_from timestamptz, p_to timestamptz,
                                      p_tz text DEFAULT 'Europe/Paris', p_sep text DEFAULT ';',
                                      p_decimal text DEFAULT ',', p_limit int DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE AS $$
  WITH o AS (
    SELECT x.ts, p.name AS place, op.id AS prop_order, op.code, op.unit, x.value, x.quality, d.ma_id, c.channel_no
    FROM series s
    JOIN place p ON p.id = s.place_id
    JOIN observed_property op ON op.id = s.property_id
    CROSS JOIN LATERAL series_observations(s.id, p_from, p_to) x
    JOIN device_channel c ON c.id = x.channel_id
    JOIN device d ON d.id = c.device_id
    WHERE s.id = ANY (p_series)
    ORDER BY x.ts, p.name, op.id
    LIMIT p_limit
  )
  SELECT coalesce(string_agg(concat_ws(p_sep,
           fmt_ts(ts, p_tz), csv_field(place, p_sep), code, replace(value::text, '.', p_decimal),
           csv_field(unit, p_sep), quality, ma_id, channel_no::text),
         E'\n' ORDER BY ts, place, prop_order), '')
  FROM o
$$;

-- ---------------------------------------------------------------------------
-- Import
-- ---------------------------------------------------------------------------

-- Appel hors API (outils en ligne de commande connectés directement à la base, clé service) :
-- pas de contrôle par maison. Les utilisateurs de l'application passent toujours par le rôle
-- « authenticated », qu'ils ne peuvent pas quitter.
CREATE OR REPLACE FUNCTION trusted_caller() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('role', true), 'none') IN ('none', 'service_role') OR is_admin()
$$;

-- p_kind = 'series'  : lignes {"s": série, "t": horodatage ISO avec fuseau, "v": valeur, "q": qualité}
--                      (format MobAlPlus : l'emplacement et la grandeur désignent la série) ;
--          'channel' : lignes {"c": canal, "t", "v", "q"} (ancien tableur : capteur et colonne).
-- Droit « gestion » requis sur la maison. Les doublons sont ignorés, les mesures anciennes compactées.
CREATE OR REPLACE FUNCTION import_values(p_kind text, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_received int := jsonb_array_length(coalesce(p_rows, '[]'));
  v_inserted int := 0;
  v_rejected int := 0;
  v_extended int := 0;
  v_skipped int;
  v_ch record;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS import_stage
    (series_id int, channel_id int, ts timestamptz, value real, rejected boolean) ON COMMIT DROP;
  TRUNCATE import_stage;

  IF p_kind = 'series' THEN
    INSERT INTO import_stage (series_id, ts, value, rejected)
    SELECT (r ->> 's')::int, (r ->> 't')::timestamptz, (r ->> 'v')::real, coalesce(r ->> 'q', '') = 'rejected'
    FROM jsonb_array_elements(p_rows) r;
    IF NOT trusted_caller() AND EXISTS (SELECT 1 FROM import_stage WHERE NOT series_id = ANY (my_series_ids('editor'))) THEN
      RAISE EXCEPTION 'Droits insuffisants : import réservé aux gestionnaires de la maison';
    END IF;
    -- Canal affecté à la série à cet instant
    UPDATE import_stage st SET channel_id = d.channel_id
    FROM deployment d WHERE d.series_id = st.series_id AND d.valid @> st.ts;
    -- Mesures antérieures à la première affectation : canal de cette première affectation
    UPDATE import_stage st SET channel_id = f.channel_id
    FROM (SELECT DISTINCT ON (series_id) series_id, channel_id, lower(valid) AS lo
          FROM deployment ORDER BY series_id, lower(valid) NULLS FIRST) f
    WHERE st.channel_id IS NULL AND f.series_id = st.series_id AND f.lo IS NOT NULL AND st.ts < f.lo;
  ELSIF p_kind = 'channel' THEN
    INSERT INTO import_stage (channel_id, ts, value, rejected)
    SELECT (r ->> 'c')::int, (r ->> 't')::timestamptz, (r ->> 'v')::real, coalesce(r ->> 'q', '') = 'rejected'
    FROM jsonb_array_elements(p_rows) r;
    IF NOT trusted_caller() AND EXISTS (SELECT 1 FROM import_stage WHERE NOT channel_id = ANY (my_channel_ids('editor'))) THEN
      RAISE EXCEPTION 'Droits insuffisants : import réservé aux gestionnaires de la maison';
    END IF;
  ELSE
    RAISE EXCEPTION 'Type d''import inconnu : %', p_kind;
  END IF;

  DELETE FROM import_stage WHERE ts IS NULL OR value IS NULL;
  SELECT count(*) INTO v_skipped FROM import_stage WHERE channel_id IS NULL;
  -- Déjà présentes dans l'historique compacté : doublons (ne sont pas comptées comme insérées)
  DELETE FROM import_stage st WHERE st.channel_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM reading_day d
    WHERE d.channel_id = st.channel_id AND d.day = (st.ts AT TIME ZONE 'UTC')::date
      AND extract(epoch FROM st.ts - day_start(d.day))::int = ANY (d.t));

  -- Rattacher les mesures plus anciennes que la première affectation de leur canal
  FOR v_ch IN SELECT channel_id, min(ts) AS mts FROM import_stage WHERE channel_id IS NOT NULL GROUP BY channel_id LOOP
    v_extended := v_extended + extend_first_deployment(v_ch.channel_id, v_ch.mts);
  END LOOP;

  INSERT INTO reading (channel_id, ts, value)
  SELECT DISTINCT ON (channel_id, ts) channel_id, ts, value FROM import_stage WHERE channel_id IS NOT NULL
  ON CONFLICT (channel_id, ts) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Valeurs exportées comme « rejetées » : la correction est recréée
  INSERT INTO correction (channel_id, ts_range, action, reason, author)
  SELECT DISTINCT st.channel_id, tstzrange(st.ts, st.ts, '[]'), 'reject', 'import', my_email()
  FROM import_stage st
  WHERE st.rejected AND st.channel_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM correction c WHERE c.channel_id = st.channel_id AND c.ts_range @> st.ts);
  GET DIAGNOSTICS v_rejected = ROW_COUNT;

  PERFORM compact_channel_readings(ARRAY(SELECT DISTINCT channel_id FROM import_stage WHERE channel_id IS NOT NULL));

  RETURN jsonb_build_object('received', v_received, 'inserted', v_inserted, 'skipped', v_skipped,
                            'extended', v_extended, 'rejected', v_rejected);
END $$;

REVOKE EXECUTE ON FUNCTION compact_channel_readings(int[], timestamptz), extend_first_deployment(int, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION export_csv(int[], timestamptz, timestamptz, text, text, text, int),
                           import_values(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION export_csv(int[], timestamptz, timestamptz, text, text, text, int),
                          import_values(text, jsonb) TO authenticated;

-- Première et dernière mesure d'un ensemble de séries (pour « tout l'historique »)
CREATE OR REPLACE FUNCTION series_bounds(p_series int[])
RETURNS TABLE (first_ts timestamptz, last_ts timestamptz)
LANGUAGE sql STABLE AS $$
  WITH ch AS (SELECT DISTINCT channel_id FROM deployment WHERE series_id = ANY (p_series))
  SELECT least((SELECT day_start(min(day)) FROM reading_day WHERE channel_id IN (SELECT channel_id FROM ch)),
               (SELECT min(ts) FROM reading WHERE channel_id IN (SELECT channel_id FROM ch))),
         greatest((SELECT day_start(max(day)) + interval '1 day' FROM reading_day WHERE channel_id IN (SELECT channel_id FROM ch)),
                  (SELECT max(ts) FROM reading WHERE channel_id IN (SELECT channel_id FROM ch)))
$$;
REVOKE EXECUTE ON FUNCTION series_bounds(int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION series_bounds(int[]) TO authenticated;
