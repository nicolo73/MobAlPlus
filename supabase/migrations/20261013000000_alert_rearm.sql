-- Alertes de seuil : une seule alerte (et une seule notification) par franchissement.
-- Une alerte se ferme quand la valeur repasse le seuil d'au moins un pas de mesure ; si elle le
-- refranchit moins d'une heure après, la même alerte est rouverte (pas de nouvelle notification) :
-- une valeur qui oscille autour du seuil ne produit pas de série d'alertes.

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
