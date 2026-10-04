-- MobAlPlus : droits rattachés à l'adresse e-mail
--
-- Un compte autorisé est reconnu par son identifiant Supabase OU par son adresse e-mail. Ainsi :
--   * supprimer puis recréer un utilisateur ne fait pas perdre ses droits ;
--   * la connexion « avec Google » donne les mêmes droits que le compte e-mail / mot de passe ;
--   * on peut autoriser quelqu'un par son e-mail avant sa première connexion.

-- Hors Supabase (tests locaux) : auth.jwt() minimal
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'auth' AND p.proname = 'jwt') THEN
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
      AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
  END IF;
END $$;

-- user_id devient facultatif (autorisation par e-mail seul) ; l'e-mail devient obligatoire et unique
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'app_user' AND column_name = 'id') THEN
    ALTER TABLE app_user DROP CONSTRAINT app_user_pkey;
    ALTER TABLE app_user ADD COLUMN id serial PRIMARY KEY;
    ALTER TABLE app_user ALTER COLUMN user_id DROP NOT NULL;
    ALTER TABLE app_user ADD CONSTRAINT app_user_user_id_key UNIQUE (user_id);
  END IF;
END $$;

UPDATE app_user SET email = lower(email) WHERE email <> lower(email);
-- Doublons éventuels (même e-mail inséré deux fois) : on garde le rôle le plus élevé
DELETE FROM app_user a USING app_user b
WHERE lower(a.email) = lower(b.email) AND a.id <> b.id
  AND (a.role, a.id) > (b.role, b.id);   -- 'admin' < 'viewer' : la ligne admin est conservée
DELETE FROM app_user WHERE email IS NULL;
ALTER TABLE app_user ALTER COLUMN email SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_key ON app_user (lower(email));

-- Rôle de l'utilisateur connecté (NULL = non autorisé)
CREATE OR REPLACE FUNCTION my_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM app_user
  WHERE auth.uid() IS NOT NULL
    AND (user_id = auth.uid() OR lower(email) = lower(auth.jwt() ->> 'email'))
  ORDER BY role = 'admin' DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION is_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT my_role() IS NOT NULL $$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT my_role() = 'admin' $$;

REVOKE EXECUTE ON FUNCTION my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_role() TO authenticated;
