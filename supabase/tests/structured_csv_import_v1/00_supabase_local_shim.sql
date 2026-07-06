-- ============================================================================
-- 0U — SHIM SUPABASE LOCAL (TESTS UNIQUEMENT — NE JAMAIS APPLIQUER EN PROD)
-- ============================================================================
-- Émule sur un Postgres jetable les objets plateforme dont dépend la
-- migration candidate : rôles anon/authenticated/service_role, default
-- privileges larges (comportement Supabase à la création d'objets), schéma
-- auth + auth.uid() pilotable par GUC, enum app_role + user_roles + has_role
-- (copies conformes de supabase/migrations/20251119120031 et des grants
-- Lot 2B 20260430150428).
-- ============================================================================
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Émulation des default privileges Supabase : tout nouvel objet du schéma
-- public reçoit des grants larges — la migration candidate doit donc les
-- révoquer explicitement pour que les tests aient valeur de preuve.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- --- Schéma auth minimal -----------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY,
  email text UNIQUE
);

-- auth.uid() de test : lit le GUC request.jwt.claim.sub (posé par les helpers).
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

-- --- RBAC applicatif (copie conforme prod) -----------------------------------
CREATE TYPE public.app_role AS ENUM ('admin', 'auditor', 'manager', 'user');

CREATE TABLE public.user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users (id) ON DELETE CASCADE NOT NULL,
  role       public.app_role NOT NULL,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;
-- Grants Lot 2B.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

-- --- Outillage de test poc_test ----------------------------------------------
CREATE SCHEMA IF NOT EXISTS poc_test;
GRANT USAGE ON SCHEMA poc_test TO PUBLIC;

-- Contexte partagé entre fichiers/sessions (ids générés, résultats).
CREATE TABLE IF NOT EXISTS poc_test.ctx (
  key text PRIMARY KEY,
  val text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON poc_test.ctx TO PUBLIC;

CREATE OR REPLACE FUNCTION poc_test.ctx_set(p_key text, p_val text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO poc_test.ctx (key, val) VALUES (p_key, p_val)
  ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
$$;

CREATE OR REPLACE FUNCTION poc_test.ctx_get(p_key text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  SELECT val INTO v FROM poc_test.ctx WHERE key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST_HARNESS: ctx key % missing', p_key;
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION poc_test.assert(p_cond boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST_FAILED: %', p_label;
  END IF;
  RAISE NOTICE 'OK: %', p_label;
END $$;

-- Exécute p_sql et EXIGE une erreur dont le message matche p_like.
CREATE OR REPLACE FUNCTION poc_test.expect_error(p_sql text, p_like text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE p_like THEN
      RAISE NOTICE 'OK (refus attendu): %', p_label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'TEST_FAILED: % — erreur inattendue [%]', p_label, SQLERRM;
  END;
  RAISE EXCEPTION 'TEST_FAILED: % — aucune erreur alors qu''un refus était attendu', p_label;
END $$;

-- Identités synthétiques fixes.
CREATE OR REPLACE FUNCTION poc_test.uid_admin()   RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '11111111-1111-4111-8111-111111111111'::uuid $$;
CREATE OR REPLACE FUNCTION poc_test.uid_manager() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '22222222-2222-4222-8222-222222222222'::uuid $$;
CREATE OR REPLACE FUNCTION poc_test.uid_auditor() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '33333333-3333-4333-8333-333333333333'::uuid $$;
CREATE OR REPLACE FUNCTION poc_test.uid_user()    RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '44444444-4444-4444-8444-444444444444'::uuid $$;

-- Bascule d'identité (portée transaction : revient au superuser au COMMIT).
CREATE OR REPLACE FUNCTION poc_test.as_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION poc_test.as_anon()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('role', 'anon', true);
END $$;

CREATE OR REPLACE FUNCTION poc_test.as_super()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA poc_test TO PUBLIC;

SELECT 'shim ready' AS status;
