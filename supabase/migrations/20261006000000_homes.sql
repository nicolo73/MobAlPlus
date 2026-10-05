-- MobAlPlus : maisons, membres et partage
--
-- Une maison regroupe emplacements et capteurs. Chaque compte voit les maisons dont il est membre :
--   owner  : gère tout, y compris le partage ;
--   editor : gère capteurs, emplacements, corrections ;
--   viewer : consulte.
-- Le rôle « admin » de app_user devient l'administrateur de la plateforme (maintenance, statistiques
-- globales, création de maisons) ; il voit toutes les maisons.
-- Un membre est désigné par son adresse e-mail : on peut inviter quelqu'un avant sa première connexion.
--
-- Performance : chaque règle compare l'identifiant de la ligne à une liste calculée une seule fois par
-- requête ((SELECT my_xxx_ids(...))::int[]), jamais par ligne.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS home (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  lat         double precision,
  lon         double precision,
  timezone    text NOT NULL DEFAULT 'Europe/Paris',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_member (
  id          serial PRIMARY KEY,
  home_id     int NOT NULL REFERENCES home(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (email = lower(email)),
  user_id     uuid,                      -- renseigné à la première connexion
  role        text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (home_id, email)
);

-- Maison par défaut pour les données existantes
INSERT INTO home (name) SELECT 'Ma maison' WHERE NOT EXISTS (SELECT 1 FROM home);

CREATE OR REPLACE FUNCTION default_home_id() RETURNS int
LANGUAGE sql STABLE AS $$ SELECT min(id) FROM home $$;

ALTER TABLE place  ADD COLUMN IF NOT EXISTS home_id int REFERENCES home(id) ON DELETE CASCADE;
ALTER TABLE device ADD COLUMN IF NOT EXISTS home_id int REFERENCES home(id) ON DELETE CASCADE;
UPDATE place  SET home_id = default_home_id() WHERE home_id IS NULL;
UPDATE device SET home_id = default_home_id() WHERE home_id IS NULL;
-- Valeur par défaut : utile aux outils en ligne de commande d'une installation à une seule maison
ALTER TABLE place  ALTER COLUMN home_id SET DEFAULT default_home_id(), ALTER COLUMN home_id SET NOT NULL;
ALTER TABLE device ALTER COLUMN home_id SET DEFAULT default_home_id(), ALTER COLUMN home_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS place_home_idx  ON place (home_id);
CREATE INDEX IF NOT EXISTS device_home_idx ON device (home_id);

-- Le code d'un emplacement est unique dans sa maison (et non plus globalement)
ALTER TABLE place DROP CONSTRAINT IF EXISTS place_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS place_home_code_key ON place (home_id, code);

-- Comptes existants : les administrateurs deviennent propriétaires de la maison par défaut
INSERT INTO home_member (home_id, email, user_id, role, invited_by)
SELECT default_home_id(), lower(email), user_id, CASE WHEN role = 'admin' THEN 'owner' ELSE 'viewer' END, 'migration'
FROM app_user
ON CONFLICT (home_id, email) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cohérence : un capteur ne peut alimenter qu'un emplacement de sa maison
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_deployment_home() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT d.home_id FROM device_channel c JOIN device d ON d.id = c.device_id WHERE c.id = NEW.channel_id)
     IS DISTINCT FROM
     (SELECT p.home_id FROM series s JOIN place p ON p.id = s.place_id WHERE s.id = NEW.series_id) THEN
    RAISE EXCEPTION 'Le capteur et l''emplacement doivent appartenir à la même maison';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS deployment_home_check ON deployment;
CREATE TRIGGER deployment_home_check BEFORE INSERT OR UPDATE ON deployment
  FOR EACH ROW EXECUTE FUNCTION check_deployment_home();

CREATE OR REPLACE FUNCTION check_place_parent_home() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL
     AND (SELECT home_id FROM place WHERE id = NEW.parent_id) IS DISTINCT FROM NEW.home_id THEN
    RAISE EXCEPTION 'L''emplacement parent doit appartenir à la même maison';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS place_parent_home_check ON place;
CREATE TRIGGER place_parent_home_check BEFORE INSERT OR UPDATE ON place
  FOR EACH ROW EXECUTE FUNCTION check_place_parent_home();

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------

-- Correctif : sans ligne dans app_user, my_role() vaut NULL et « NOT is_admin() » aussi, ce qui
-- laissait passer les contrôles « IF NOT is_admin() THEN RAISE ». Ces fonctions renvoient désormais
-- toujours vrai ou faux.
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT coalesce(my_role() = 'admin', false) $$;

CREATE OR REPLACE FUNCTION is_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT my_role() IS NOT NULL $$;

CREATE OR REPLACE FUNCTION role_rank(r text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END
$$;

-- E-mail de l'utilisateur connecté (NULL sans session)
CREATE OR REPLACE FUNCTION my_email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL THEN lower(auth.jwt() ->> 'email') END
$$;

-- Maisons accessibles avec au moins le rôle p_min (toutes pour l'administrateur de la plateforme)
CREATE OR REPLACE FUNCTION my_home_ids(p_min text DEFAULT 'viewer') RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN '{}'::int[]
    WHEN is_admin() THEN (SELECT coalesce(array_agg(id), '{}') FROM home)
    ELSE (SELECT coalesce(array_agg(DISTINCT home_id), '{}') FROM home_member
          WHERE (user_id = auth.uid() OR email = my_email()) AND role_rank(role) >= role_rank(p_min))
  END
$$;

CREATE OR REPLACE FUNCTION my_place_ids(p_min text DEFAULT 'viewer') RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(id), '{}') FROM place WHERE home_id = ANY (my_home_ids(p_min))
$$;

CREATE OR REPLACE FUNCTION my_device_ids(p_min text DEFAULT 'viewer') RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(id), '{}') FROM device WHERE home_id = ANY (my_home_ids(p_min))
$$;

CREATE OR REPLACE FUNCTION my_channel_ids(p_min text DEFAULT 'viewer') RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(c.id), '{}') FROM device_channel c JOIN device d ON d.id = c.device_id
  WHERE d.home_id = ANY (my_home_ids(p_min))
