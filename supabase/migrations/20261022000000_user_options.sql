-- Options de chaque compte, dans un seul document JSON (évolutif : une nouvelle option ne change pas
-- la structure de la base) : synthèses de chaque maison (emplacements, durée, grandeurs, météo) et
-- préférences d'affichage, retrouvées sur tous les appareils du compte.

CREATE TABLE IF NOT EXISTS user_options (
  user_id     uuid PRIMARY KEY DEFAULT auth.uid(),
  options     jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_row ON user_options;
CREATE POLICY own_row ON user_options FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- Lecture et enregistrement (document complet) des options du compte connecté
CREATE OR REPLACE FUNCTION my_options() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT options FROM user_options WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION save_my_options(p_options jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Connexion requise'; END IF;
  IF jsonb_typeof(p_options) <> 'object' THEN RAISE EXCEPTION 'Options invalides'; END IF;
  INSERT INTO user_options (user_id, options, updated_at) VALUES (auth.uid(), p_options, now())
  ON CONFLICT (user_id) DO UPDATE SET options = excluded.options, updated_at = now();
END $$;

GRANT SELECT, INSERT, UPDATE ON user_options TO authenticated;
REVOKE EXECUTE ON FUNCTION my_options(), save_my_options(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_options(), save_my_options(jsonb) TO authenticated;
