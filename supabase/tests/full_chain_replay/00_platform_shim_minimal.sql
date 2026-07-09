-- ============================================================================
-- 0M-E — SHIM PLATEFORME MINIMAL (TESTS UNIQUEMENT — NE JAMAIS APPLIQUER EN
-- PROD NI SUR UN PROJET SUPABASE LIVE)
-- ============================================================================
-- Émule sur un Postgres jetable les SEULS objets plateforme Supabase que la
-- chaîne complète de migrations présuppose :
--   * rôles anon / authenticated / service_role ;
--   * default privileges larges (comportement Supabase à la création
--     d'objets : les REVOKE des migrations doivent avoir quelque chose à
--     révoquer pour que les tests aient valeur de preuve) ;
--   * schéma auth + table auth.users minimale + auth.uid() pilotée par GUC.
--
-- INTERDIT ICI (différence volontaire avec le shim v2
-- supabase/tests/daily_statement_units_v2/00_supabase_local_shim.sql) :
--   * PAS de public.app_role, PAS de public.user_roles, PAS de
--     public.has_role : ces objets sont créés par la CHAÎNE ACTIVE
--     (20251119120031). Les pré-créer masquerait un échec de la chaîne.
--
-- Fixture plateforme : la migration historique 20260430150428 (présente au
-- ledger prod, non modifiable) insère le rôle admin pour l'utilisateur
-- '9539d4f5-a600-4bf7-931f-315e597e4441' avec FK vers auth.users(id). En
-- prod, cet utilisateur existait dans auth.users au moment de l'apply. Le
-- shim reproduit fidèlement cet état plateforme avec une ligne SYNTHÉTIQUE
-- (UUID déjà versionné dans la migration ; email fictif ; aucune donnée
-- réelle). Voir README — même exigence pour un futur apply staging (0M-F).
-- ============================================================================
\set ON_ERROR_STOP on

-- --- Rôles plateforme --------------------------------------------------------
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

-- Émulation des default privileges Supabase.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- --- Schéma auth minimal -----------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Colonnes minimales exigées par la chaîne :
--   id                 : FKs (universal_bank_reports, bank_audit_log,
--                        user_roles, daily v2) + trigger on_auth_user_created
--   email              : confort de diagnostic
--   raw_user_meta_data : policies de 20250720123240 (raw_user_meta_data->>'role')
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY,
  email              text UNIQUE,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- auth.uid() de test : lit le GUC request.jwt.claim.sub.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

-- --- Fixture plateforme : utilisateur admin présupposé par 20260430150428 ----
INSERT INTO auth.users (id, email)
VALUES ('9539d4f5-a600-4bf7-931f-315e597e4441', 'admin-fixture@shim.local')
ON CONFLICT (id) DO NOTHING;

SELECT 'platform shim minimal ready' AS status;
