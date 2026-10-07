-- Alertes de comparaison et de pente :
--  - gap_above / gap_below : la série est plus haute (plus basse) qu'une autre série de la même
--    grandeur (ref_series_id, autre emplacement) de plus de « threshold » (« plus chaud dehors que
--    dedans » : Extérieur plus haut que Salon de plus de 0 °C) ;
--  - rise / fall : la valeur monte (baisse) de plus de « threshold » par heure (variation sur la
--    dernière heure).
-- Les deux s'évaluent comme un dépassement de seuil sur une courbe dérivée (écart, ou variation
-- horaire) : même hystérésis, même réarmement, une alerte (et une notification) par épisode.

ALTER TABLE alert_rule ADD COLUMN IF NOT EXISTS ref_series_id int REFERENCES series(id) ON DELETE CASCADE;
-- Sans clé étrangère : l'API garde une seule relation alert_event → series (celle de la série alertée)
ALTER TABLE alert_event ADD COLUMN IF NOT EXISTS ref_series_id int;

ALTER TABLE alert_rule DROP CONSTRAINT IF EXISTS alert_rule_kind_check;
ALTER TABLE alert_rule ADD CONSTRAINT alert_rule_kind_check
  CHECK (kind IN ('above', 'below', 'peak', 'trough', 'silent', 'gap_above', 'gap_below', 'rise', 'fall'));
ALTER TABLE alert_rule DROP CONSTRAINT IF EXISTS alert_rule_ref_check;
ALTER TABLE alert_rule ADD CONSTRAINT alert_rule_ref_check
  CHECK ((kind IN ('gap_above', 'gap_below')) = (ref_series_id IS NOT NULL) AND ref_series_id IS DISTINCT FROM series_id);

-- Courbe dérivée d'une règle de comparaison ou de pente, sur les 6 dernières heures : à chaque mesure,
-- écart avec la série de référence (dernières valeurs connues de chacune, de moins de 3 h), ou
-- variation depuis la valeur d'il y a une heure. Toujours orientée « plus grand = plus d'alerte ».
CREATE OR REPLACE FUNCTION alert_derived(p_kind text, p_series int, p_ref int, p_now timestamptz)
RETURNS TABLE (ts timestamptz, value real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (
    SELECT o.ts, o.value FROM series_observations(p_series, p_now - interval '10 hours', p_now + interval '1 second') o
    WHERE o.quality <> 'rejected'
  ), b AS (
    SELECT o.ts, o.value FROM series_observations(p_ref, p_now - interval '10 hours', p_now + interval '1 second') o
    WHERE o.quality <> 'rejected' AND p_kind IN ('gap_above', 'gap_below')
  ), t AS (
    SELECT a.ts FROM a UNION SELECT b.ts FROM b
  )
  SELECT t.ts,
         (CASE p_kind WHEN 'gap_above' THEN av.value - bv.value
                      WHEN 'gap_below' THEN bv.value - av.value
                      WHEN 'rise' THEN av.value - pv.value
                      ELSE pv.value - av.value END)::real
  FROM t
  CROSS JOIN LATERAL (SELECT a.ts, a.value FROM a WHERE a.ts <= t.ts ORDER BY a.ts DESC LIMIT 1) av
  LEFT JOIN LATERAL (SELECT b.ts, b.value FROM b WHERE b.ts <= t.ts ORDER BY b.ts DESC LIMIT 1) bv ON true
  LEFT JOIN LATERAL (SELECT a.ts, a.value FROM a WHERE a.ts <= t.ts - interval '1 hour' ORDER BY a.ts DESC LIMIT 1) pv ON true
  WHERE t.ts >= p_now - interval '6 hours'
    AND t.ts - av.ts <= interval '3 hours'
    AND CASE WHEN p_kind IN ('gap_above', 'gap_below') THEN t.ts - bv.ts <= interval '3 hours'
             ELSE t.ts - pv.ts <= interval '4 hours' END
$$;
REVOKE EXECUTE ON FUNCTION alert_derived(text, int, int, timestamptz) FROM PUBLIC, anon, authenticated;

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

  -- Règle supprimée ou désactivée : ses alertes en cours sont closes
  UPDATE alert_event e SET ended_at = p_now
   WHERE e.ended_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM alert_rule ar WHERE ar.id = e.rule_id AND ar.enabled);
  RETURN n;
END $$;

-- Remplace les règles d'une série (droits « gestion ») ; la série de référence d'une comparaison
-- doit être de la même grandeur et accessible en gestion
CREATE OR REPLACE FUNCTION set_alert_rules(p_series int, p_rules jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (trusted_caller() OR p_series = ANY (my_series_ids('editor'))) THEN
    RAISE EXCEPTION 'Droits insuffisants sur cet emplacement';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_rules, '[]')) x
    LEFT JOIN series rs ON rs.id = (x->>'ref_series_id')::int
    JOIN series s ON s.id = p_series
    WHERE x->>'ref_series_id' IS NOT NULL
      AND (rs.id IS NULL OR rs.property_id <> s.property_id
           OR NOT (trusted_caller() OR rs.id = ANY (my_series_ids('editor'))))
  ) THEN
    RAISE EXCEPTION 'Comparaison impossible : emplacement de référence introuvable ou d''une autre grandeur';
  END IF;
  DELETE FROM alert_rule WHERE series_id = p_series
    AND (kind, level) NOT IN (SELECT x->>'kind', x->>'level' FROM jsonb_array_elements(coalesce(p_rules, '[]')) x);
  INSERT INTO alert_rule (series_id, kind, level, threshold, enabled, ref_series_id)
  SELECT p_series, x->>'kind', x->>'level', (x->>'threshold')::real, coalesce((x->>'enabled')::boolean, true),
         (x->>'ref_series_id')::int
  FROM jsonb_array_elements(coalesce(p_rules, '[]')) x
  ON CONFLICT (series_id, kind, level) DO UPDATE
    SET threshold = excluded.threshold, enabled = excluded.enabled, ref_series_id = excluded.ref_series_id;
  -- Seuil (ou référence) modifié : l'alerte en cours est close, la suivante repartira du nouveau réglage
  UPDATE alert_event e SET ended_at = now()
   WHERE e.series_id = p_series AND e.ended_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM alert_rule ar WHERE ar.id = e.rule_id AND ar.enabled
                     AND ar.threshold IS NOT DISTINCT FROM e.threshold
                     AND ar.ref_series_id IS NOT DISTINCT FROM e.ref_series_id);
END $$;

-- Notifications : nom de l'emplacement de référence en plus
DROP FUNCTION IF EXISTS pending_notifications(interval);
CREATE FUNCTION pending_notifications(p_max_age interval DEFAULT interval '3 hours')
RETURNS TABLE (event_id bigint, kind text, level text, value real, threshold real, started_at timestamptz,
               place_id int, place_name text, property text, unit text,
               endpoint text, p256dh text, auth text, ref_place_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.kind, e.level, e.value, e.threshold, e.started_at, p.id, p.name, op.code, op.unit,
         ps.endpoint, ps.p256dh, ps.auth, rp.name
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
REVOKE EXECUTE ON FUNCTION pending_notifications(interval) FROM PUBLIC, anon, authenticated;
