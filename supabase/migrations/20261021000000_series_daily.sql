-- Courbes sur le temps long : minimum, maximum et moyenne de chaque jour (jour civil du fuseau de la
-- maison), mesures rejetées exclues. L'application trace alors une bande min – max au lieu des
-- oscillations jour / nuit, illisibles au-delà d'une semaine.

CREATE OR REPLACE FUNCTION series_daily(p_series int, p_from timestamptz, p_to timestamptz,
                                        p_tz text DEFAULT 'Europe/Paris')
RETURNS TABLE (day date, vmin real, vmax real, vavg real, n int)
LANGUAGE sql STABLE AS $$
  SELECT (o.ts AT TIME ZONE p_tz)::date, min(o.value), max(o.value), avg(o.value)::real, count(*)::int
  FROM series_observations(p_series, p_from, p_to) o
  WHERE o.quality <> 'rejected'
  GROUP BY 1
  ORDER BY 1
$$;

REVOKE EXECUTE ON FUNCTION series_daily(int, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION series_daily(int, timestamptz, timestamptz, text) TO authenticated;