$$;

CREATE OR REPLACE FUNCTION my_series_ids(p_min text DEFAULT 'viewer') RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(s.id), '{}') FROM series s JOIN place p ON p.id = s.place_id
  WHERE p.home_id = ANY (my_home_ids(p_min))
$$;

-- Contexte de l'utilisateur connecté, pour l'application
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
    ), '[]'))
  WHERE auth.uid() IS NOT NULL
$$;

-- Rattache l'invitation au compte à sa première connexion (appelée par l'application)
CREATE OR REPLACE FUNCTION claim_invitations() RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (
    UPDATE home_member SET user_id = auth.uid()
    WHERE auth.uid() IS NOT NULL AND email = my_email() AND user_id IS DISTINCT FROM auth.uid()
    RETURNING 1
  ) SELECT count(*)::int FROM u
$$;

-- Le collecteur peut-il être déclenché par l'utilisateur connecté pour ces capteurs ?
CREATE OR REPLACE FUNCTION can_collect(p_ma_ids text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN is_admin() THEN true
              WHEN p_ma_ids IS NULL OR cardinality(p_ma_ids) = 0 THEN false
              ELSE NOT EXISTS (
                SELECT 1 FROM unnest(p_ma_ids) x(ma_id)
                LEFT JOIN device d ON d.ma_id = upper(x.ma_id)
                WHERE d.id IS NULL OR NOT d.home_id = ANY (my_home_ids('editor')))
         END
$$;

-- ---------------------------------------------------------------------------
-- Règles d'accès (remplacent celles fondées sur le seul rôle global)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['app_setting', 'observed_property', 'place', 'device', 'device_channel',
                             'series', 'deployment', 'reading', 'reading_day', 'correction',
                             'annotation', 'device_sync', 'maintenance_log', 'app_user', 'home', 'home_member']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol.policyname, tbl);
    END LOOP;
  END LOOP;
END $$;

-- Référentiel commun
CREATE POLICY read_all ON observed_property FOR SELECT TO authenticated USING (true);
CREATE POLICY admin_write ON observed_property FOR ALL TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

-- Plateforme : réservé à l'administrateur
CREATE POLICY admin_all ON app_setting FOR ALL TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));
CREATE POLICY admin_all ON maintenance_log FOR ALL TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));
CREATE POLICY own_or_admin ON app_user FOR SELECT TO authenticated
  USING ((SELECT is_admin()) OR user_id = (SELECT auth.uid()) OR email = (SELECT my_email()));
CREATE POLICY admin_write ON app_user FOR ALL TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

-- Maisons
CREATE POLICY member_read ON home FOR SELECT TO authenticated USING (id = ANY ((SELECT my_home_ids())::int[]));
CREATE POLICY owner_update ON home FOR UPDATE TO authenticated
  USING (id = ANY ((SELECT my_home_ids('owner'))::int[])) WITH CHECK (id = ANY ((SELECT my_home_ids('owner'))::int[]));
CREATE POLICY admin_insert ON home FOR INSERT TO authenticated WITH CHECK ((SELECT is_admin()));
CREATE POLICY admin_delete ON home FOR DELETE TO authenticated USING ((SELECT is_admin()));

-- Membres : visibles des gestionnaires de la maison, et chacun voit sa propre invitation
CREATE POLICY manager_read ON home_member FOR SELECT TO authenticated
  USING (home_id = ANY ((SELECT my_home_ids('editor'))::int[]) OR user_id = (SELECT auth.uid()) OR email = (SELECT my_email()));
CREATE POLICY owner_write ON home_member FOR ALL TO authenticated
  USING (home_id = ANY ((SELECT my_home_ids('owner'))::int[])) WITH CHECK (home_id = ANY ((SELECT my_home_ids('owner'))::int[]));

-- Données d'une maison : lecture pour les membres, écriture pour owner / editor
CREATE POLICY member_read ON place FOR SELECT TO authenticated USING (home_id = ANY ((SELECT my_home_ids())::int[]));
CREATE POLICY editor_write ON place FOR ALL TO authenticated
  USING (home_id = ANY ((SELECT my_home_ids('editor'))::int[])) WITH CHECK (home_id = ANY ((SELECT my_home_ids('editor'))::int[]));

