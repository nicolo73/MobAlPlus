-- Partage d'emplacements entre maisons, et données publiques communes.
--
-- Un compte peut être membre de plusieurs maisons ; un capteur et son emplacement appartiennent à
-- une seule maison. Pour montrer un emplacement dans une autre maison :
--  - place_share : un gestionnaire partage un emplacement avec un compte (son adresse e-mail) ;
--  - place_link  : ce compte l'ajoute à l'une de ses maisons, où il apparaît « partagé », en lecture
--    seule (mesures, courbes, prévision, normales), rangé où l'on veut dans les emplacements ;
--  - maison commune (home.commons) : les stations météo publiques (open data) n'appartiennent à
--    aucun foyer ; chaque maison qui suit la même commune s'y relie au lieu d'en créer une copie.
-- Les alertes deviennent propres à chaque maison (alert_rule.home_id) : chaque foyer règle les
-- siennes sur un emplacement partagé (gel prévu sur la station commune…) et seuls ses membres sont
-- prévenus.

-- ---------------------------------------------------------------------------
-- Maison commune (données publiques)
-- ---------------------------------------------------------------------------

ALTER TABLE home ADD COLUMN IF NOT EXISTS commons boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS home_commons_one ON home (commons) WHERE commons;
INSERT INTO home (name, commons) SELECT 'Données publiques', true WHERE NOT EXISTS (SELECT 1 FROM home WHERE commons);

CREATE OR REPLACE FUNCTION commons_home_id() RETURNS int
LANGUAGE sql STABLE AS $$ SELECT id FROM home WHERE commons $$;

-- La maison par défaut (outils en ligne de commande) n'est jamais la maison commune
CREATE OR REPLACE FUNCTION default_home_id() RETURNS int
LANGUAGE sql STABLE AS $$ SELECT min(id) FROM home WHERE NOT commons $$;

-- Contexte de l'utilisateur : ses maisons, sans la maison commune (on n'y entre pas : ses stations
-- s'ajoutent aux maisons)
CREATE OR REPLACE FUNCTION my_context() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'email', my_email(),
    'platform_admin', coalesce(is_admin(), false),
    'homes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'role', r.role) ORDER BY h.name)
      FROM home h
      JOIN LATERAL (
        SELECT CASE WHEN is_admin() THEN 'owner' ELSE
          (SELECT m.role FROM home_member m
           WHERE m.home_id = h.id AND (m.user_id = auth.uid() OR m.email = my_email())
           ORDER BY role_rank(m.role) DESC LIMIT 1) END AS role
      ) r ON r.role IS NOT NULL
      WHERE NOT h.commons
    ), '[]'))
  WHERE auth.uid() IS NOT NULL
$$;

-- ---------------------------------------------------------------------------
-- Partages et liens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS place_share (
  id          serial PRIMARY KEY,
  place_id    int NOT NULL REFERENCES place(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (email = lower(email)),
  shared_by   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (place_id, email)
);

CREATE TABLE IF NOT EXISTS place_link (
  home_id     int NOT NULL REFERENCES home(id) ON DELETE CASCADE,
  place_id    int NOT NULL REFERENCES place(id) ON DELETE CASCADE,
  parent_id   int REFERENCES place(id) ON DELETE SET NULL,   -- rangement dans la maison qui l'accueille
  sort_order  int,
  share_id    int REFERENCES place_share(id) ON DELETE CASCADE,  -- partage retiré : lien retiré
  added_by    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (home_id, place_id)
);
CREATE INDEX IF NOT EXISTS place_link_place_idx ON place_link (place_id);

CREATE OR REPLACE FUNCTION check_place_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT home_id FROM place WHERE id = NEW.place_id) = NEW.home_id THEN
    RAISE EXCEPTION 'Cet emplacement appartient déjà à cette maison';
  END IF;
  IF NEW.parent_id IS NOT NULL AND (SELECT home_id FROM place WHERE id = NEW.parent_id) IS DISTINCT FROM NEW.home_id THEN
    RAISE EXCEPTION 'L''emplacement parent doit appartenir à la maison';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS place_link_check ON place_link;
