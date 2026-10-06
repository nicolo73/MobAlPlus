-- Couleur personnalisée d'un emplacement (gris, marron… ou n'importe quelle teinte), en plus des
-- 8 couleurs de la palette (color_slot). Prioritaire sur color_slot quand elle est renseignée.

ALTER TABLE place ADD COLUMN IF NOT EXISTS color text
  CHECK (color ~ '^#[0-9a-f]{6}$');
