-- MobAlPlus : performance des règles d'accès (Row Level Security)
--
-- Les règles appelaient is_member() / is_admin() pour chaque ligne lue : plusieurs secondes pour une
-- courbe de quelques jours, au-delà de la limite de durée des requêtes Supabase (statement timeout).
-- Écrites « (SELECT is_member()) », elles ne sont évaluées qu'une fois par requête (InitPlan).

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['app_setting', 'observed_property', 'place', 'device', 'device_channel',
                             'series', 'deployment', 'reading', 'reading_day', 'correction',
                             'annotation', 'device_sync', 'maintenance_log', 'app_user']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS member_read ON %I', tbl);
    EXECUTE format('CREATE POLICY member_read ON %I FOR SELECT TO authenticated USING ((SELECT is_member()))', tbl);
    EXECUTE format('DROP POLICY IF EXISTS admin_write ON %I', tbl);
    EXECUTE format('CREATE POLICY admin_write ON %I FOR ALL TO authenticated '
                   'USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()))', tbl);
  END LOOP;
END $$;
