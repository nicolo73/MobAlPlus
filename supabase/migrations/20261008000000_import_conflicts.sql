-- MobAlPlus : import avec détection des doublons proches et des conflits
--
-- Une valeur du fichier est comparée à la mesure existante la plus proche du même canal, dans une marge
-- de ± p_tolerance secondes (2 minutes par défaut, en dessous de l'intervalle d'émission des capteurs) :
--   nouvelle  : aucune mesure dans la marge -> ajoutée ;
--   identique : mesure dans la marge, même valeur -> ignorée ;
--   conflit   : mesure dans la marge, valeur différente -> conservée (p_mode 'keep', par défaut)
--               ou remplacée par la valeur du fichier (p_mode 'replace' : la mesure existante la plus
--               proche est supprimée, y compris dans l'historique compacté, et le remplacement est journalisé).

-- Charge les lignes dans import_stage et rattache chaque valeur à un canal (sans rien modifier)
CREATE OR REPLACE FUNCTION import_stage_load(p_kind text, p_rows jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS import_stage
    (idx int, series_id int, channel_id int, ts timestamptz, value real, rejected boolean,
     status text, ets timestamptz, evalue real) ON COMMIT DROP;
  TRUNCATE import_stage;

  IF p_kind = 'series' THEN
    INSERT INTO import_stage (idx, series_id, ts, value, rejected)
    SELECT o::int, (r ->> 's')::int, (r ->> 't')::timestamptz, (r ->> 'v')::real, coalesce(r ->> 'q', '') = 'rejected'
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(r, o);
    IF NOT trusted_caller() AND EXISTS (SELECT 1 FROM import_stage WHERE NOT series_id = ANY (my_series_ids('editor'))) THEN
      RAISE EXCEPTION 'Droits insuffisants : import réservé aux gestionnaires de la maison';
    END IF;
    UPDATE import_stage st SET channel_id = d.channel_id
    FROM deployment d WHERE d.series_id = st.series_id AND d.valid @> st.ts;
    UPDATE import_stage st SET channel_id = f.channel_id
    FROM (SELECT DISTINCT ON (series_id) series_id, channel_id, lower(valid) AS lo
          FROM deployment ORDER BY series_id, lower(valid) NULLS FIRST) f
    WHERE st.channel_id IS NULL AND f.series_id = st.series_id AND f.lo IS NOT NULL AND st.ts < f.lo;
  ELSIF p_kind = 'channel' THEN
    INSERT INTO import_stage (idx, channel_id, ts, value, rejected)
    SELECT o::int, (r ->> 'c')::int, (r ->> 't')::timestamptz, (r ->> 'v')::real, coalesce(r ->> 'q', '') = 'rejected'
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(r, o);
    IF NOT trusted_caller() AND EXISTS (SELECT 1 FROM import_stage WHERE NOT channel_id = ANY (my_channel_ids('editor'))) THEN
      RAISE EXCEPTION 'Droits insuffisants : import réservé aux gestionnaires de la maison';
    END IF;
  ELSE
    RAISE EXCEPTION 'Type d''import inconnu : %', p_kind;
  END IF;
  DELETE FROM import_stage WHERE ts IS NULL OR value IS NULL;
  -- Doublons internes au fichier : on garde la dernière occurrence
  DELETE FROM import_stage a USING import_stage b
  WHERE a.channel_id = b.channel_id AND a.ts = b.ts AND a.idx < b.idx;
END $$;

-- Classe chaque ligne (nouvelle / identique / conflit) par rapport à la mesure existante la plus proche
CREATE OR REPLACE FUNCTION import_stage_classify(p_tolerance int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tol interval := make_interval(secs => greatest(p_tolerance, 0));
BEGIN
  UPDATE import_stage st SET ets = e.ts, evalue = e.value
  FROM import_stage s2
  CROSS JOIN LATERAL (
    SELECT x.ts, x.value FROM channel_readings(s2.channel_id, s2.ts - tol, s2.ts + tol + interval '1 microsecond') x
    ORDER BY abs(extract(epoch FROM x.ts - s2.ts)), x.ts LIMIT 1
  ) e
  WHERE s2.idx = st.idx AND s2.channel_id IS NOT NULL;
  UPDATE import_stage SET status = CASE
    WHEN channel_id IS NULL THEN 'unassigned'
    WHEN ets IS NULL THEN 'new'
    WHEN abs(evalue - value) < 0.0005 THEN 'identical'
    ELSE 'conflict' END;
END $$;

-- Aperçu, sans rien écrire : comptes par série (ou canal), exemples de conflits, soupçon de fuseau
CREATE OR REPLACE FUNCTION import_preview(p_kind text, p_rows jsonb, p_tolerance int DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_groups jsonb;
  v_tz int;
  v_sampled int;
BEGIN
  PERFORM import_stage_load(p_kind, p_rows);
  PERFORM import_stage_classify(p_tolerance);

  WITH keyed AS (
    SELECT *, CASE WHEN p_kind = 'series' THEN series_id ELSE channel_id END AS key FROM import_stage
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'key', g.key, 'new', g.new, 'identical', g.identical, 'conflict', g.conflict,
           'unassigned', g.unassigned, 'samples', g.samples)), '[]')
    INTO v_groups
  FROM (
    SELECT k.key,
           count(*) FILTER (WHERE k.status = 'new') AS new,
           count(*) FILTER (WHERE k.status = 'identical') AS identical,
           count(*) FILTER (WHERE k.status = 'conflict') AS conflict,
           count(*) FILTER (WHERE k.status = 'unassigned') AS unassigned,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('t', c.ts, 'v', c.value, 'et', c.ets, 'ev', c.evalue) ORDER BY c.ts), '[]')
            FROM (SELECT * FROM keyed c WHERE c.key = k.key AND c.status = 'conflict' ORDER BY c.ts LIMIT 5) c) AS samples
    FROM keyed k GROUP BY k.key
  ) g;

  -- Fuseau suspect : parmi (au plus 200) nouvelles valeurs, combien retrouvent la même valeur décalée
  -- d'exactement 1 h ou 2 h dans l'existant ?
  WITH sample AS (SELECT * FROM import_stage WHERE status = 'new' ORDER BY idx LIMIT 200)
  SELECT count(*), count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM unnest(ARRAY[-7200, -3600, 3600, 7200]) sh(sec)
           CROSS JOIN LATERAL channel_readings(s.channel_id,
             s.ts + make_interval(secs => sh.sec - greatest(p_tolerance, 60)),
             s.ts + make_interval(secs => sh.sec + greatest(p_tolerance, 60))) x
           WHERE abs(x.value - s.value) < 0.0005))
    INTO v_sampled, v_tz
  FROM sample s;

  RETURN jsonb_build_object('groups', v_groups, 'tz_sampled', v_sampled, 'tz_shifted', v_tz);
