-- Prévisions météo des stations virtuelles (Open-Meteo) : prévision horaire des 7 prochains jours,
-- par canal, remplacée à chaque collecte (Edge Function « weather »). Les mesures passées restent
-- dans reading ; la prévision prolonge la même courbe dans le futur.
-- Alertes sur prévision : fc_above / fc_below, valeur prévue au-delà du seuil dans les 24 heures
-- (anticiper chaleur, gel… et plus tard déclencher des actions : volets, fenêtres).

CREATE TABLE IF NOT EXISTS forecast (
  channel_id  int NOT NULL REFERENCES device_channel(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  value       real NOT NULL,
  issued_at   timestamptz NOT NULL,      -- collecte qui a fourni cette prévision
  PRIMARY KEY (channel_id, ts)
);
ALTER TABLE forecast ENABLE ROW LEVEL SECURITY;  -- lecture par series_forecast() seulement

-- Prévision d'une station : remplace les heures à venir (et oublie les prévisions de plus de 2 jours)
CREATE OR REPLACE FUNCTION store_forecast(p_ma_id text, p_rows jsonb, p_issued_at timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dev int;
  v_min timestamptz;
  n int;
BEGIN
  SELECT id INTO v_dev FROM device WHERE ma_id = p_ma_id AND vendor = 'open_meteo';
  IF v_dev IS NULL THEN RAISE EXCEPTION 'Station météo inconnue : %', p_ma_id; END IF;
  SELECT min((x->>'ts')::timestamptz) INTO v_min FROM jsonb_array_elements(coalesce(p_rows, '[]')) x;
  DELETE FROM forecast f USING device_channel c
   WHERE c.id = f.channel_id AND c.device_id = v_dev
     AND (f.ts >= coalesce(v_min, 'infinity') OR f.ts < p_issued_at - interval '2 days');
  INSERT INTO forecast (channel_id, ts, value, issued_at)
  SELECT c.id, (x->>'ts')::timestamptz, (x->'v'->>(c.channel_no - 1)::int)::real, p_issued_at
  FROM jsonb_array_elements(coalesce(p_rows, '[]')) x
  JOIN device_channel c ON c.device_id = v_dev
  WHERE x->'v'->>(c.channel_no - 1)::int IS NOT NULL
  ON CONFLICT (channel_id, ts) DO UPDATE SET value = excluded.value, issued_at = excluded.issued_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Prévision d'une série (canal affecté actuellement)
CREATE OR REPLACE FUNCTION forecast_of(p_series int)
RETURNS TABLE (ts timestamptz, value real, issued_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.ts, f.value, f.issued_at FROM deployment d JOIN forecast f ON f.channel_id = d.channel_id
  WHERE d.series_id = p_series AND deployment_is_current(d.valid)
$$;

-- Prévisions de plusieurs séries sur une période (séries accessibles au compte connecté)
CREATE OR REPLACE FUNCTION series_forecast(p_series int[], p_from timestamptz, p_to timestamptz)
RETURNS TABLE (series_id int, ts timestamptz, value real, issued_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s, f.ts, f.value, f.issued_at
  FROM unnest(p_series) s CROSS JOIN LATERAL forecast_of(s) f
  WHERE (trusted_caller() OR s = ANY (my_series_ids())) AND f.ts BETWEEN p_from AND p_to
  ORDER BY 1, 2
$$;

ALTER TABLE alert_event ADD COLUMN IF NOT EXISTS forecast_at timestamptz;  -- prévision : heure prévue du franchissement

ALTER TABLE alert_rule DROP CONSTRAINT IF EXISTS alert_rule_kind_check;
ALTER TABLE alert_rule ADD CONSTRAINT alert_rule_kind_check
  CHECK (kind IN ('above', 'below', 'peak', 'trough', 'silent', 'gap_above', 'gap_below', 'rise', 'fall',
                  'fc_above', 'fc_below'));

-- Alertes sur prévision : valeur prévue au-delà du seuil dans les 24 prochaines heures. L'alerte
-- s'ouvre dès que la prévision l'annonce (heure prévue et valeur extrême mises à jour à chaque
-- prévision), se ferme quand la prévision ne l'annonce plus ; rouverte si elle revient dans les 3 h.
CREATE OR REPLACE FUNCTION evaluate_forecast_alerts(p_now timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_hit record;
  v_open alert_event;
  v_sign int;
  n int := 0;
BEGIN
  FOR r IN SELECT ar.* FROM alert_rule ar WHERE ar.enabled AND ar.kind IN ('fc_above', 'fc_below') LOOP
    v_sign := CASE WHEN r.kind = 'fc_above' THEN 1 ELSE -1 END;
    SELECT count(*) AS n,
           min(f.ts) FILTER (WHERE v_sign * (f.value - r.threshold) > 0) AS first_ts,
           CASE WHEN v_sign > 0 THEN max(f.value) ELSE min(f.value) END AS extreme
      INTO v_hit
      FROM forecast_of(r.series_id) f
     WHERE f.ts > p_now AND f.ts <= p_now + interval '24 hours';
    CONTINUE WHEN v_hit.n = 0;  -- pas de prévision : rien à conclure
    SELECT * INTO v_open FROM alert_event WHERE rule_id = r.id AND ended_at IS NULL;
    IF v_hit.first_ts IS NOT NULL THEN
      IF v_open.id IS NULL THEN
        SELECT * INTO v_open FROM alert_event
         WHERE rule_id = r.id AND ended_at > p_now - interval '3 hours' ORDER BY ended_at DESC LIMIT 1;
        IF v_open.id IS NOT NULL THEN
          UPDATE alert_event SET ended_at = NULL, forecast_at = v_hit.first_ts, value = v_hit.extreme WHERE id = v_open.id;
        ELSE
          INSERT INTO alert_event (rule_id, series_id, kind, level, threshold, started_at, value, forecast_at)
          VALUES (r.id, r.series_id, r.kind, r.level, r.threshold, p_now, v_hit.extreme, v_hit.first_ts);
          n := n + 1;
        END IF;
      ELSE
        UPDATE alert_event SET forecast_at = v_hit.first_ts, value = v_hit.extreme WHERE id = v_open.id;
      END IF;
    ELSIF v_open.id IS NOT NULL THEN
      UPDATE alert_event SET ended_at = p_now WHERE id = v_open.id;  -- plus annoncé
    END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION evaluate_alerts(p_now timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_last record;
  v_ext record;
  v_open alert_event;
  v_sign int;
  v_hold interval := interval '2 hours';
  v_rearm interval := interval '1 hour';
  v_res real;
  v_t real;
  v_start timestamptz;
  v_before real;
  n int := 0;
  v_seen timestamptz;
BEGIN
  FOR r IN
    SELECT ar.*, op.code AS prop
    FROM alert_rule ar JOIN series s ON s.id = ar.series_id JOIN observed_property op ON op.id = s.property_id
    WHERE ar.enabled AND ar.kind NOT IN ('fc_above', 'fc_below')
  LOOP
    -- Capteur muet : plus aucune mesure reçue depuis « threshold » heures (piles, portée)
    IF r.kind = 'silent' THEN
      SELECT max(ds.last_ts) INTO v_seen
        FROM deployment d
        JOIN device_channel c ON c.id = d.channel_id
        JOIN device dv ON dv.id = c.device_id AND dv.active
        JOIN device_sync ds ON ds.device_id = dv.id
       WHERE d.series_id = r.series_id AND deployment_is_current(d.valid);
      CONTINUE WHEN v_seen IS NULL;  -- jamais reçu de mesure : rien à signaler
      SELECT * INTO v_open FROM alert_event WHERE rule_id = r.id AND ended_at IS NULL;
      IF p_now - v_seen > make_interval(secs => r.threshold * 3600) THEN
        IF v_open.id IS NULL THEN
          INSERT INTO alert_event (rule_id, series_id, kind, level, threshold, started_at)
          VALUES (r.id, r.series_id, 'silent', r.level, r.threshold, v_seen);
          n := n + 1;
        END IF;
      ELSIF v_open.id IS NOT NULL THEN
        UPDATE alert_event SET ended_at = v_seen WHERE id = v_open.id;  -- le capteur émet de nouveau
      END IF;
      CONTINUE;
    END IF;

    v_sign := CASE WHEN r.kind IN ('below', 'trough') THEN -1 ELSE 1 END;
    v_res := alert_resolution(r.prop);
    CREATE TEMP TABLE IF NOT EXISTS alert_obs (ts timestamptz, value real) ON COMMIT DROP;
    TRUNCATE alert_obs;
    IF r.kind IN ('gap_above', 'gap_below', 'rise', 'fall') THEN
      -- Écart ou variation horaire : dépassement de seuil sur la courbe dérivée
      INSERT INTO alert_obs SELECT d.ts, d.value FROM alert_derived(r.kind, r.series_id, r.ref_series_id, p_now) d;
    ELSE
      INSERT INTO alert_obs
        SELECT o.ts, o.value FROM series_observations(r.series_id, p_now - interval '6 hours', p_now + interval '1 second') o
        WHERE o.quality <> 'rejected';
    END IF;
    SELECT * INTO v_last FROM alert_obs ORDER BY ts DESC LIMIT 1;
    CONTINUE WHEN v_last IS NULL;

    IF r.kind NOT IN ('peak', 'trough') THEN
      SELECT * INTO v_open FROM alert_event WHERE rule_id = r.id AND ended_at IS NULL;
      IF v_sign * (v_last.value - r.threshold) > 0 THEN
        -- Retour au-delà du seuil moins d'une heure après la fin de la précédente alerte (valeur qui
        -- oscille autour du seuil) : on rouvre cette alerte plutôt que d'en créer (et notifier) une autre
        IF v_open.id IS NULL THEN
          SELECT * INTO v_open FROM alert_event
           WHERE rule_id = r.id AND ended_at > v_last.ts - v_rearm ORDER BY ended_at DESC LIMIT 1;
          IF v_open.id IS NOT NULL THEN
            UPDATE alert_event SET ended_at = NULL,
                   value = CASE WHEN v_sign > 0 THEN greatest(value, v_last.value) ELSE least(value, v_last.value) END
             WHERE id = v_open.id;
            CONTINUE;
          END IF;
        END IF;
        IF v_open.id IS NULL THEN
          -- Début du dépassement en cours : première mesure après la dernière mesure en deçà
          SELECT min(ts) INTO v_start FROM alert_obs
           WHERE ts > coalesce((SELECT max(ts) FROM alert_obs WHERE v_sign * (value - r.threshold) <= 0), '-infinity');
          INSERT INTO alert_event (rule_id, series_id, kind, level, threshold, started_at, value, ref_series_id)
          VALUES (r.id, r.series_id, r.kind, r.level, r.threshold, coalesce(v_start, v_last.ts),
                  (SELECT CASE WHEN v_sign > 0 THEN max(value) ELSE min(value) END FROM alert_obs
                    WHERE ts >= coalesce(v_start, v_last.ts)), r.ref_series_id);
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

  -- Alertes sur prévision (stations météo)
  n := n + evaluate_forecast_alerts(p_now);

  -- Règle supprimée ou désactivée : ses alertes en cours sont closes
  UPDATE alert_event e SET ended_at = p_now
   WHERE e.ended_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM alert_rule ar WHERE ar.id = e.rule_id AND ar.enabled);
  RETURN n;
END $$;

-- Notifications : heure prévue (alertes sur prévision) en plus
DROP FUNCTION IF EXISTS pending_notifications(interval);
CREATE FUNCTION pending_notifications(p_max_age interval DEFAULT interval '3 hours')
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
  JOIN home_member m ON m.home_id = p.home_id AND m.user_id IS NOT NULL
  JOIN push_subscription ps ON ps.user_id = m.user_id
  LEFT JOIN series rs ON rs.id = e.ref_series_id
  LEFT JOIN place rp ON rp.id = rs.place_id
  WHERE e.notified_at IS NULL AND e.created_at > now() - p_max_age
    AND (ps.min_level = 'info' OR e.level = 'warning')
  ORDER BY e.id
$$;

REVOKE EXECUTE ON FUNCTION store_forecast(text, jsonb, timestamptz), forecast_of(int),
  evaluate_forecast_alerts(timestamptz), pending_notifications(interval) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION series_forecast(int[], timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION series_forecast(int[], timestamptz, timestamptz) TO authenticated;