CREATE POLICY member_read ON device FOR SELECT TO authenticated USING (home_id = ANY ((SELECT my_home_ids())::int[]));
CREATE POLICY editor_write ON device FOR ALL TO authenticated
  USING (home_id = ANY ((SELECT my_home_ids('editor'))::int[])) WITH CHECK (home_id = ANY ((SELECT my_home_ids('editor'))::int[]));

CREATE POLICY member_read ON device_channel FOR SELECT TO authenticated USING (device_id = ANY ((SELECT my_device_ids())::int[]));
CREATE POLICY editor_write ON device_channel FOR ALL TO authenticated
  USING (device_id = ANY ((SELECT my_device_ids('editor'))::int[])) WITH CHECK (device_id = ANY ((SELECT my_device_ids('editor'))::int[]));

CREATE POLICY member_read ON series FOR SELECT TO authenticated USING (place_id = ANY ((SELECT my_place_ids())::int[]));
CREATE POLICY editor_write ON series FOR ALL TO authenticated
  USING (place_id = ANY ((SELECT my_place_ids('editor'))::int[])) WITH CHECK (place_id = ANY ((SELECT my_place_ids('editor'))::int[]));

CREATE POLICY member_read ON deployment FOR SELECT TO authenticated USING (series_id = ANY ((SELECT my_series_ids())::int[]));
CREATE POLICY editor_write ON deployment FOR ALL TO authenticated
  USING (series_id = ANY ((SELECT my_series_ids('editor'))::int[]))
  WITH CHECK (series_id = ANY ((SELECT my_series_ids('editor'))::int[]) AND channel_id = ANY ((SELECT my_channel_ids('editor'))::int[]));

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['reading', 'reading_day', 'correction'] LOOP
    EXECUTE format('CREATE POLICY member_read ON %I FOR SELECT TO authenticated '
                   'USING (channel_id = ANY ((SELECT my_channel_ids())::int[]))', tbl);
    EXECUTE format('CREATE POLICY editor_write ON %I FOR ALL TO authenticated '
                   'USING (channel_id = ANY ((SELECT my_channel_ids(''editor''))::int[])) '
                   'WITH CHECK (channel_id = ANY ((SELECT my_channel_ids(''editor''))::int[]))', tbl);
  END LOOP;
END $$;

CREATE POLICY member_read ON annotation FOR SELECT TO authenticated
  USING (series_id = ANY ((SELECT my_series_ids())::int[]) OR place_id = ANY ((SELECT my_place_ids())::int[])
         OR (series_id IS NULL AND place_id IS NULL AND (SELECT is_admin())));
CREATE POLICY editor_write ON annotation FOR ALL TO authenticated
  USING (series_id = ANY ((SELECT my_series_ids('editor'))::int[]) OR place_id = ANY ((SELECT my_place_ids('editor'))::int[]))
  WITH CHECK (series_id = ANY ((SELECT my_series_ids('editor'))::int[]) OR place_id = ANY ((SELECT my_place_ids('editor'))::int[]));

CREATE POLICY member_read ON device_sync FOR SELECT TO authenticated USING (device_id = ANY ((SELECT my_device_ids())::int[]));
CREATE POLICY admin_write ON device_sync FOR ALL TO authenticated
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

-- ---------------------------------------------------------------------------
-- Lecture par maison
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS current_values();
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
  ORDER BY p.name, op.id
$$;

REVOKE EXECUTE ON FUNCTION current_values(int), my_home_ids(text), my_place_ids(text), my_device_ids(text),
                           my_channel_ids(text), my_series_ids(text), my_context(), claim_invitations(),
                           can_collect(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_values(int), my_home_ids(text), my_place_ids(text), my_device_ids(text),
                          my_channel_ids(text), my_series_ids(text), my_context(), claim_invitations(),
                          can_collect(text[]) TO authenticated;

-- Une maison garde toujours au moins un propriétaire (sauf suppression de la maison elle-même)
CREATE OR REPLACE FUNCTION check_home_has_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM home WHERE id = OLD.home_id)
     AND NOT EXISTS (SELECT 1 FROM home_member WHERE home_id = OLD.home_id AND role = 'owner') THEN
    RAISE EXCEPTION 'Une maison doit garder au moins un propriétaire';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS home_owner_check ON home_member;
CREATE CONSTRAINT TRIGGER home_owner_check AFTER UPDATE OR DELETE ON home_member
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION check_home_has_owner();

-- Le créateur d'une maison en devient propriétaire
CREATE OR REPLACE FUNCTION create_home(p_name text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Création de maison réservée à l''administrateur'; END IF;
  INSERT INTO home (name) VALUES (p_name) RETURNING id INTO v_id;
  INSERT INTO home_member (home_id, email, user_id, role, invited_by)
  VALUES (v_id, my_email(), auth.uid(), 'owner', my_email());
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION create_home(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_home(text) TO authenticated;
