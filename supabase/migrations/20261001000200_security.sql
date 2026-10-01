-- MobAlPlus : accès et sécurité (Row Level Security Supabase)
--
-- Seuls les utilisateurs inscrits dans app_user voient les données ; seuls les « admin » les modifient.
-- Le collecteur (Edge Function) utilise la clé service_role, qui contourne la RLS.

-- Hors Supabase (tests locaux) : rôles et schéma auth minimaux pour que la migration s'applique
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_user (
  user_id  uuid PRIMARY KEY,           -- auth.users.id
  email    text,
  role     text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer'))
);

CREATE OR REPLACE FUNCTION is_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_user WHERE user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_user WHERE user_id = auth.uid() AND role = 'admin')
$$;

-- Lecture pour les membres, écriture pour les admins
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['app_setting', 'observed_property', 'place', 'device', 'device_channel',
                             'series', 'deployment', 'reading', 'reading_day', 'correction',
                             'annotation', 'device_sync', 'maintenance_log', 'app_user']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS member_read ON %I', tbl);
    EXECUTE format('CREATE POLICY member_read ON %I FOR SELECT TO authenticated USING (is_member())', tbl);
    EXECUTE format('DROP POLICY IF EXISTS admin_write ON %I', tbl);
    EXECUTE format('CREATE POLICY admin_write ON %I FOR ALL TO authenticated '
                   'USING (is_admin()) WITH CHECK (is_admin())', tbl);
  END LOOP;
END $$;

-- Les vues lisent avec les droits de l'appelant (RLS appliquée)
ALTER VIEW reading_all SET (security_invoker = true);
ALTER VIEW observation SET (security_invoker = true);

-- Fonctions réservées au collecteur et à la maintenance
REVOKE EXECUTE ON FUNCTION ingest_readings(text, text, text[], jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_sync_error(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION collect_targets(interval) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ensure_channels(int, int, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION compact_readings(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION simplify_old(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION run_maintenance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_readings(text, text, text[], jsonb, timestamptz, timestamptz),
                          record_sync_error(text, text, timestamptz), collect_targets(interval),
                          run_maintenance(), stats() TO service_role;

-- Points d'entrée de l'interface d'administration
CREATE OR REPLACE FUNCTION admin_stats() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Accès réservé aux administrateurs'; END IF;
  RETURN stats();
END $$;

CREATE OR REPLACE FUNCTION admin_run_maintenance() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Accès réservé aux administrateurs'; END IF;
  RETURN run_maintenance();
END $$;

REVOKE EXECUTE ON FUNCTION admin_stats(), admin_run_maintenance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_stats(), admin_run_maintenance() TO authenticated;
