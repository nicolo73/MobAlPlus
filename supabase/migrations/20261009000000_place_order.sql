-- Ordre des emplacements (au sein de leur parent) et réorganisation de l'arborescence.

ALTER TABLE place ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- Un emplacement ne peut pas être placé dans l'un de ses propres sous-emplacements
CREATE OR REPLACE FUNCTION check_place_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE up(id, parent_id) AS (
      SELECT id, parent_id FROM place WHERE id = NEW.parent_id
      UNION
      SELECT p.id, p.parent_id FROM place p JOIN up ON p.id = up.parent_id
    )
    SELECT 1 FROM up WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Un emplacement ne peut pas être placé dans l''un de ses sous-emplacements';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS place_cycle_check ON place;
CREATE TRIGGER place_cycle_check BEFORE UPDATE OF parent_id ON place
  FOR EACH ROW EXECUTE FUNCTION check_place_cycle();

-- Range les emplacements p_ids, dans cet ordre, sous p_parent (NULL : premier niveau).
-- Fonction ordinaire (pas SECURITY DEFINER) : les règles d'accès de « place » s'appliquent.
CREATE OR REPLACE FUNCTION reorder_places(p_parent int, p_ids int[]) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  n int;
BEGIN
  UPDATE place p SET parent_id = p_parent, sort_order = o.ord::int
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
   WHERE p.id = o.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'Emplacement introuvable ou non modifiable';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION reorder_places(int, int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reorder_places(int, int[]) TO authenticated;
