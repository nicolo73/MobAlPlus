-- MobAlPlus : lecture pour les courbes et la page d'un emplacement

-- Données d'affichage de plusieurs séries en un seul appel (voir series_data)
CREATE OR REPLACE FUNCTION series_data_multi(p_series int[], p_from timestamptz, p_to timestamptz,
                                             p_max_points int DEFAULT 1500)
RETURNS TABLE (series_id int, ts timestamptz, value real, quality text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  s int;
BEGIN
  FOREACH s IN ARRAY p_series LOOP
    RETURN QUERY SELECT s, d.ts, d.value, d.quality FROM series_data(s, p_from, p_to, p_max_points) d;
  END LOOP;
END $$;

-- Statistiques exactes d'une série sur une période (valeurs rejetées exclues)
CREATE OR REPLACE FUNCTION series_stats(p_series int, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (n bigint, vmin real, tmin timestamptz, vmax real, tmax timestamptz, vavg real,
               first_ts timestamptz, last_ts timestamptz)
LANGUAGE sql STABLE AS $$
  WITH o AS (
    SELECT ts, value FROM series_observations(p_series, p_from, p_to) WHERE quality <> 'rejected'
  )
  SELECT (SELECT count(*) FROM o),
         lo.value, lo.ts, hi.value, hi.ts,
         (SELECT avg(value)::real FROM o),
         (SELECT min(ts) FROM o), (SELECT max(ts) FROM o)
  FROM (SELECT 1) x
  LEFT JOIN LATERAL (SELECT ts, value FROM o ORDER BY value, ts LIMIT 1) lo ON true
  LEFT JOIN LATERAL (SELECT ts, value FROM o ORDER BY value DESC, ts LIMIT 1) hi ON true
$$;

REVOKE EXECUTE ON FUNCTION series_data_multi(int[], timestamptz, timestamptz, int),
                           series_stats(int, timestamptz, timestamptz),
                           series_data(int, timestamptz, timestamptz, int),
                           series_observations(int, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION series_data_multi(int[], timestamptz, timestamptz, int),
                          series_stats(int, timestamptz, timestamptz),
                          series_data(int, timestamptz, timestamptz, int),
                          series_observations(int, timestamptz, timestamptz) TO authenticated;
