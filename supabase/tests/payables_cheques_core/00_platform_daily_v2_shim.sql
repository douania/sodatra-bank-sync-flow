-- PAYABLES-CHEQUES-CORE — shim local PostgreSQL 17, données strictement synthétiques.
-- Reproduit la forme Supabase utile (auth.uid, rôles applicatifs, privilèges par
-- défaut observés en staging) et les seules colonnes Daily v2 lues par le domaine.
-- Aucune donnée bancaire réelle, aucun identifiant réel.

CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres;

-- Posture plateforme observée : EXECUTE fermé à PUBLIC/anon, ouvert par défaut
-- à service_role sur les nouvelles fonctions. Le candidat doit le refermer.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE SET search_path = auth, pg_temp
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin','auditor','manager','user');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Colonnes Daily v2 lues par le domaine (noms et types identiques au dépôt).
CREATE TABLE public.daily_statement_account_registry (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES auth.users(id),
  bank                text NOT NULL CHECK (bank IN ('BDK','ORA','ATB','BICIS','BIS','BRIDGE')),
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  safe_alias          text NOT NULL,
  account_fingerprint text NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);

CREATE TABLE public.daily_statement_units_canonical (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_unit_id             text NOT NULL,
  bank                    text NOT NULL,
  account_fingerprint     text NOT NULL,
  currency                text NOT NULL,
  accounting_date         date NOT NULL,
  closing_balance_derived numeric(18,2),
  aggregates_status       text NOT NULL CHECK (aggregates_status IN ('derived','unavailable')),
  validation_status       text NOT NULL CHECK (validation_status IN ('valid','needs_review')),
  status                  text NOT NULL DEFAULT 'ingested' CHECK (status IN ('ingested','superseded')),
  account_registry_id     uuid REFERENCES public.daily_statement_account_registry(id)
);

CREATE TABLE public.daily_statement_lines_canonical (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_unit_id     uuid NOT NULL REFERENCES public.daily_statement_units_canonical(id),
  daily_line_hash       text NOT NULL,
  is_active             boolean NOT NULL,
  accounting_date       date NOT NULL,
  value_date            date,
  description_sanitized text NOT NULL,
  debit_amount          numeric(18,2),
  credit_amount         numeric(18,2),
  signed_amount         numeric(18,2) NOT NULL,
  direction             text NOT NULL CHECK (direction IN ('debit','credit')),
  currency              text NOT NULL,
  CONSTRAINT local_daily_line_amount_shape CHECK (
    (direction = 'credit' AND credit_amount = signed_amount AND signed_amount > 0 AND debit_amount IS NULL)
    OR (direction = 'debit' AND debit_amount = abs(signed_amount) AND signed_amount < 0 AND credit_amount IS NULL))
);

ALTER TABLE public.daily_statement_account_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_units_canonical ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_lines_canonical ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.daily_statement_account_registry, public.daily_statement_units_canonical,
  public.daily_statement_lines_canonical TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- Outils de test (schéma pc_test) : identités, registre d'identifiants, asserts.
-- --------------------------------------------------------------------------
CREATE SCHEMA pc_test;
GRANT USAGE ON SCHEMA pc_test TO anon, authenticated, service_role;

CREATE TABLE pc_test.ids (name text PRIMARY KEY, id uuid NOT NULL);

