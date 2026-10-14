-- Stations météo : normales calculées par tranches, diagnostic, collecte d'une seule station.
--
-- Normales : 30 ans de données journalières en une requête dépassent la limite par minute du
-- service gratuit Open-Meteo (une requête longue compte pour plusieurs appels). Le calcul se fait
-- par tranches de 10 ans, une par passage de la collecte ; les sommes intermédiaires sont gardées
-- dans normal_source.progress. Une erreur est enregistrée (diagnostic) et la tranche est retentée
-- au plus tard une heure après.

ALTER TABLE normal_source ADD COLUMN IF NOT EXISTS progress jsonb;      -- sommes partielles, prochaine année
ALTER TABLE normal_source ADD COLUMN IF NOT EXISTS error text;          -- dernière erreur du calcul
ALTER TABLE normal_source ADD COLUMN IF NOT EXISTS error_at timestamptz;

DROP FUNCTION IF EXISTS normals_targets(timestamptz);

-- Station dont les normales sont à calculer (ou à poursuivre) ; une seule par appel.
-- p_ma_id : cette station-là (actualisation demandée depuis l'application), sans délai après erreur.
CREATE OR REPLACE FUNCTION normals_targets(p_now timestamptz DEFAULT now(), p_ma_id text DEFAULT NULL)
RETURNS TABLE (ma_id text, lat double precision, lon double precision, progress jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
BEGIN
  SELECT d.id, d.ma_id, d.lat, d.lon, n.progress INTO v
    FROM device d LEFT JOIN normal_source n ON n.device_id = d.id
   WHERE d.active AND d.vendor = 'open_meteo' AND d.lat IS NOT NULL AND d.lon IS NOT NULL
     AND (n.computed_at IS NULL OR n.lat IS DISTINCT FROM d.lat OR n.lon IS DISTINCT FROM d.lon)
     AND (p_ma_id IS NULL OR d.ma_id = p_ma_id)
     AND (p_ma_id IS NOT NULL OR n.error_at IS NULL OR n.error_at < p_now - interval '1 hour')
   ORDER BY n.error_at NULLS FIRST, d.id
   LIMIT 1;
  IF v.id IS NULL THEN RETURN; END IF;
  INSERT INTO normal_source (device_id, tried_at) VALUES (v.id, p_now)
  ON CONFLICT (device_id) DO UPDATE SET tried_at = excluded.tried_at;
  ma_id := v.ma_id; lat := v.lat; lon := v.lon; progress := v.progress;
  RETURN NEXT;
END $$;

-- Tranche calculée : sommes partielles enregistrées, erreur effacée
CREATE OR REPLACE FUNCTION save_normals_progress(p_ma_id text, p_progress jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE normal_source n SET progress = p_progress, error = NULL, error_at = NULL
    FROM device d WHERE d.id = n.device_id AND d.ma_id = p_ma_id
$$;

-- Échec du calcul (affiché dans le diagnostic de la station)
CREATE OR REPLACE FUNCTION normals_error(p_ma_id text, p_message text, p_now timestamptz DEFAULT now())
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE normal_source n SET error = left(p_message, 500), error_at = p_now
    FROM device d WHERE d.id = n.device_id AND d.ma_id = p_ma_id
$$;

-- Normales terminées : comme avant, et effacement des sommes partielles et de l'erreur
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
    SET computed_at = excluded.computed_at, period = excluded.period, lat = excluded.lat, lon = excluded.lon,
        progress = NULL, error = NULL, error_at = NULL;
  RETURN n;
END $$;

-- Station météo d'un emplacement (null si ce n'en est pas une, ou s'il n'est pas accessible)
CREATE OR REPLACE FUNCTION weather_device_of(p_place int)
RETURNS device LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.* FROM deployment dp
    JOIN series s ON s.id = dp.series_id
    JOIN device_channel c ON c.id = dp.channel_id
    JOIN device d ON d.id = c.device_id
   WHERE s.place_id = p_place AND deployment_is_current(dp.valid) AND d.vendor = 'open_meteo'
     AND (trusted_caller() OR p_place = ANY (my_place_ids()))
   LIMIT 1
$$;

-- Diagnostic d'une station météo : position, collecte, prévision, normales (un document JSON)
CREATE OR REPLACE FUNCTION weather_station_info(p_place int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dev device;
  v_series int[];
BEGIN
  v_dev := weather_device_of(p_place);
  IF v_dev.id IS NULL THEN RETURN NULL; END IF;
  SELECT array_agg(id) INTO v_series FROM series WHERE place_id = p_place;
  RETURN jsonb_build_object(
    'ma_id', v_dev.ma_id, 'name', v_dev.name, 'lat', v_dev.lat, 'lon', v_dev.lon,
    'added_at', v_dev.added_at, 'active', v_dev.active,
    'first_ts', (SELECT first_ts FROM series_bounds(v_series)),
    'sync', (SELECT jsonb_build_object('last_ts', s.last_ts, 'last_run', s.last_run, 'status', s.status,
                                       'message', s.message, 'nb_imported', s.nb_imported)
               FROM device_sync s WHERE s.device_id = v_dev.id),
    'forecast', (SELECT jsonb_build_object('n', count(*), 'issued_at', max(f.issued_at), 'until', max(f.ts))
                   FROM forecast f JOIN device_channel c ON c.id = f.channel_id WHERE c.device_id = v_dev.id),
    'normals', (SELECT jsonb_build_object('computed_at', n.computed_at, 'period', n.period, 'tried_at', n.tried_at,
                                          'error', n.error, 'error_at', n.error_at,
                                          'next_year', (n.progress->>'next')::int, 'humidity', n.progress->'humidity',
                                          'rows', (SELECT count(*) FROM normal nr JOIN device_channel c ON c.id = nr.channel_id
                                                   WHERE c.device_id = v_dev.id))
                  FROM normal_source n WHERE n.device_id = v_dev.id)
  );
END $$;

REVOKE EXECUTE ON FUNCTION normals_targets(timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION save_normals_progress(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION normals_error(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION store_normals(text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION weather_device_of(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION weather_station_info(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION weather_station_info(int) TO authenticated;
