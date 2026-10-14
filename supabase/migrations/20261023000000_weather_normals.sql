-- Normales saisonnières des stations météo virtuelles : pour chaque jour de l'année, minimum et
-- maximum « normaux » de chaque grandeur (température, humidité), moyennes sur 1991 – 2020 (période
-- de référence de l'OMM) des minimums et maximums journaliers des archives ERA5 (Open-Meteo), à la
-- position de la station, lissées sur quelques semaines. Calculées une fois par station (Edge
-- Function « weather »), recalculées si la station change de position. L'application les trace en
-- bande sous la courbe de la station, pour comparer la mesure à la normale du jour.

CREATE TABLE IF NOT EXISTS normal (
  channel_id  int NOT NULL REFERENCES device_channel(id) ON DELETE CASCADE,
  md          smallint NOT NULL CHECK (md BETWEEN 101 AND 1231),  -- mois × 100 + jour (229 : 29 février)
  vmin        real NOT NULL,
  vmax        real NOT NULL,
  PRIMARY KEY (channel_id, md)
);
ALTER TABLE normal ENABLE ROW LEVEL SECURITY;  -- lecture par series_normals() seulement

-- Calcul des normales d'une station : tentative (une par jour au plus en cas d'échec), résultat
CREATE TABLE IF NOT EXISTS normal_source (
  device_id    int PRIMARY KEY REFERENCES device(id) ON DELETE CASCADE,
  tried_at     timestamptz,
  computed_at  timestamptz,
  period       text,                    -- ex. « 1991-2020 »
  lat          double precision,        -- position de la station lors du calcul
  lon          double precision
);
ALTER TABLE normal_source ENABLE ROW LEVEL SECURITY;

-- Station dont les normales sont à calculer (aucune, ou position changée) ; une seule par appel
-- (30 ans d'archives : requête lourde pour le service gratuit), marquée « tentée »
CREATE OR REPLACE FUNCTION normals_targets(p_now timestamptz DEFAULT now())
RETURNS TABLE (ma_id text, lat double precision, lon double precision)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
BEGIN
  SELECT d.id, d.ma_id, d.lat, d.lon INTO v
    FROM device d LEFT JOIN normal_source n ON n.device_id = d.id
   WHERE d.active AND d.vendor = 'open_meteo' AND d.lat IS NOT NULL AND d.lon IS NOT NULL
     AND (n.computed_at IS NULL OR n.lat IS DISTINCT FROM d.lat OR n.lon IS DISTINCT FROM d.lon)
     AND (n.tried_at IS NULL OR n.tried_at < p_now - interval '1 day')
   ORDER BY n.tried_at NULLS FIRST, d.id
   LIMIT 1;
  IF v.id IS NULL THEN RETURN; END IF;
  INSERT INTO normal_source (device_id, tried_at) VALUES (v.id, p_now)
  ON CONFLICT (device_id) DO UPDATE SET tried_at = excluded.tried_at;
  ma_id := v.ma_id; lat := v.lat; lon := v.lon;
  RETURN NEXT;
END $$;

-- Normales calculées d'une station : p_rows = [{md, min: [température, humidité], max: […]}]
-- (ordre des canaux, comme les mesures) ; remplacent les précédentes
CREATE OR REPLACE FUNCTION store_normals(p_ma_id text, p_rows jsonb, p_period text DEFAULT '1991-2020')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dev device;
  n int;
BEGIN
  SELECT * INTO v_dev FROM device WHERE ma_id = p_ma_id AND vendor = 'open_meteo';
  IF v_dev.id IS NULL THEN RAISE EXCEPTION 'Station météo inconnue : %', p_ma_id; END IF;
  DELETE FROM normal nr USING device_channel c WHERE c.id = nr.channel_id AND c.device_id = v_dev.id;
  INSERT INTO normal (channel_id, md, vmin, vmax)
  SELECT c.id, (x->>'md')::smallint, (x->'min'->>(c.channel_no - 1)::int)::real, (x->'max'->>(c.channel_no - 1)::int)::real
  FROM jsonb_array_elements(coalesce(p_rows, '[]')) x
  JOIN device_channel c ON c.device_id = v_dev.id
  WHERE x->'min'->>(c.channel_no - 1)::int IS NOT NULL AND x->'max'->>(c.channel_no - 1)::int IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO normal_source (device_id, tried_at, computed_at, period, lat, lon)
  VALUES (v_dev.id, now(), now(), p_period, v_dev.lat, v_dev.lon)
  ON CONFLICT (device_id) DO UPDATE
    SET computed_at = excluded.computed_at, period = excluded.period, lat = excluded.lat, lon = excluded.lon;
  RETURN n;
END $$;

-- Normales d'une série (canal affecté actuellement)
CREATE OR REPLACE FUNCTION normal_of(p_series int)
RETURNS TABLE (md smallint, vmin real, vmax real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nr.md, nr.vmin, nr.vmax FROM deployment d JOIN normal nr ON nr.channel_id = d.channel_id
  WHERE d.series_id = p_series AND deployment_is_current(d.valid)
$$;

-- Normales de plusieurs séries (séries accessibles au compte connecté ; aucune ligne si la série
-- n'est pas une station météo)
CREATE OR REPLACE FUNCTION series_normals(p_series int[])
RETURNS TABLE (series_id int, md smallint, vmin real, vmax real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s, nr.md, nr.vmin, nr.vmax
  FROM unnest(p_series) s CROSS JOIN LATERAL normal_of(s) nr
  WHERE trusted_caller() OR s = ANY (my_series_ids())
  ORDER BY 1, 2
$$;

REVOKE EXECUTE ON FUNCTION normals_targets(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION store_normals(text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION normal_of(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION series_normals(int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION series_normals(int[]) TO authenticated;