CREATE TRIGGER place_link_check BEFORE INSERT OR UPDATE ON place_link FOR EACH ROW EXECUTE FUNCTION check_place_link();

-- ---------------------------------------------------------------------------
-- Droits : les emplacements reliés à mes maisons sont lisibles (jamais modifiables)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION my_linked_place_ids() RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT place_id), '{}') FROM place_link WHERE home_id = ANY (my_home_ids())
$$;

CREATE OR REPLACE FUNCTION my_place_ids(p_min text DEFAULT 'viewer') RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(id), '{}') FROM place
  WHERE home_id = ANY (my_home_ids(p_min)) OR (p_min = 'viewer' AND id = ANY (my_linked_place_ids()))
$$;

CREATE OR REPLACE FUNCTION my_series_ids(p_min text DEFAULT 'viewer') RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(s.id), '{}') FROM series s WHERE s.place_id = ANY (my_place_ids(p_min))
$$;

-- Canaux : ceux des capteurs de mes maisons, et (lecture) ceux qui alimentent un emplacement relié
CREATE OR REPLACE FUNCTION my_channel_ids(p_min text DEFAULT 'viewer') RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT id), '{}') FROM (
    SELECT c.id FROM device_channel c JOIN device d ON d.id = c.device_id WHERE d.home_id = ANY (my_home_ids(p_min))
    UNION ALL
    SELECT dp.channel_id FROM deployment dp JOIN series s ON s.id = dp.series_id
     WHERE p_min = 'viewer' AND s.place_id = ANY (my_linked_place_ids())
  ) x
$$;

CREATE OR REPLACE FUNCTION my_device_ids(p_min text DEFAULT 'viewer') RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT id), '{}') FROM (
    SELECT id FROM device WHERE home_id = ANY (my_home_ids(p_min))
    UNION ALL
    SELECT c.device_id FROM device_channel c WHERE p_min = 'viewer' AND c.id = ANY (my_channel_ids())
  ) x
$$;

DROP POLICY IF EXISTS member_read ON place;
CREATE POLICY member_read ON place FOR SELECT TO authenticated
  USING (home_id = ANY ((SELECT my_home_ids())::int[]) OR id = ANY ((SELECT my_linked_place_ids())::int[]));
DROP POLICY IF EXISTS member_read ON device;
CREATE POLICY member_read ON device FOR SELECT TO authenticated USING (id = ANY ((SELECT my_device_ids())::int[]));

ALTER TABLE place_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_link ENABLE ROW LEVEL SECURITY;
-- Partages : gérés par les gestionnaires de l'emplacement ; chacun voit ceux qui lui sont destinés
DROP POLICY IF EXISTS manage ON place_share;
CREATE POLICY manage ON place_share FOR ALL TO authenticated
  USING (place_id = ANY ((SELECT my_place_ids('editor'))::int[])) WITH CHECK (place_id = ANY ((SELECT my_place_ids('editor'))::int[]));
DROP POLICY IF EXISTS recipient_read ON place_share;
CREATE POLICY recipient_read ON place_share FOR SELECT TO authenticated USING (email = (SELECT my_email()));
-- Liens : visibles des membres de la maison qui accueille et de ceux de l'emplacement ; modifiés par
-- link_place() / unlink_place() / move_link()
DROP POLICY IF EXISTS member_read ON place_link;
CREATE POLICY member_read ON place_link FOR SELECT TO authenticated
  USING (home_id = ANY ((SELECT my_home_ids())::int[]) OR place_id = ANY ((SELECT my_place_ids('editor'))::int[]));

-- ---------------------------------------------------------------------------
-- Alertes propres à chaque maison
-- ---------------------------------------------------------------------------

ALTER TABLE alert_rule  ADD COLUMN IF NOT EXISTS home_id int REFERENCES home(id) ON DELETE CASCADE;
ALTER TABLE alert_event ADD COLUMN IF NOT EXISTS home_id int REFERENCES home(id) ON DELETE CASCADE;
UPDATE alert_rule r SET home_id = p.home_id FROM series s JOIN place p ON p.id = s.place_id
 WHERE s.id = r.series_id AND r.home_id IS NULL;
