-- Position de la maison (home.lat / home.lon existent déjà) et nom du lieu, pour la météo publique
-- (Open-Meteo, interrogé directement par l'application). Modifiable par le propriétaire.
ALTER TABLE home ADD COLUMN IF NOT EXISTS location_label text;
