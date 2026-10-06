-- Couleur d'un emplacement dans les courbes : numéro dans la palette validée de l'application
-- (8 teintes lisibles en thème clair et sombre). NULL : couleur attribuée automatiquement.

ALTER TABLE place ADD COLUMN IF NOT EXISTS color_slot smallint
  CHECK (color_slot BETWEEN 0 AND 7);