UPDATE alert_event e SET home_id = p.home_id FROM series s JOIN place p ON p.id = s.place_id
 WHERE s.id = e.series_id AND e.home_id IS NULL;
ALTER TABLE alert_rule ALTER COLUMN home_id SET NOT NULL;
ALTER TABLE alert_rule DROP CONSTRAINT IF EXISTS alert_rule_series_id_kind_level_key;
CREATE UNIQUE INDEX IF NOT EXISTS alert_rule_home_key ON alert_rule (series_id, home_id, kind, level);
CREATE INDEX IF NOT EXISTS alert_event_home_idx ON alert_event (home_id, started_at DESC);

-- Une alerte appartient à la maison de sa règle
CREATE OR REPLACE FUNCTION alert_event_home() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.home_id IS NULL THEN
    NEW.home_id := coalesce((SELECT home_id FROM alert_rule WHERE id = NEW.rule_id),
                            (SELECT p.home_id FROM series s JOIN place p ON p.id = s.place_id WHERE s.id = NEW.series_id));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS alert_event_home_set ON alert_event;
CREATE TRIGGER alert_event_home_set BEFORE INSERT ON alert_event FOR EACH ROW EXECUTE FUNCTION alert_event_home();

DROP POLICY IF EXISTS member_read ON alert_rule;
DROP POLICY IF EXISTS editor_write ON alert_rule;
CREATE POLICY member_read ON alert_rule FOR SELECT TO authenticated USING (home_id = ANY ((SELECT my_home_ids())::int[]));
CREATE POLICY editor_write ON alert_rule FOR ALL TO authenticated
  USING (home_id = ANY ((SELECT my_home_ids('editor'))::int[]))
  WITH CHECK (home_id = ANY ((SELECT my_home_ids('editor'))::int[]) AND series_id = ANY ((SELECT my_series_ids())::int[]));
DROP POLICY IF EXISTS member_read ON alert_event;
DROP POLICY IF EXISTS editor_delete ON alert_event;
CREATE POLICY member_read ON alert_event FOR SELECT TO authenticated USING (home_id = ANY ((SELECT my_home_ids())::int[]));
CREATE POLICY editor_delete ON alert_event FOR DELETE TO authenticated USING (home_id = ANY ((SELECT my_home_ids('editor'))::int[]));

-- Règles d'une série pour une maison (gestion de la maison ; la série peut être partagée).
-- La série de référence d'une comparaison doit être de la même grandeur et lisible.
DROP FUNCTION IF EXISTS set_alert_rules(int, jsonb);
CREATE OR REPLACE FUNCTION set_alert_rules(p_series int, p_rules jsonb, p_home int DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_home int := coalesce(p_home, (SELECT p.home_id FROM series s JOIN place p ON p.id = s.place_id WHERE s.id = p_series));
BEGIN
  IF NOT (trusted_caller() OR (v_home = ANY (my_home_ids('editor')) AND p_series = ANY (my_series_ids()))) THEN
    RAISE EXCEPTION 'Droits insuffisants sur cet emplacement';
  END IF;
  -- La série doit être visible dans cette maison (à elle, ou reliée)
  IF NOT EXISTS (SELECT 1 FROM series s JOIN place p ON p.id = s.place_id WHERE s.id = p_series
                 AND (p.home_id = v_home OR EXISTS (SELECT 1 FROM place_link l WHERE l.home_id = v_home AND l.place_id = p.id))) THEN
    RAISE EXCEPTION 'Emplacement absent de cette maison';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_rules, '[]')) x
    LEFT JOIN series rs ON rs.id = (x->>'ref_series_id')::int
    JOIN series s ON s.id = p_series
    WHERE x->>'ref_series_id' IS NOT NULL
      AND (rs.id IS NULL OR rs.property_id <> s.property_id OR NOT (trusted_caller() OR rs.id = ANY (my_series_ids())))
  ) THEN
    RAISE EXCEPTION 'Comparaison impossible : emplacement de référence introuvable ou d''une autre grandeur';
  END IF;
  DELETE FROM alert_rule WHERE series_id = p_series AND home_id = v_home
    AND (kind, level) NOT IN (SELECT x->>'kind', x->>'level' FROM jsonb_array_elements(coalesce(p_rules, '[]')) x);
  INSERT INTO alert_rule (series_id, home_id, kind, level, threshold, enabled, ref_series_id)
  SELECT p_series, v_home, x->>'kind', x->>'level', (x->>'threshold')::real, coalesce((x->>'enabled')::boolean, true),
         (x->>'ref_series_id')::int
  FROM jsonb_array_elements(coalesce(p_rules, '[]')) x
  ON CONFLICT (series_id, home_id, kind, level) DO UPDATE
    SET threshold = excluded.threshold, enabled = excluded.enabled, ref_series_id = excluded.ref_series_id;
  -- Seuil (ou référence) modifié : l'alerte en cours est close, la suivante repartira du nouveau réglage
  UPDATE alert_event e SET ended_at = now()
   WHERE e.series_id = p_series AND e.home_id = v_home AND e.ended_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM alert_rule ar WHERE ar.id = e.rule_id AND ar.enabled
                     AND ar.threshold IS NOT DISTINCT FROM e.threshold
                     AND ar.ref_series_id IS NOT DISTINCT FROM e.ref_series_id);
