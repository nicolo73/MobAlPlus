-- Un emplacement parent (qui contient des sous-emplacements) regroupe et fait la moyenne : il ne
-- reçoit pas de capteur. Deux règles, vérifiées par la base quel que soit le chemin (application,
-- import, outils) :
--  - un capteur ne peut pas être affecté (affectation en cours) à un emplacement qui a des
--    sous-emplacements ;
--  - un emplacement qui a un capteur affecté ne peut pas recevoir de sous-emplacement.
-- Les historiques passés ne sont pas concernés (affectations closes) ; les incohérences déjà
-- présentes sont signalées par place_issues() et dans Admin › Emplacements.

-- Affectation en cours (pas de fin, ou fin dans le futur)
CREATE OR REPLACE FUNCTION deployment_is_current(p_valid tstzrange) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT upper(p_valid) IS NULL OR upper(p_valid) > now() $$;

CREATE OR REPLACE FUNCTION check_deployment_leaf_place() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_place record;
BEGIN
  IF NOT deployment_is_current(NEW.valid) THEN
    RETURN NEW;
  END IF;
  SELECT p.id, p.name INTO v_place FROM series s JOIN place p ON p.id = s.place_id WHERE s.id = NEW.series_id;
  IF EXISTS (SELECT 1 FROM place c WHERE c.parent_id = v_place.id) THEN
    RAISE EXCEPTION '« % » contient des sous-emplacements : affectez le capteur à l''un d''eux (un emplacement parent fait la moyenne de ses sous-emplacements)', v_place.name;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS deployment_leaf_place_check ON deployment;
CREATE TRIGGER deployment_leaf_place_check BEFORE INSERT OR UPDATE OF series_id ON deployment
  FOR EACH ROW EXECUTE FUNCTION check_deployment_leaf_place();

CREATE OR REPLACE FUNCTION check_place_parent_has_no_sensor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.parent_id IS NULL OR NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
    RETURN NEW;
  END IF;
  SELECT p.name INTO v_name FROM place p
   WHERE p.id = NEW.parent_id
     AND EXISTS (SELECT 1 FROM series s JOIN deployment d ON d.series_id = s.id
                 WHERE s.place_id = p.id AND deployment_is_current(d.valid));
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION '« % » a un capteur affecté : il ne peut pas contenir de sous-emplacement (déplacez d''abord son capteur, Admin › Capteurs)', v_name;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS place_parent_no_sensor_check ON place;
CREATE TRIGGER place_parent_no_sensor_check BEFORE INSERT OR UPDATE OF parent_id ON place
  FOR EACH ROW EXECUTE FUNCTION check_place_parent_has_no_sensor();

-- Incohérences existantes : emplacements parents avec un capteur affecté (règles d'accès appliquées)
CREATE OR REPLACE FUNCTION place_issues()
RETURNS TABLE (place_id int, place_name text, channels int)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.name, count(DISTINCT d.channel_id)::int
  FROM place p
  JOIN series s ON s.place_id = p.id
  JOIN deployment d ON d.series_id = s.id AND deployment_is_current(d.valid)
  WHERE EXISTS (SELECT 1 FROM place c WHERE c.parent_id = p.id)
  GROUP BY p.id, p.name
  ORDER BY p.name
$$;

REVOKE EXECUTE ON FUNCTION place_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION place_issues() TO authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM place_issues() LOOP
    RAISE NOTICE 'Emplacement parent avec capteur affecté : % (% canal/canaux)', r.place_name, r.channels;
  END LOOP;
END $$;
