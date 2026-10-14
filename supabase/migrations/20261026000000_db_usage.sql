-- Suivi de l'occupation de la base (offre gratuite : 500 Mo) : détail par maison, emplacement et
-- capteur, et par niveau de stockage (détail récent, compacté, simplifié, prévision et normales) ;
-- alertes « info » et « importante » au-delà de seuils réglables (% du quota), vérifiées chaque
-- heure, affichées dans Admin et notifiées aux administrateurs.

INSERT INTO app_setting (key, value, label) VALUES
  ('db_alert_info_pct',    '40', 'Alerte info : occupation de la base (% du quota)'),
  ('db_alert_warning_pct', '70', 'Alerte importante : occupation de la base (% du quota)')
ON CONFLICT (key) DO NOTHING;

-- Alertes de la plateforme (pas liées à un capteur) : une seule ouverte par type
CREATE TABLE IF NOT EXISTS system_alert (
  id           serial PRIMARY KEY,
  kind         text NOT NULL,                   -- db_quota
  level        text NOT NULL CHECK (level IN ('info', 'warning')),
  value        real,                            -- db_quota : % du quota
  threshold    real,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  notified_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS system_alert_open_idx ON system_alert (kind) WHERE ended_at IS NULL;
ALTER TABLE system_alert ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_read ON system_alert;
CREATE POLICY admin_read ON system_alert FOR SELECT TO authenticated USING ((SELECT is_admin()));

CREATE OR REPLACE FUNCTION setting_num(p_key text) RETURNS real
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN jsonb_typeof(value) IN ('number', 'string') AND (value #>> '{}') ~ '^[0-9.]+$'
              THEN (value #>> '{}')::real END
  FROM app_setting WHERE key = p_key
$$;

-- Occupation de la base par rapport au quota : ouvre, change de niveau ou ferme l'alerte. Une marge
-- de 2 points évite les allers-retours autour d'un seuil. p_bytes : taille imposée (tests).
CREATE OR REPLACE FUNCTION check_db_quota(p_now timestamptz DEFAULT now(), p_bytes bigint DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_quota real := coalesce(setting_num('db_quota_mb'), 500);
  v_info real := setting_num('db_alert_info_pct');
  v_warn real := setting_num('db_alert_warning_pct');
  v_pct real := coalesce(p_bytes, pg_database_size(current_database())) / (v_quota * 1024 * 1024) * 100;
  v_level text;
  v_open system_alert;
BEGIN
  v_level := CASE WHEN v_warn IS NOT NULL AND v_pct >= v_warn THEN 'warning'
                  WHEN v_info IS NOT NULL AND v_pct >= v_info THEN 'info' END;
  SELECT * INTO v_open FROM system_alert WHERE kind = 'db_quota' AND ended_at IS NULL;
  -- Juste sous le seuil de l'alerte en cours : elle reste ouverte
  IF v_open.id IS NOT NULL AND v_pct >= v_open.threshold - 2
     AND (v_level IS NULL OR (v_level = 'info' AND v_open.level = 'warning')) THEN
    v_level := v_open.level;
  END IF;
  IF v_open.id IS NOT NULL AND v_level IS DISTINCT FROM v_open.level THEN
    UPDATE system_alert SET ended_at = p_now WHERE id = v_open.id;
    v_open := NULL;
  END IF;
  IF v_level IS NOT NULL THEN
    IF v_open.id IS NULL THEN
      INSERT INTO system_alert (kind, level, value, threshold, started_at)
      VALUES ('db_quota', v_level, v_pct, CASE v_level WHEN 'warning' THEN v_warn ELSE v_info END, p_now);
    ELSE
      UPDATE system_alert SET value = v_pct WHERE id = v_open.id;
    END IF;
  END IF;
  RETURN v_level;
END $$;

-- Notifications des alertes de la plateforme : administrateurs abonnés (téléphone, ordinateur)
CREATE OR REPLACE FUNCTION pending_system_notifications(p_max_age interval DEFAULT interval '3 hours')
RETURNS TABLE (alert_id int, kind text, level text, value real, threshold real, endpoint text, p256dh text, auth text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.kind, a.level, a.value, a.threshold, ps.endpoint, ps.p256dh, ps.auth
  FROM system_alert a
  JOIN push_subscription ps ON ps.user_id IN (SELECT user_id FROM app_user WHERE role = 'admin' AND user_id IS NOT NULL)
  WHERE a.notified_at IS NULL AND a.ended_at IS NULL AND a.started_at > now() - p_max_age
  ORDER BY a.id
$$;

CREATE OR REPLACE FUNCTION mark_system_notified(p_ids int[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE system_alert SET notified_at = now() WHERE id = ANY (p_ids) AND notified_at IS NULL
$$;

-- Occupation détaillée, pour Admin › Base de données : taille totale, quota et seuils, alerte en
-- cours, et pour chaque canal de capteur l'estimation de sa place par niveau de stockage (taille de
-- chaque table répartie au prorata des lignes, ou des octets des tableaux compactés), avec son
-- capteur, son emplacement actuel et sa maison ; maisons (propriétaires) et maisons qui suivent
-- chaque emplacement partagé.
CREATE OR REPLACE FUNCTION admin_db_usage() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reading bigint := pg_total_relation_size('reading');
  v_day bigint := pg_total_relation_size('reading_day');
  v_fc bigint := pg_total_relation_size('forecast');
  v_norm bigint := pg_total_relation_size('normal');
  v_out jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Accès réservé aux administrateurs'; END IF;
  WITH r AS (SELECT channel_id, count(*) AS n FROM reading GROUP BY 1),
  d AS (SELECT channel_id, simplified, count(*) AS days, sum(cardinality(v)) AS n,
               sum(pg_column_size(t) + pg_column_size(v) + 40) AS bytes
        FROM reading_day GROUP BY 1, 2),
  f AS (SELECT channel_id, count(*) AS n FROM forecast GROUP BY 1),
  nr AS (SELECT channel_id, count(*) AS n FROM normal GROUP BY 1),
  tot AS (SELECT (SELECT sum(n) FROM r) AS r, (SELECT sum(bytes) FROM d) AS d, (SELECT sum(n) FROM f) AS f, (SELECT sum(n) FROM nr) AS nr),
  ch AS (
    SELECT c.id AS channel_id, c.channel_no, op.code AS property, dev.id AS device_id, coalesce(dev.name, dev.ma_name, dev.ma_id) AS device_name,
           dev.vendor, dev.active, dev.home_id,
           (SELECT s.place_id FROM deployment dp JOIN series s ON s.id = dp.series_id
             WHERE dp.channel_id = c.id ORDER BY upper_inf(dp.valid) DESC, upper(dp.valid) DESC LIMIT 1) AS place_id,
           coalesce(r.n, 0) AS n_detail,
           coalesce((SELECT n FROM d WHERE d.channel_id = c.id AND NOT simplified), 0) AS n_compact,
           coalesce((SELECT n FROM d WHERE d.channel_id = c.id AND simplified), 0) AS n_simplified,
           CASE WHEN tot.r > 0 THEN v_reading * coalesce(r.n, 0) / tot.r ELSE 0 END AS b_detail,
           CASE WHEN tot.d > 0 THEN v_day * coalesce((SELECT bytes FROM d WHERE d.channel_id = c.id AND NOT simplified), 0) / tot.d ELSE 0 END AS b_compact,
           CASE WHEN tot.d > 0 THEN v_day * coalesce((SELECT bytes FROM d WHERE d.channel_id = c.id AND simplified), 0) / tot.d ELSE 0 END AS b_simplified,
           (CASE WHEN tot.f > 0 THEN v_fc * coalesce(f.n, 0) / tot.f ELSE 0 END)
             + (CASE WHEN tot.nr > 0 THEN v_norm * coalesce(nr.n, 0) / tot.nr ELSE 0 END) AS b_weather
    FROM device_channel c
    JOIN device dev ON dev.id = c.device_id
    JOIN observed_property op ON op.id = c.property_id
    CROSS JOIN tot
    LEFT JOIN r ON r.channel_id = c.id
    LEFT JOIN f ON f.channel_id = c.id
    LEFT JOIN nr ON nr.channel_id = c.id
  )
  SELECT jsonb_build_object(
    'total_bytes', pg_database_size(current_database()),
    'quota_mb', coalesce(setting_num('db_quota_mb'), 500),
    'info_pct', setting_num('db_alert_info_pct'),
    'warning_pct', setting_num('db_alert_warning_pct'),
    'tables', jsonb_build_object('reading', v_reading, 'reading_day', v_day, 'forecast', v_fc, 'normal', v_norm),
    'alert', (SELECT to_jsonb(a) FROM system_alert a WHERE kind = 'db_quota' AND ended_at IS NULL),
    'channels', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'channel_id', ch.channel_id, 'channel_no', ch.channel_no, 'property', ch.property, 'device_id', ch.device_id,
        'device_name', ch.device_name, 'vendor', ch.vendor, 'active', ch.active, 'home_id', ch.home_id,
        'place_id', ch.place_id, 'place_name', (SELECT name FROM place WHERE id = ch.place_id),
        'n_detail', ch.n_detail, 'n_compact', ch.n_compact, 'n_simplified', ch.n_simplified,
        'detail', ch.b_detail, 'compact', ch.b_compact, 'simplified', ch.b_simplified, 'weather', ch.b_weather)
        ORDER BY ch.home_id, ch.device_name, ch.channel_no) FROM ch), '[]'),
    'homes', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', h.id, 'name', h.name, 'commons', h.commons,
        'owners', coalesce((SELECT jsonb_agg(m.email ORDER BY m.email) FROM home_member m WHERE m.home_id = h.id AND m.role = 'owner'), '[]'))
        ORDER BY h.commons, h.name) FROM home h), '[]'),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('place_id', l.place_id, 'home_id', l.home_id)) FROM place_link l), '[]')
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE EXECUTE ON FUNCTION setting_num(text), check_db_quota(timestamptz, bigint), pending_system_notifications(interval),
  mark_system_notified(int[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_db_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_db_usage() TO authenticated;

-- Vérification chaque heure (minute 23)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron indisponible : vérification du quota non planifiée';
    RETURN;
  END IF;
  PERFORM cron.schedule('mobalplus-quota', '23 * * * *', 'SELECT public.check_db_quota()');
END $$;