END $$;
REVOKE EXECUTE ON FUNCTION set_alert_rules(int, jsonb, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_alert_rules(int, jsonb, int) TO authenticated;

-- Notifications : membres de la maison de l'alerte (et non plus de la maison du capteur)
CREATE OR REPLACE FUNCTION pending_notifications(p_max_age interval DEFAULT interval '3 hours')
RETURNS TABLE (event_id bigint, kind text, level text, value real, threshold real, started_at timestamptz,
               place_id int, place_name text, property text, unit text,
               endpoint text, p256dh text, auth text, ref_place_name text, forecast_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.kind, e.level, e.value, e.threshold, e.started_at, p.id, p.name, op.code, op.unit,
         ps.endpoint, ps.p256dh, ps.auth, rp.name, e.forecast_at
  FROM alert_event e
  JOIN series s ON s.id = e.series_id
  JOIN place p ON p.id = s.place_id
  JOIN observed_property op ON op.id = s.property_id
  JOIN home_member m ON m.home_id = coalesce(e.home_id, p.home_id) AND m.user_id IS NOT NULL
  JOIN push_subscription ps ON ps.user_id = m.user_id
  LEFT JOIN series rs ON rs.id = e.ref_series_id
  LEFT JOIN place rp ON rp.id = rs.place_id
  WHERE e.notified_at IS NULL AND e.created_at > now() - p_max_age
    AND (ps.min_level = 'info' OR e.level = 'warning')
  ORDER BY e.id
$$;
REVOKE EXECUTE ON FUNCTION pending_notifications(interval) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lecture par maison : ses emplacements et ceux qui y sont reliés
-- ---------------------------------------------------------------------------

-- Emplacements d'une maison (JSON d'une ligne de place) ; un emplacement relié porte le rangement
-- choisi dans cette maison et « shared » : maison d'origine, publique ou non
CREATE OR REPLACE FUNCTION home_places(p_home int)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(p) FROM place p
   WHERE p.home_id = p_home AND p_home = ANY (my_home_ids())
  UNION ALL
  SELECT to_jsonb(p) || jsonb_build_object('parent_id', l.parent_id, 'sort_order', l.sort_order, 'home_id', l.home_id,
                                           'shared', jsonb_build_object('from', h.name, 'public', h.commons, 'home_id', h.id))
    FROM place_link l JOIN place p ON p.id = l.place_id JOIN home h ON h.id = p.home_id
   WHERE l.home_id = p_home AND p_home = ANY (my_home_ids())
$$;

CREATE OR REPLACE FUNCTION current_values(p_home int DEFAULT NULL)
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
  WHERE p_home IS NULL OR p.home_id = p_home
     OR p.id IN (SELECT l.place_id FROM place_link l WHERE l.home_id = p_home)
  ORDER BY p.name, op.id
$$;

-- ---------------------------------------------------------------------------
-- Partager, ajouter à une maison, retirer
-- ---------------------------------------------------------------------------

-- Partage d'un emplacement avec un compte (gestion de l'emplacement)
CREATE OR REPLACE FUNCTION share_place(p_place int, p_email text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id int;
BEGIN
  IF NOT (trusted_caller() OR p_place = ANY (my_place_ids('editor'))) THEN
    RAISE EXCEPTION 'Droits insuffisants sur cet emplacement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM series WHERE place_id = p_place) THEN
    RAISE EXCEPTION 'Seul un emplacement mesuré (capteur ou station) se partage';
  END IF;
  IF coalesce(trim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Adresse e-mail invalide'; END IF;
  INSERT INTO place_share (place_id, email, shared_by) VALUES (p_place, lower(trim(p_email)), my_email())
  ON CONFLICT (place_id, email) DO UPDATE SET shared_by = excluded.shared_by
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Emplacements partagés avec le compte connecté, et stations publiques déjà suivies ailleurs ne
-- sont pas listées ici (voir public_stations) ; « linked » : déjà dans la maison p_home
CREATE OR REPLACE FUNCTION shared_with_me(p_home int)
RETURNS TABLE (share_id int, place_id int, place_name text, kind text, from_home text, shared_by text, linked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sh.id, p.id, p.name, p.kind, h.name, sh.shared_by,
         EXISTS (SELECT 1 FROM place_link l WHERE l.home_id = p_home AND l.place_id = p.id)
  FROM place_share sh JOIN place p ON p.id = sh.place_id JOIN home h ON h.id = p.home_id
  WHERE sh.email = my_email() AND p.home_id <> p_home
  ORDER BY h.name, p.name
$$;

-- Ajoute un emplacement d'une autre maison : partagé avec moi, station publique, ou emplacement
-- d'une autre de mes maisons dont je suis gestionnaire
CREATE OR REPLACE FUNCTION link_place(p_home int, p_place int, p_parent int DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src int := (SELECT home_id FROM place WHERE id = p_place);
  v_share int := (SELECT id FROM place_share WHERE place_id = p_place AND email = my_email());
BEGIN
  IF NOT (trusted_caller() OR p_home = ANY (my_home_ids('editor'))) THEN
    RAISE EXCEPTION 'Droits insuffisants sur cette maison';
  END IF;
  IF v_src IS NULL THEN RAISE EXCEPTION 'Emplacement introuvable'; END IF;
  IF NOT (trusted_caller() OR v_src = commons_home_id() OR v_share IS NOT NULL OR v_src = ANY (my_home_ids('editor'))) THEN
    RAISE EXCEPTION 'Cet emplacement n''est pas partagé avec vous';
  END IF;
  INSERT INTO place_link (home_id, place_id, parent_id, sort_order, share_id, added_by)
  VALUES (p_home, p_place, p_parent,
          coalesce((SELECT max(sort_order) + 1 FROM place WHERE home_id = p_home AND parent_id IS NOT DISTINCT FROM p_parent), 0),
          CASE WHEN v_src = commons_home_id() THEN NULL ELSE v_share END, my_email())
  ON CONFLICT (home_id, place_id) DO NOTHING;
  -- Station publique de nouveau suivie : collecte reprise
  UPDATE device d SET active = true, retired_at = NULL
    FROM device_channel c JOIN deployment dp ON dp.channel_id = c.id AND upper_inf(dp.valid)
    JOIN series s ON s.id = dp.series_id
   WHERE c.device_id = d.id AND s.place_id = p_place AND d.home_id = commons_home_id() AND NOT d.active;
END $$;

-- Retire un emplacement relié d'une maison ; une station publique que plus personne ne suit n'est
-- plus collectée (son historique reste, pour une reprise)
CREATE OR REPLACE FUNCTION unlink_place(p_home int, p_place int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (trusted_caller() OR p_home = ANY (my_home_ids('editor'))) THEN
    RAISE EXCEPTION 'Droits insuffisants sur cette maison';
  END IF;
  DELETE FROM place_link WHERE home_id = p_home AND place_id = p_place;
  DELETE FROM alert_rule r USING series s WHERE s.id = r.series_id AND s.place_id = p_place AND r.home_id = p_home;
  UPDATE place_link SET parent_id = NULL WHERE home_id = p_home AND parent_id = p_place;
  IF NOT EXISTS (SELECT 1 FROM place_link WHERE place_id = p_place) THEN
    UPDATE device d SET active = false, retired_at = now()
      FROM device_channel c JOIN deployment dp ON dp.channel_id = c.id AND upper_inf(dp.valid)
      JOIN series s ON s.id = dp.series_id
     WHERE c.device_id = d.id AND s.place_id = p_place AND d.home_id = commons_home_id() AND d.active;
  END IF;
END $$;

-- Range des emplacements (à elle ou reliés) sous un parent de la maison, dans l'ordre donné
CREATE OR REPLACE FUNCTION reorder_home_places(p_home int, p_parent int, p_ids int[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n int := 0;
  m int;
BEGIN
  IF NOT (trusted_caller() OR p_home = ANY (my_home_ids('editor'))) THEN
    RAISE EXCEPTION 'Droits insuffisants sur cette maison';
  END IF;
  UPDATE place p SET parent_id = p_parent, sort_order = o.ord::int
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord) WHERE p.id = o.id AND p.home_id = p_home;
  GET DIAGNOSTICS m = ROW_COUNT;
  n := n + m;
  UPDATE place_link l SET parent_id = p_parent, sort_order = o.ord::int
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord) WHERE l.place_id = o.id AND l.home_id = p_home;
  GET DIAGNOSTICS m = ROW_COUNT;
  IF n + m <> cardinality(p_ids) THEN RAISE EXCEPTION 'Emplacement introuvable ou non modifiable'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Stations météo publiques
-- ---------------------------------------------------------------------------

-- Distance approchée (km) entre deux positions
CREATE OR REPLACE FUNCTION km_between(a_lat double precision, a_lon double precision, b_lat double precision, b_lon double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 6371 * sqrt(power(radians(b_lat - a_lat), 2) + power(radians(b_lon - a_lon) * cos(radians((a_lat + b_lat) / 2)), 2))
$$;

-- Stations publiques proches d'une position (les plus proches d'abord), avec le nombre de maisons qui les suivent
CREATE OR REPLACE FUNCTION public_stations(p_lat double precision, p_lon double precision, p_km double precision DEFAULT 50)
RETURNS TABLE (place_id int, name text, lat double precision, lon double precision, km double precision, homes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.lat, p.lon, round(km_between(p_lat, p_lon, p.lat, p.lon)::numeric, 1)::double precision,
         (SELECT count(*)::int FROM place_link l WHERE l.place_id = p.id)
  FROM place p
  WHERE auth.uid() IS NOT NULL AND p.home_id = commons_home_id() AND p.kind = 'weather' AND p.lat IS NOT NULL
    AND km_between(p_lat, p_lon, p.lat, p.lon) <= p_km
  ORDER BY 5
$$;

-- Ajoute une station météo à une maison. Publique (commune : position non personnelle) : celle de
-- la maison commune à moins de 3 km si elle existe, sinon une nouvelle, puis reliée à la maison.
-- Privée (« Ma position ») : dans la maison, comme avant.
DROP FUNCTION IF EXISTS add_weather_station(int, text, double precision, double precision, int);
CREATE OR REPLACE FUNCTION add_weather_station(p_home int, p_label text, p_lat double precision,
                                               p_lon double precision, p_parent int DEFAULT NULL, p_public boolean DEFAULT false)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_device int;
  v_place int;
  v_target int := CASE WHEN p_public THEN commons_home_id() ELSE p_home END;
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
  IF p_public THEN
    SELECT p.id INTO v_place FROM place p
     WHERE p.home_id = v_target AND p.kind = 'weather' AND km_between(p_lat, p_lon, p.lat, p.lon) <= 3
     ORDER BY km_between(p_lat, p_lon, p.lat, p.lon) LIMIT 1;
    IF v_place IS NOT NULL THEN
      PERFORM link_place(p_home, v_place, p_parent);
      RETURN v_place;
    END IF;
  END IF;
  INSERT INTO device (home_id, ma_id, name, model, vendor, lat, lon)
  VALUES (v_target, v_code, v_name, 'Open-Meteo', 'open_meteo', round(p_lat::numeric, 4), round(p_lon::numeric, 4))
  RETURNING id INTO v_device;
  INSERT INTO device_channel (device_id, channel_no, property_id, label)
  SELECT v_device, n, op.id, lbl
  FROM (VALUES (1, 'temperature', 'Température (Open-Meteo)'), (2, 'humidity', 'Humidité (Open-Meteo)')) x(n, code, lbl)
  JOIN observed_property op ON op.code = x.code;
  INSERT INTO place (home_id, code, name, kind, exposure, parent_id, lat, lon, sort_order)
  VALUES (v_target, lower(v_code), v_name, 'weather', 'outdoor', CASE WHEN p_public THEN NULL ELSE p_parent END, p_lat, p_lon,
          coalesce((SELECT max(sort_order) + 1 FROM place WHERE home_id = v_target AND parent_id IS NOT DISTINCT FROM p_parent), 0))
  RETURNING id INTO v_place;
  -- Affectation depuis un an : l'historique récupéré à la première collecte s'y rattache
  FOR v_ch IN SELECT id FROM device_channel WHERE device_id = v_device ORDER BY channel_no LOOP
    PERFORM assign_channel(v_ch, v_place, now() - interval '366 days');
  END LOOP;
  IF p_public THEN PERFORM link_place(p_home, v_place, p_parent); END IF;
  RETURN v_place;
END $$;

-- Rend publique une station d'une maison (créée avant les stations communes) : elle passe dans la
-- maison commune et reste dans la maison, reliée, au même rang ; ses alertes sont gardées
CREATE OR REPLACE FUNCTION make_station_public(p_place int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_place place;
BEGIN
  SELECT * INTO v_place FROM place WHERE id = p_place;
  IF v_place.id IS NULL OR v_place.kind IS DISTINCT FROM 'weather' THEN RAISE EXCEPTION 'Station météo introuvable'; END IF;
  IF NOT (trusted_caller() OR v_place.home_id = ANY (my_home_ids('editor'))) THEN
    RAISE EXCEPTION 'Droits insuffisants sur cette station';
  END IF;
  IF v_place.home_id = commons_home_id() THEN RETURN; END IF;
  UPDATE device d SET home_id = commons_home_id()
    FROM device_channel c JOIN deployment dp ON dp.channel_id = c.id JOIN series s ON s.id = dp.series_id
   WHERE c.device_id = d.id AND s.place_id = p_place AND d.vendor = 'open_meteo';
  UPDATE place SET home_id = commons_home_id(), parent_id = NULL WHERE id = p_place;
  INSERT INTO place_link (home_id, place_id, parent_id, sort_order, added_by)
  VALUES (v_place.home_id, p_place, v_place.parent_id, v_place.sort_order, my_email());
END $$;

-- La création de station se fait par add_weather_station : la maison commune n'a pas de membre,
-- le contrôle « même maison » des affectations reste valable (capteur et emplacement y sont tous deux)

REVOKE EXECUTE ON FUNCTION commons_home_id(), my_linked_place_ids(), home_places(int), share_place(int, text),
  shared_with_me(int), link_place(int, int, int), unlink_place(int, int), reorder_home_places(int, int, int[]),
  public_stations(double precision, double precision, double precision),
  add_weather_station(int, text, double precision, double precision, int, boolean), make_station_public(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION commons_home_id(), my_linked_place_ids(), home_places(int), share_place(int, text),
  shared_with_me(int), link_place(int, int, int), unlink_place(int, int), reorder_home_places(int, int, int[]),
  public_stations(double precision, double precision, double precision),
  add_weather_station(int, text, double precision, double precision, int, boolean), make_station_public(int) TO authenticated;
