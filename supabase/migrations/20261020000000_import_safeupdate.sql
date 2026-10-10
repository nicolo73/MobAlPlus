-- Supabase active pg_safeupdate pour les requêtes de l'API : tout UPDATE ou DELETE sans WHERE est
-- refusé (« UPDATE requires a WHERE clause »), même à l'intérieur d'une fonction. La classification
-- de l'import (aperçu et import depuis la page Données) en contenait un.

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
    ELSE 'conflict' END
  WHERE true;  -- toutes les lignes (WHERE exigé par pg_safeupdate)
END $$;
