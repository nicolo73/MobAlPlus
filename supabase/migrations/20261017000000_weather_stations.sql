-- Météo publique en « capteur virtuel » : une station météo (Open-Meteo) est un capteur
-- (device.vendor = 'open_meteo', position lat / lon) avec deux canaux (température, humidité),
-- affecté à un emplacement de type 'weather'. Ses mesures sont collectées côté serveur
-- (Edge Function « weather », toutes les 30 minutes) et stockées comme celles des capteurs :
-- fiches, courbes, alertes, tendances, export, compactage… sans appel au service depuis les
-- navigateurs. Plusieurs stations possibles (une par commune), rangées librement.

ALTER TABLE device ADD COLUMN IF NOT EXISTS vendor text NOT NULL DEFAULT 'mobile_alerts';
ALTER TABLE device DROP CONSTRAINT IF EXISTS device_vendor_check;
ALTER TABLE device ADD CONSTRAINT device_vendor_check CHECK (vendor IN ('mobile_alerts', 'open_meteo'));
ALTER TABLE device ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE device ADD COLUMN IF NOT EXISTS lon double precision;

-- Le collecteur Mobile Alerts ignore les stations météo
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
  WHERE d.active AND d.vendor = 'mobile_alerts'
  ORDER BY s.last_run NULLS FIRST, d.ma_id
$$;

-- Stations météo à interroger et date à partir de laquelle (un an d'historique à la création)
CREATE OR REPLACE FUNCTION weather_targets()
RETURNS TABLE (ma_id text, lat double precision, lon double precision, since timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT d.ma_id, d.lat, d.lon, coalesce(s.last_ts, now() - interval '365 days')
  FROM device d LEFT JOIN device_sync s ON s.device_id = d.id
  WHERE d.active AND d.vendor = 'open_meteo' AND d.lat IS NOT NULL AND d.lon IS NOT NULL
  ORDER BY s.last_run NULLS FIRST, d.ma_id
$$;

-- Crée une station météo dans une maison : capteur virtuel, emplacement « Météo · <commune> »,
-- affectations (droits « gestion »). Renvoie l'identifiant de l'emplacement.
CREATE OR REPLACE FUNCTION add_weather_station(p_home int, p_label text, p_lat double precision,
                                               p_lon double precision, p_parent int DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_device int;
  v_place int;
  v_code text := 'METEO-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  v_name text := 'Météo · ' || coalesce(nullif(trim(p_label), ''), 'extérieur');
  v_ch int;
BEGIN
  IF NOT (trusted_caller() OR p_home = ANY (my_home_ids('editor'))) THEN
    RAISE EXCEPTION 'Droits insuffisants sur cette maison';
  END IF;
  IF p_lat NOT BETWEEN -90 AND 90 OR p_lon NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Position invalide';
  END IF;
  INSERT INTO device (home_id, ma_id, name, model, vendor, lat, lon)
  VALUES (p_home, v_code, v_name, 'Open-Meteo', 'open_meteo', round(p_lat::numeric, 4), round(p_lon::numeric, 4))
  RETURNING id INTO v_device;
  INSERT INTO device_channel (device_id, channel_no, property_id, label)
  SELECT v_device, n, op.id, lbl
  FROM (VALUES (1, 'temperature', 'Température (Open-Meteo)'), (2, 'humidity', 'Humidité (Open-Meteo)')) x(n, code, lbl)
  JOIN observed_property op ON op.code = x.code;
  INSERT INTO place (home_id, code, name, kind, exposure, parent_id, lat, lon, sort_order)
  VALUES (p_home, lower(v_code), v_name, 'weather', 'outdoor', p_parent, p_lat, p_lon,
          coalesce((SELECT max(sort_order) + 1 FROM place WHERE home_id = p_home AND parent_id IS NOT DISTINCT FROM p_parent), 0))
  RETURNING id INTO v_place;
  -- Affectation depuis un an : l'historique récupéré à la première collecte s'y rattache
  FOR v_ch IN SELECT id FROM device_channel WHERE device_id = v_device ORDER BY channel_no LOOP
    PERFORM assign_channel(v_ch, v_place, now() - interval '366 days');
  END LOOP;
  RETURN v_place;
END $$;

REVOKE EXECUTE ON FUNCTION weather_targets() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION add_weather_station(int, text, double precision, double precision, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_weather_station(int, text, double precision, double precision, int) TO authenticated;

-- Position déjà réglée sur une maison (version précédente) : sa station est créée
DO $$
DECLARE
  h record;
BEGIN
  FOR h IN SELECT * FROM home WHERE lat IS NOT NULL AND lon IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM device WHERE home_id = h.id AND vendor = 'open_meteo') THEN
      PERFORM add_weather_station(h.id, coalesce(h.location_label, h.name), h.lat, h.lon);
    END IF;
  END LOOP;
END $$;

-- Collecte toutes les 30 minutes (minutes 7 et 37)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_cron / pg_net indisponibles : collecte météo non planifiée';
    RETURN;
  END IF;
  PERFORM cron.schedule('mobalplus-weather', '7,37 * * * *', $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mobalplus_project_url')
             || '/functions/v1/weather',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                       WHERE name = 'mobalplus_collect_token')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000)
  $job$);
END $$;
