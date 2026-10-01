-- MobAlPlus : tâches planifiées (Supabase : pg_cron + pg_net + Vault)
--
-- Collecte toutes les 10 minutes : pg_cron appelle l'Edge Function « collect » via pg_net.
-- L'URL du projet et le jeton du collecteur sont lus dans Vault au moment de l'appel ;
-- ils se créent une fois depuis l'éditeur SQL (voir docs/supabase-setup.md) :
--   select vault.create_secret('https://<projet>.supabase.co', 'mobalplus_project_url');
--   select vault.create_secret('<jeton aléatoire>', 'mobalplus_collect_token');
--
-- Hors Supabase (tests locaux), ces extensions n'existent pas et la migration ne fait rien.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron indisponible : planification ignorée';
    RETURN;
  END IF;
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- Maintenance de nuit (compactage + simplification), 03:17 UTC
  PERFORM cron.schedule('mobalplus-maintenance', '17 3 * * *', 'SELECT public.run_maintenance()');

  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
    -- Collecte incrémentale toutes les 10 minutes
    PERFORM cron.schedule('mobalplus-collect', '*/10 * * * *', format($job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mobalplus_project_url')
               || '/functions/v1/collect',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                         WHERE name = 'mobalplus_collect_token')),
        body := %L::jsonb,
        timeout_milliseconds := 150000)
    $job$, '{}'));
    -- Relecture quotidienne des 3 derniers jours : rattrape les mesures transmises en retard
    -- (passerelle hors ligne puis reconnectée). Les doublons sont ignorés.
    PERFORM cron.schedule('mobalplus-resync', '47 2 * * *', format($job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mobalplus_project_url')
               || '/functions/v1/collect',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                         WHERE name = 'mobalplus_collect_token')),
        body := %L::jsonb,
        timeout_milliseconds := 150000)
    $job$, '{"lookback_days": 3}'));
  END IF;
END $$;
