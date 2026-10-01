-- MobAlPlus : opérations de l'interface d'administration
-- Fonctions SECURITY INVOKER : la RLS s'applique (lecture membres, écriture admins).

-- Valeurs actuelles de chaque série (dernière mesure du canal affecté)
CREATE OR REPLACE FUNCTION current_values()
RETURNS TABLE (series_id int, series_name text, place_id int, place_name text, property text, unit text,
               ts timestamptz, value real, ma_id text, device_name text)
LANGUAGE sql STABLE AS $$
  SELECT s.id, s.name, p.id, p.name, op.code, op.unit, r.ts, r.value, d.ma_id, coalesce(d.name, d.ma_name)
  FROM series s
  JOIN place p ON p.id = s.place_id
  JOIN observed_property op ON op.id = s.property_id
  JOIN deployment dep ON dep.series_id = s.id AND upper_inf(dep.valid)
  JOIN device_channel c ON c.id = dep.channel_id
  JOIN device d ON d.id = c.device_id
  LEFT JOIN LATERAL (
    SELECT r.ts, r.value FROM reading r WHERE r.channel_id = c.id ORDER BY r.ts DESC LIMIT 1
  ) r ON true
  ORDER BY p.name, op.id
$$;

-- Affecte un canal à un emplacement à partir de p_from (p_place NULL = désaffecter).
-- Clôture l'affectation en cours du canal, et celle de la série cible (remplacement de capteur).
CREATE OR REPLACE FUNCTION assign_channel(p_channel int, p_place int, p_from timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_series int;
  v_id int;
BEGIN
  IF p_place IS NOT NULL THEN
    INSERT INTO series (place_id, property_id, name)
    SELECT p.id, op.id, p.name || ' – ' || op.name
    FROM place p, device_channel c JOIN observed_property op ON op.id = c.property_id
    WHERE p.id = p_place AND c.id = p_channel
    ON CONFLICT (place_id, property_id) DO UPDATE SET name = series.name
    RETURNING id INTO v_series;
    IF v_series IS NULL THEN
      RAISE EXCEPTION 'Canal % ou emplacement % introuvable', p_channel, p_place;
    END IF;
  END IF;

  -- Affectations commencées à p_from ou après : remplacées
  DELETE FROM deployment
  WHERE (channel_id = p_channel OR series_id = v_series) AND lower(valid) >= p_from;
  -- Affectations en cours à p_from : clôturées
  UPDATE deployment SET valid = tstzrange(lower(valid), p_from, '[)')
  WHERE (channel_id = p_channel OR series_id = v_series) AND valid @> p_from;

  IF v_series IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO deployment (channel_id, series_id, valid)
  VALUES (p_channel, v_series, tstzrange(p_from, NULL, '[)'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Retire un capteur : plus collecté, affectations clôturées, historique conservé
CREATE OR REPLACE FUNCTION retire_device(p_device int, p_at timestamptz DEFAULT now())
RETURNS void LANGUAGE sql AS $$
  UPDATE deployment SET valid = tstzrange(lower(valid), p_at, '[)')
  WHERE channel_id IN (SELECT id FROM device_channel WHERE device_id = p_device)
    AND valid @> p_at AND lower(valid) IS DISTINCT FROM p_at;
  UPDATE device SET active = false, retired_at = p_at WHERE id = p_device;
$$;

REVOKE EXECUTE ON FUNCTION current_values(), assign_channel(int, int, timestamptz),
                           retire_device(int, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_values(), assign_channel(int, int, timestamptz),
                          retire_device(int, timestamptz) TO authenticated;