END $$;

DROP FUNCTION IF EXISTS import_values(text, jsonb);
CREATE OR REPLACE FUNCTION import_values(p_kind text, p_rows jsonb, p_tolerance int DEFAULT 120,
                                         p_mode text DEFAULT 'keep')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tol interval := make_interval(secs => greatest(p_tolerance, 0));
  v_received int := jsonb_array_length(coalesce(p_rows, '[]'));
  v_inserted int := 0;
  v_rejected int := 0;
  v_extended int := 0;
  v_replaced int := 0;
  v_identical int;
  v_conflicts int;
  v_skipped int;
  v_ch record;
BEGIN
  IF p_mode NOT IN ('keep', 'replace') THEN RAISE EXCEPTION 'Mode inconnu : %', p_mode; END IF;
  PERFORM import_stage_load(p_kind, p_rows);

  FOR v_ch IN SELECT channel_id, min(ts) AS mts FROM import_stage WHERE channel_id IS NOT NULL GROUP BY channel_id LOOP
    v_extended := v_extended + extend_first_deployment(v_ch.channel_id, v_ch.mts);
  END LOOP;

  PERFORM import_stage_classify(p_tolerance);
  SELECT count(*) FILTER (WHERE status = 'unassigned'), count(*) FILTER (WHERE status = 'identical'),
         count(*) FILTER (WHERE status = 'conflict')
    INTO v_skipped, v_identical, v_conflicts FROM import_stage;

  IF p_mode = 'replace' AND v_conflicts > 0 THEN
    -- La mesure existante la plus proche (repérée par la classification) est supprimée, dans le détail
    -- comme dans l'historique compacté, puis remplacée par la valeur du fichier
    WITH del AS (
      DELETE FROM reading r USING import_stage st
      WHERE st.status = 'conflict' AND r.channel_id = st.channel_id AND r.ts = st.ets RETURNING 1)
    SELECT count(*) INTO v_replaced FROM del;

    WITH dels AS (
      SELECT channel_id, (ets AT TIME ZONE 'UTC')::date AS day,
             array_agg(extract(epoch FROM ets - day_start((ets AT TIME ZONE 'UTC')::date))::int) AS secs
      FROM import_stage WHERE status = 'conflict' GROUP BY 1, 2
    ), rebuilt AS (
      SELECT d.channel_id, d.day,
             coalesce(array_agg(u.t ORDER BY u.o) FILTER (WHERE NOT u.t = ANY (x.secs)), '{}') AS t,
             coalesce(array_agg(u.v ORDER BY u.o) FILTER (WHERE NOT u.t = ANY (x.secs)), '{}') AS v,
             count(*) FILTER (WHERE u.t = ANY (x.secs)) AS removed
      FROM reading_day d
      JOIN dels x USING (channel_id, day)
      CROSS JOIN LATERAL unnest(d.t, d.v) WITH ORDINALITY AS u(t, v, o)
      GROUP BY d.channel_id, d.day
    ), upd AS (
      UPDATE reading_day d SET t = r.t, v = r.v, n_raw = greatest(d.n_raw - r.removed::int, cardinality(r.t))
      FROM rebuilt r WHERE d.channel_id = r.channel_id AND d.day = r.day AND r.removed > 0
      RETURNING r.removed)
    SELECT v_replaced + coalesce(sum(removed), 0) INTO v_replaced FROM upd;

    UPDATE import_stage SET status = 'new' WHERE status = 'conflict';
    INSERT INTO maintenance_log (task, details)
    VALUES ('import_replace', jsonb_build_object('by', my_email(), 'kind', p_kind, 'conflicts', v_conflicts,
                                                 'removed', v_replaced, 'tolerance_s', p_tolerance));
  END IF;

  INSERT INTO reading (channel_id, ts, value)
  SELECT channel_id, ts, value FROM import_stage WHERE status = 'new'
  ON CONFLICT (channel_id, ts) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO correction (channel_id, ts_range, action, reason, author)
  SELECT DISTINCT st.channel_id, tstzrange(st.ts, st.ts, '[]'), 'reject', 'import', my_email()
  FROM import_stage st
  WHERE st.rejected AND st.status = 'new'
    AND NOT EXISTS (SELECT 1 FROM correction c WHERE c.channel_id = st.channel_id AND c.ts_range @> st.ts);
  GET DIAGNOSTICS v_rejected = ROW_COUNT;

  PERFORM compact_channel_readings(ARRAY(SELECT DISTINCT channel_id FROM import_stage WHERE channel_id IS NOT NULL));

  RETURN jsonb_build_object('received', v_received, 'inserted', v_inserted, 'identical', v_identical,
                            'conflicts', CASE WHEN p_mode = 'keep' THEN v_conflicts ELSE 0 END,
                            'replaced', v_replaced, 'skipped', v_skipped, 'extended', v_extended,
                            'rejected', v_rejected);
END $$;

REVOKE EXECUTE ON FUNCTION import_stage_load(text, jsonb), import_stage_classify(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION import_preview(text, jsonb, int), import_values(text, jsonb, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION import_preview(text, jsonb, int), import_values(text, jsonb, int, text) TO authenticated;