CREATE FUNCTION pc_test.assert(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %', p_message; END IF;
END $$;

CREATE FUNCTION pc_test.put(p_name text, p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc_test, pg_temp AS $$
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'TEST_FAILED: null id for %', p_name; END IF;
  INSERT INTO pc_test.ids (name, id) VALUES (p_name, p_id) ON CONFLICT (name) DO UPDATE SET id = excluded.id;
  RETURN p_id;
END $$;

CREATE FUNCTION pc_test.id(p_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pc_test, pg_temp AS $$
DECLARE v uuid;
BEGIN
  SELECT i.id INTO v FROM pc_test.ids i WHERE i.name = p_name;
  IF v IS NULL THEN RAISE EXCEPTION 'TEST_FAILED: unknown id %', p_name; END IF;
  RETURN v;
END $$;

CREATE FUNCTION pc_test.key(p_label text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'pc-test:' || p_label $$;

-- Bascule de session vers un utilisateur synthétique (rôle authenticated).
CREATE FUNCTION pc_test.as_user(p_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pc_test.id(p_name)::text, false);
  PERFORM set_config('role', 'authenticated', false);
END $$;

CREATE FUNCTION pc_test.as_anonymous()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('role', 'anon', false);
END $$;

-- L'instruction doit échouer avec le fragment attendu ; ses effets sont annulés.
CREATE FUNCTION pc_test.expect_error(p_sql text, p_fragment text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_fragment IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'TEST_FAILED: expected [%] got [%]', p_fragment, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'TEST_FAILED: expected error [%] but statement succeeded: %', p_fragment, p_sql;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pc_test TO anon, authenticated, service_role;

-- Identités synthétiques (domaines .invalid).
INSERT INTO auth.users (id, email) VALUES
  ('10000000-0000-4000-8000-000000000001', 'gov.a@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'gov.b@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000011', 'acc1@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000012', 'acc2@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000013', 'acc3@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000014', 'acc4@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000021', 'admin@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000031', 'outsider@synthetic.invalid'),
  ('10000000-0000-4000-8000-000000000041', 'auditor@synthetic.invalid');
INSERT INTO pc_test.ids (name, id) VALUES
  ('gov_a', '10000000-0000-4000-8000-000000000001'), ('gov_b', '10000000-0000-4000-8000-000000000002'),
  ('acc1', '10000000-0000-4000-8000-000000000011'), ('acc2', '10000000-0000-4000-8000-000000000012'),
  ('acc3', '10000000-0000-4000-8000-000000000013'), ('acc4', '10000000-0000-4000-8000-000000000014'),
  ('admin', '10000000-0000-4000-8000-000000000021'), ('outsider', '10000000-0000-4000-8000-000000000031'),
  ('auditor', '10000000-0000-4000-8000-000000000041');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000021', 'admin'),
  ('10000000-0000-4000-8000-000000000011', 'user'),
  ('10000000-0000-4000-8000-000000000012', 'user'),
  ('10000000-0000-4000-8000-000000000013', 'manager'),
  ('10000000-0000-4000-8000-000000000014', 'user'),
  ('10000000-0000-4000-8000-000000000041', 'auditor');

-- Comptes synthétiques du registre Daily v2.
INSERT INTO public.daily_statement_account_registry (id, created_by, bank, currency, safe_alias, account_fingerprint) VALUES
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-000000000021', 'ORA', 'XOF', 'ORA principal', repeat('a', 64)),
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-000000000021', 'BDK', 'XOF', 'BDK principal', repeat('b', 64)),
  ('20000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-000000000021', 'ATB', 'XOF', 'ATB principal', repeat('c', 64)),
  ('20000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-000000000021', 'BICIS', 'XOF', 'BICIS principal', repeat('d', 64)),
  ('20000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-000000000021', 'BIS', 'XOF', 'BIS principal', repeat('e', 64)),
  ('20000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-000000000021', 'BDK', 'EUR', 'BDK euro', repeat('f', 64));
INSERT INTO pc_test.ids (name, id) VALUES
  ('acct_ora', '20000000-0000-4000-8000-0000000000a1'), ('acct_bdk', '20000000-0000-4000-8000-0000000000b1'),
  ('acct_atb', '20000000-0000-4000-8000-0000000000c1'), ('acct_bicis', '20000000-0000-4000-8000-0000000000d1'),
  ('acct_bis', '20000000-0000-4000-8000-0000000000e1'), ('acct_eur', '20000000-0000-4000-8000-0000000000f1');
