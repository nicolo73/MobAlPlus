-- Alertes : seuils hauts / bas et pics / creux, par série (emplacement × grandeur), sur deux
-- niveaux (« info » et « important »). Évaluées toutes les 10 minutes après la collecte ; les
-- alertes peuvent être notifiées sur téléphone (Web Push, Edge Function « notify »).

CREATE TABLE IF NOT EXISTS alert_rule (
  id          serial PRIMARY KEY,
  series_id   int NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('above', 'below', 'peak', 'trough')),
  level       text NOT NULL CHECK (level IN ('info', 'warning')),
  -- above / below : seuil ; peak / trough : montée minimale avant le pic (NULL = valeur par défaut)
  threshold   real,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_id, kind, level),
  CHECK (kind IN ('peak', 'trough') OR threshold IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS alert_event (
  id           bigserial PRIMARY KEY,
  rule_id      int REFERENCES alert_rule(id) ON DELETE SET NULL,
  series_id    int NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  level        text NOT NULL,
  threshold    real,
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz,            -- NULL : dépassement en cours ; pic / creux : = started_at
  value        real,                   -- valeur extrême atteinte
  notified_at  timestamptz,            -- notification envoyée (ou abandonnée)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_event_series_idx ON alert_event (series_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS alert_event_open_idx ON alert_event (rule_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS alert_event_pending_idx ON alert_event (created_at) WHERE notified_at IS NULL;

-- Alertes masquées (archivées) : propre à chaque compte
CREATE TABLE IF NOT EXISTS alert_archive (
  event_id     bigint NOT NULL REFERENCES alert_event(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL DEFAULT auth.uid(),
  archived_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- Abonnements aux notifications (un par appareil)
CREATE TABLE IF NOT EXISTS push_subscription (
  id          serial PRIMARY KEY,
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  min_level   text NOT NULL DEFAULT 'warning' CHECK (min_level IN ('info', 'warning')),
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Règles d'accès
ALTER TABLE alert_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_read ON alert_rule;
DROP POLICY IF EXISTS editor_write ON alert_rule;
CREATE POLICY member_read ON alert_rule FOR SELECT TO authenticated
  USING (series_id = ANY ((SELECT my_series_ids())::int[]));
CREATE POLICY editor_write ON alert_rule FOR ALL TO authenticated
  USING (series_id = ANY ((SELECT my_series_ids('editor'))::int[]))
  WITH CHECK (series_id = ANY ((SELECT my_series_ids('editor'))::int[]));

DROP POLICY IF EXISTS member_read ON alert_event;
DROP POLICY IF EXISTS editor_delete ON alert_event;
CREATE POLICY member_read ON alert_event FOR SELECT TO authenticated
  USING (series_id = ANY ((SELECT my_series_ids())::int[]));
CREATE POLICY editor_delete ON alert_event FOR DELETE TO authenticated
  USING (series_id = ANY ((SELECT my_series_ids('editor'))::int[]));

DROP POLICY IF EXISTS own_rows ON alert_archive;
CREATE POLICY own_rows ON alert_archive FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND event_id IN (SELECT id FROM alert_event));

DROP POLICY IF EXISTS own_rows ON push_subscription;
CREATE POLICY own_rows ON push_subscription FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- Valeurs par défaut des pics / creux (mêmes règles que les flèches de tendance de l'application)
CREATE OR REPLACE FUNCTION alert_peak_default(p_prop text) RETURNS real
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE p_prop WHEN 'temperature' THEN 0.3 WHEN 'humidity' THEN 3 ELSE 0.5 END::real $$;
CREATE OR REPLACE FUNCTION alert_resolution(p_prop text) RETURNS real
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE p_prop WHEN 'temperature' THEN 0.1 WHEN 'humidity' THEN 1 ELSE 0 END::real $$;

-- Évaluation de toutes les règles actives. Renvoie le nombre d'alertes ouvertes.
--  - above / below : alerte ouverte au premier dépassement, mise à jour de la valeur extrême,
--    fermée quand la valeur revient en deçà du seuil d'au moins un pas de mesure (hystérésis) ;
--  - peak / trough : pic dépassé de la montée minimale avant, suivi d'une baisse d'au moins la
--    moitié (et de deux pas de mesure) ; une alerte par pic.
CREATE OR REPLACE FUNCTION evaluate_alerts(p_now timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_last record;
  v_ext record;
  v_open alert_event;
  v_sign int;
  v_hold interval := interval '2 hours';
  v_res real;
  v_t real;
  v_start timestamptz;
  v_before real;
  n int := 0;
BEGIN
  FOR r IN
    SELECT ar.*, op.code AS prop
    FROM alert_rule ar JOIN series s ON s.id = ar.series_id JOIN observed_property op ON op.id = s.property_id
    WHERE ar.enabled
  LOOP
    v_sign := CASE WHEN r.kind IN ('above', 'peak') THEN 1 ELSE -1 END;
    v_res := alert_resolution(r.prop);
    CREATE TEMP TABLE IF NOT EXISTS alert_obs (ts timestamptz, value real) ON COMMIT DROP;
    TRUNCATE alert_obs;
    INSERT INTO alert_obs
      SELECT o.ts, o.value FROM series_observations(r.series_id, p_now - interval '6 hours', p_now + interval '1 second') o
      WHERE o.quality <> 'rejected';
    SELECT * INTO v_last FROM alert_obs ORDER BY ts DESC LIMIT 1;
    CONTINUE WHEN v_last IS NULL;

    IF r.kind IN ('above', 'below') THEN
      SELECT * INTO v_open FROM alert_event WHERE rule_id = r.id AND ended_at IS NULL;
      IF v_sign * (v_last.value - r.threshold) > 0 THEN
        IF v_open.id IS NULL THEN
          -- Début du dépassement en cours : première mesure après la dernière mesure en deçà
          SELECT min(ts) INTO v_start FROM alert_obs
           WHERE ts > coalesce((SELECT max(ts) FROM alert_obs WHERE v_sign * (value - r.threshold) <= 0), '-infinity');
          INSERT INTO alert_event (rule_id, series_id, kind, level, threshold, started_at, value)
          VALUES (r.id, r.series_id, r.kind, r.level, r.threshold, coalesce(v_start, v_last.ts),
                  (SELECT CASE WHEN v_sign > 0 THEN max(value) ELSE min(value) END FROM alert_obs
                    WHERE ts >= coalesce(v_start, v_last.ts)));
          n := n + 1;
        ELSE
          UPDATE alert_event SET value = CASE WHEN v_sign > 0 THEN greatest(value, v_last.value)
                                              ELSE least(value, v_last.value) END
           WHERE id = v_open.id;
        END IF;
      ELSIF v_open.id IS NOT NULL AND v_sign * (r.threshold - v_last.value) >= v_res - 1e-3 THEN
        UPDATE alert_event SET ended_at = v_last.ts WHERE id = v_open.id;
      END IF;

    ELSE
      v_t := coalesce(r.threshold, alert_peak_default(r.prop));
      -- Extrême le plus récent des 2 dernières heures (fin du palier)
      SELECT * INTO v_ext FROM alert_obs WHERE ts >= v_last.ts - v_hold
       ORDER BY v_sign * value DESC, ts DESC LIMIT 1;
      CONTINUE WHEN v_ext.ts = v_last.ts;
      SELECT v_sign * v_ext.value - min(v_sign * value) INTO v_before FROM alert_obs
       WHERE ts BETWEEN v_ext.ts - v_hold AND v_ext.ts;
      IF v_sign * (v_ext.value - v_last.value) >= greatest(v_t / 2, 2 * v_res) - 1e-3
         AND v_before >= v_t - 1e-3
         AND NOT EXISTS (SELECT 1 FROM alert_event WHERE rule_id = r.id AND started_at > v_ext.ts - v_hold) THEN
        INSERT INTO alert_event (rule_id, series_id, kind, level, threshold, started_at, ended_at, value)
        VALUES (r.id, r.series_id, r.kind, r.level, v_t, v_ext.ts, v_ext.ts, v_ext.value);
        n := n + 1;
      END IF;
    END IF;
  END LOOP;

  -- Règle supprimée ou désactivée : ses alertes en cours sont closes
  UPDATE alert_event e SET ended_at = p_now
   WHERE e.ended_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM alert_rule ar WHERE ar.id = e.rule_id AND ar.enabled);
  RETURN n;
END $$;

-- Remplace les règles d'une série (droits « gestion »)
CREATE OR REPLACE FUNCTION set_alert_rules(p_series int, p_rules jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (trusted_caller() OR p_series = ANY (my_series_ids('editor'))) THEN
    RAISE EXCEPTION 'Droits insuffisants sur cet emplacement';
  END IF;
  DELETE FROM alert_rule WHERE series_id = p_series
    AND (kind, level) NOT IN (SELECT x->>'kind', x->>'level' FROM jsonb_array_elements(coalesce(p_rules, '[]')) x);
  INSERT INTO alert_rule (series_id, kind, level, threshold, enabled)
  SELECT p_series, x->>'kind', x->>'level', (x->>'threshold')::real, coalesce((x->>'enabled')::boolean, true)
  FROM jsonb_array_elements(coalesce(p_rules, '[]')) x
  ON CONFLICT (series_id, kind, level) DO UPDATE SET threshold = excluded.threshold, enabled = excluded.enabled;
  -- Seuil modifié : l'alerte en cours est close, la suivante repartira du nouveau seuil
  UPDATE alert_event e SET ended_at = now()
   WHERE e.series_id = p_series AND e.ended_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM alert_rule ar WHERE ar.id = e.rule_id AND ar.enabled
                     AND ar.threshold IS NOT DISTINCT FROM e.threshold);
END $$;

-- Notifications à envoyer : alertes récentes non notifiées × abonnements des membres de la maison
CREATE OR REPLACE FUNCTION pending_notifications(p_max_age interval DEFAULT interval '3 hours')
RETURNS TABLE (event_id bigint, kind text, level text, value real, threshold real, started_at timestamptz,
               place_id int, place_name text, property text, unit text,
               endpoint text, p256dh text, auth text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.kind, e.level, e.value, e.threshold, e.started_at, p.id, p.name, op.code, op.unit,
         ps.endpoint, ps.p256dh, ps.auth
  FROM alert_event e
  JOIN series s ON s.id = e.series_id
  JOIN place p ON p.id = s.place_id
  JOIN observed_property op ON op.id = s.property_id
  JOIN home_member m ON m.home_id = p.home_id AND m.user_id IS NOT NULL
  JOIN push_subscription ps ON ps.user_id = m.user_id
  WHERE e.notified_at IS NULL AND e.created_at > now() - p_max_age
    AND (ps.min_level = 'info' OR e.level = 'warning')
  ORDER BY e.id
$$;

CREATE OR REPLACE FUNCTION mark_notified(p_ids bigint[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE alert_event SET notified_at = now() WHERE id = ANY (p_ids) AND notified_at IS NULL
$$;

-- Les alertes trop anciennes ne sont jamais notifiées (rattrapage après une interruption)
CREATE OR REPLACE FUNCTION expire_notifications(p_max_age interval DEFAULT interval '3 hours') RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE alert_event SET notified_at = now() WHERE notified_at IS NULL AND created_at <= now() - p_max_age
$$;

REVOKE EXECUTE ON FUNCTION evaluate_alerts(timestamptz), pending_notifications(interval), mark_notified(bigint[]),
  expire_notifications(interval) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION set_alert_rules(int, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_alert_rules(int, jsonb) TO authenticated;

-- Planification : évaluation 4 minutes après chaque collecte, puis envoi des notifications
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron indisponible : planification des alertes ignorée';
    RETURN;
  END IF;
  PERFORM cron.schedule('mobalplus-alerts', '4-59/10 * * * *', 'SELECT public.evaluate_alerts()');
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.schedule('mobalplus-notify', '5-59/10 * * * *', $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mobalplus_project_url')
               || '/functions/v1/notify',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                         WHERE name = 'mobalplus_collect_token')),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000)
    $job$);
  END IF;
END $$;
