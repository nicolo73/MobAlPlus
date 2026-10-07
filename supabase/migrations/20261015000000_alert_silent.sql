-- Alerte « capteur muet » : plus aucune mesure reçue depuis un nombre d'heures donné (seuil en
-- heures). L'alerte commence à la dernière mesure reçue et se ferme dès que le capteur émet de
-- nouveau. Une seule alerte par silence (et donc une seule notification).

ALTER TABLE alert_rule DROP CONSTRAINT IF EXISTS alert_rule_kind_check;
ALTER TABLE alert_rule ADD CONSTRAINT alert_rule_kind_check
  CHECK (kind IN ('above', 'below', 'peak', 'trough', 'silent'));

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
    WHERE ar.enabled
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
