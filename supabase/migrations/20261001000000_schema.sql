-- MobAlPlus : tables (PostgreSQL >= 15, Supabase)
--
-- Principes :
--   * Le capteur physique (device / device_channel) est découplé de l'emplacement (place).
--     Une affectation datée (deployment) relie un canal de capteur à une série (series = place x grandeur).
--     Déplacer ou remplacer un capteur = clôturer une affectation et en ouvrir une autre.
--   * Les mesures brutes sont immuables et rattachées au canal, jamais à l'emplacement :
--     l'attribution à une série est calculée à la lecture.
--   * Les valeurs aberrantes ne sont jamais supprimées : elles sont marquées dans correction.
--   * Stockage en trois niveaux :
--       reading      : mesures récentes, une ligne par valeur (~84 octets / valeur)
--       reading_day  : historique compacté sans perte, une ligne par canal et par jour (~10 octets / valeur)
--       reading_day.simplified : au-delà de la durée configurée, seuls les points significatifs
--                      (extrêmes, changements de pente) sont conservés
--   * Vocabulaire aligné sur OGC SensorThings (Thing / Datastream / Observation / ObservedProperty).

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Paramètres
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_setting (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL,
  label  text
);

INSERT INTO app_setting (key, value, label) VALUES
  ('hot_days',            '90',   'Jours conservés en brut détaillé avant compactage'),
  ('simplify_after_days', '1095', 'Âge (jours) au-delà duquel seuls les points significatifs sont gardés'),
  ('timezone',            '"Europe/Paris"', 'Fuseau horaire des dates du site Mobile Alerts'),
  ('db_quota_mb',         '500',  'Quota de la base (offre gratuite Supabase)')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Référentiel
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observed_property (
  id                  smallserial PRIMARY KEY,
  code                text NOT NULL UNIQUE,      -- temperature, humidity, rain...
  name                text NOT NULL,
  unit                text NOT NULL,
  simplify_tolerance  real                       -- écart toléré par la simplification ; NULL = jamais simplifié
);

INSERT INTO observed_property (code, name, unit, simplify_tolerance) VALUES
  ('temperature', 'Température', '°C', 0.2),
  ('humidity',    'Humidité relative', '%', 2),
  ('rain',        'Pluie', 'mm', NULL),
  ('unknown',     'Grandeur inconnue', '', NULL)
ON CONFLICT (code) DO NOTHING;

-- Emplacement (pièce, zone extérieure, congélateur...), hiérarchique : Maison > RDC > Salon
CREATE TABLE IF NOT EXISTS place (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE,     -- identifiant stable utilisé dans les fichiers de config
  name       text NOT NULL,
  parent_id  int REFERENCES place(id),
  kind       text,                     -- building, room, outdoor, appliance...
  exposure   text CHECK (exposure IN ('indoor', 'outdoor', 'appliance')),
  lon        double precision,
  lat        double precision,
  plan_id    int,                      -- futur : plan indoor
  plan_x     double precision,
  plan_y     double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Capteur physique Mobile Alerts (Thing / Sensor au sens STA)
CREATE TABLE IF NOT EXISTS device (
  id          serial PRIMARY KEY,
  ma_id       text NOT NULL UNIQUE CHECK (ma_id = upper(ma_id)),
  name        text,                    -- nom local
  ma_name     text,                    -- nom renvoyé par le site Mobile Alerts
  model       text,
  active      boolean NOT NULL DEFAULT true,   -- false = retiré : plus collecté, historique conservé
  added_at    timestamptz NOT NULL DEFAULT now(),
  retired_at  timestamptz
);

-- Canal d'un capteur = une colonne du tableau Mobile Alerts (1 = 1re colonne de mesure)
CREATE TABLE IF NOT EXISTS device_channel (
  id           serial PRIMARY KEY,
  device_id    int NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  channel_no   smallint NOT NULL CHECK (channel_no >= 1),
  property_id  smallint NOT NULL REFERENCES observed_property(id),
  label        text,
  UNIQUE (device_id, channel_no)
);

-- Série affichée = emplacement x grandeur (Datastream au sens STA)
CREATE TABLE IF NOT EXISTS series (
  id           serial PRIMARY KEY,
  place_id     int NOT NULL REFERENCES place(id) ON DELETE CASCADE,
  property_id  smallint NOT NULL REFERENCES observed_property(id),
  name         text NOT NULL,
  color        text,
  UNIQUE (place_id, property_id)
);

-- Affectation datée d'un canal de capteur à une série
CREATE TABLE IF NOT EXISTS deployment (
  id          serial PRIMARY KEY,
  channel_id  int NOT NULL REFERENCES device_channel(id) ON DELETE CASCADE,
  series_id   int NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  valid       tstzrange NOT NULL CHECK (NOT isempty(valid)),
  note        text,
  EXCLUDE USING gist (channel_id WITH =, valid WITH &&),   -- un canal n'est qu'à un endroit à la fois
  EXCLUDE USING gist (series_id WITH =, valid WITH &&)     -- une série n'a qu'une source à la fois
);

-- ---------------------------------------------------------------------------
-- Mesures
-- ---------------------------------------------------------------------------

-- Niveau 1 : mesures récentes
CREATE TABLE IF NOT EXISTS reading (
  channel_id  int NOT NULL REFERENCES device_channel(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  value       real NOT NULL,
  PRIMARY KEY (channel_id, ts)
);

-- Niveaux 2 et 3 : une ligne par canal et par jour UTC ; t = secondes depuis 00:00 UTC
CREATE TABLE IF NOT EXISTS reading_day (
  channel_id  int NOT NULL REFERENCES device_channel(id) ON DELETE CASCADE,
  day         date NOT NULL,
  t           int[] NOT NULL,
  v           real[] NOT NULL,
  n_raw       int NOT NULL,              -- nombre de points avant simplification
  simplified  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (channel_id, day),
  CHECK (cardinality(t) = cardinality(v))
);

-- ---------------------------------------------------------------------------
-- Qualité et enrichissement
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS correction (
  id          serial PRIMARY KEY,
  channel_id  int NOT NULL REFERENCES device_channel(id) ON DELETE CASCADE,
  ts_range    tstzrange NOT NULL,      -- '[t,t]' pour une mesure unique
  action      text NOT NULL CHECK (action IN ('reject', 'replace')),
  value       real,
  reason      text,
  author      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (action <> 'replace' OR value IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS correction_range_idx ON correction USING gist (channel_id, ts_range);

CREATE TABLE IF NOT EXISTS annotation (
  id          serial PRIMARY KEY,
  series_id   int REFERENCES series(id) ON DELETE CASCADE,
  place_id    int REFERENCES place(id) ON DELETE CASCADE,   -- les deux NULL = annotation globale
  ts_range    tstzrange NOT NULL,
  text        text NOT NULL,
  author      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotation_range_idx ON annotation USING gist (ts_range);

-- ---------------------------------------------------------------------------
-- Collecte et maintenance
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS device_sync (
  device_id    int PRIMARY KEY REFERENCES device(id) ON DELETE CASCADE,
  last_ts      timestamptz,            -- horodatage de la dernière mesure reçue
  synced_until timestamptz,            -- fin de la dernière période interrogée (avec ou sans mesure)
  last_run     timestamptz,
  status       text,                   -- OK, NO_DATA, ERROR
  message      text,
  nb_imported  int
);

CREATE TABLE IF NOT EXISTS maintenance_log (
  id        bigserial PRIMARY KEY,
  run_at    timestamptz NOT NULL DEFAULT now(),
  task      text NOT NULL,
  details   jsonb
);
