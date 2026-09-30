-- MobAlPlus : schéma de la base (PostgreSQL >= 14)
--
-- Principes :
--   * Le capteur physique (device / device_channel) est découplé de l'emplacement (place).
--     Une affectation datée (deployment) relie un canal de capteur à une série (series = place x grandeur).
--     Déplacer ou remplacer un capteur = clôturer une affectation et en ouvrir une autre.
--   * Les mesures brutes (reading) sont immuables et rattachées au canal du capteur, jamais à l'emplacement :
--     l'attribution à une série est calculée à la lecture (vue observation). Corriger une date de déplacement
--     ne réécrit aucune mesure.
--   * Les valeurs aberrantes ne sont jamais supprimées : elles sont marquées dans correction.
--   * Vocabulaire aligné sur OGC SensorThings (Thing / Datastream / Observation / ObservedProperty)
--     pour pouvoir exposer une API STA plus tard.
--
-- Le script est idempotent : il peut être rejoué sans perte.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- PostGIS et TimescaleDB sont optionnels : utilisés s'ils sont installés sur le serveur.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    CREATE EXTENSION IF NOT EXISTS postgis;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Référentiel
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observed_property (
  id    smallserial PRIMARY KEY,
  code  text NOT NULL UNIQUE,          -- temperature, humidity, rain...
  name  text NOT NULL,
  unit  text NOT NULL
);

INSERT INTO observed_property (code, name, unit) VALUES
  ('temperature', 'Température', '°C'),
  ('humidity',    'Humidité relative', '%'),
  ('rain',        'Pluie', 'mm'),
  ('unknown',     'Grandeur inconnue', '')
ON CONFLICT (code) DO NOTHING;

-- Emplacement (pièce, zone extérieure, congélateur...), hiérarchique : Maison > RDC > Salon
CREATE TABLE IF NOT EXISTS place (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE,     -- identifiant stable utilisé dans les fichiers de config
  name       text NOT NULL,
  parent_id  int REFERENCES place(id),
  kind       text,                     -- room, outdoor, appliance...
  exposure   text CHECK (exposure IN ('indoor', 'outdoor', 'appliance')),
  lon        double precision,         -- position simple ; une colonne PostGIS est ajoutée si disponible
  lat        double precision,
  plan_id    int,                      -- futur : plan indoor
  plan_x     double precision,
  plan_y     double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'place' AND column_name = 'geom') THEN
    ALTER TABLE place ADD COLUMN geom geometry(Point, 4326);
  END IF;
END $$;

-- Capteur physique Mobile Alerts (Thing / Sensor au sens STA)
CREATE TABLE IF NOT EXISTS device (
  id          serial PRIMARY KEY,
  ma_id       text NOT NULL UNIQUE,    -- identifiant Mobile Alerts (12 caractères hexa)
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
  label        text,                   -- libellé Mobile Alerts : « Température intérieure »...
  UNIQUE (device_id, channel_no)
);

-- Série affichée = emplacement x grandeur (Datastream au sens STA)
CREATE TABLE IF NOT EXISTS series (
  id           serial PRIMARY KEY,
  place_id     int NOT NULL REFERENCES place(id),
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
  -- un canal n'est qu'à un seul endroit à la fois
  EXCLUDE USING gist (channel_id WITH =, valid WITH &&),
  -- une série n'a qu'une seule source à la fois
  EXCLUDE USING gist (series_id WITH =, valid WITH &&)
);

-- ---------------------------------------------------------------------------
-- Mesures brutes (immuables)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reading (
  channel_id  int NOT NULL REFERENCES device_channel(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  value       real NOT NULL,
  source      smallint NOT NULL DEFAULT 0,   -- 0 = collecteur, 1 = import tableur, 2 = saisie
  PRIMARY KEY (channel_id, ts)
);

-- Hypertable + compression si TimescaleDB est présent (divise le volume par ~10)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('reading', 'ts', chunk_time_interval => interval '30 days',
                              if_not_exists => true, migrate_data => true);
    ALTER TABLE reading SET (timescaledb.compress, timescaledb.compress_segmentby = 'channel_id',
                             timescaledb.compress_orderby = 'ts');
    PERFORM add_compression_policy('reading', interval '30 days', if_not_exists => true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Qualité et enrichissement
-- ---------------------------------------------------------------------------

-- Correction : marque (reject) ou remplace (replace) des valeurs sans toucher au brut
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

-- Annotation sur une série, un emplacement, ou globale (les deux NULL)
CREATE TABLE IF NOT EXISTS annotation (
  id          serial PRIMARY KEY,
  series_id   int REFERENCES series(id) ON DELETE CASCADE,
  place_id    int REFERENCES place(id) ON DELETE CASCADE,
  ts_range    tstzrange NOT NULL,
  text        text NOT NULL,
  author      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotation_range_idx ON annotation USING gist (ts_range);

-- ---------------------------------------------------------------------------
-- Collecte
-- ---------------------------------------------------------------------------

-- État de synchronisation par capteur (remplace les colonnes Last Date / Status / Message du tableur)
CREATE TABLE IF NOT EXISTS device_sync (
  device_id    int PRIMARY KEY REFERENCES device(id) ON DELETE CASCADE,
  last_ts      timestamptz,            -- horodatage de la dernière mesure reçue
  last_run     timestamptz,
  status       text,                   -- OK, NO_DATA, ERROR
  message      text,
  nb_imported  int
);

-- ---------------------------------------------------------------------------
-- Vues de lecture
-- ---------------------------------------------------------------------------

-- Observation = mesure brute rattachée à sa série via l'affectation valide à cet instant,
-- avec application des corrections.
CREATE OR REPLACE VIEW observation AS
SELECT d.series_id,
       r.ts,
       CASE WHEN c.action = 'replace' THEN c.value ELSE r.value END AS value,
       CASE WHEN c.action = 'reject'  THEN 'rejected'
            WHEN c.action = 'replace' THEN 'corrected'
            ELSE 'ok' END AS quality,
       r.channel_id,
       r.value AS raw_value
FROM reading r
JOIN deployment d ON d.channel_id = r.channel_id AND d.valid @> r.ts
LEFT JOIN LATERAL (
  SELECT c.action, c.value
  FROM correction c
  WHERE c.channel_id = r.channel_id AND c.ts_range @> r.ts
  ORDER BY c.created_at DESC
  LIMIT 1
) c ON true;

-- Agrégats horaires par série (hors valeurs rejetées), pour l'affichage des longues périodes.
-- Rafraîchi par le collecteur : REFRESH MATERIALIZED VIEW CONCURRENTLY series_hourly;
CREATE MATERIALIZED VIEW IF NOT EXISTS series_hourly AS
SELECT series_id,
       date_trunc('hour', ts) AS bucket,
       min(value) AS vmin,
       max(value) AS vmax,
       avg(value)::real AS vavg,
       count(*) AS n
FROM observation
WHERE quality <> 'rejected'
GROUP BY series_id, date_trunc('hour', ts)
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS series_hourly_pk ON series_hourly (series_id, bucket);
