-- Synthetic local-only Supabase and Daily v2 shape for PostgreSQL 17 replay.
-- Supabase commonly installs pgcrypto outside public; the candidate must not
-- depend on the extension schema for its payload hashes.
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = auth, pg_temp
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;

CREATE TYPE public.app_role AS ENUM ('admin','auditor','manager','user');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role public.app_role NOT NULL,
  UNIQUE(user_id,role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid,_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;
REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO authenticated,service_role;

CREATE TABLE public.daily_statement_account_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  bank text NOT NULL,
  currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  safe_alias text NOT NULL,
  account_fingerprint text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive'))
);

CREATE TABLE public.daily_statement_units_canonical (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank text NOT NULL,
  account_fingerprint text NOT NULL,
  currency text NOT NULL,
  accounting_date date NOT NULL,
  status text NOT NULL DEFAULT 'ingested' CHECK(status IN ('ingested','superseded')),
  account_registry_id uuid REFERENCES public.daily_statement_account_registry(id)
);

CREATE TABLE public.daily_statement_lines_canonical (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_unit_id uuid NOT NULL REFERENCES public.daily_statement_units_canonical(id),
  daily_line_hash text NOT NULL,
  is_active boolean NOT NULL,
  accounting_date date NOT NULL,
  value_date date,
  description_sanitized text NOT NULL,
  debit_amount numeric(18,2),
  credit_amount numeric(18,2),
  signed_amount numeric(18,2) NOT NULL,
  direction text NOT NULL CHECK(direction IN ('debit','credit')),
  currency text NOT NULL,
  CONSTRAINT local_daily_line_amount_shape CHECK(
    (direction='credit' AND credit_amount=signed_amount AND signed_amount>0 AND debit_amount IS NULL)
    OR (direction='debit' AND debit_amount=abs(signed_amount) AND signed_amount<0 AND credit_amount IS NULL)
  )
);

GRANT SELECT ON public.daily_statement_account_registry,public.daily_statement_units_canonical,
  public.daily_statement_lines_canonical TO authenticated,service_role;

CREATE SCHEMA poc_test;
CREATE OR REPLACE FUNCTION poc_test.assert(p_condition boolean,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST_FAILED: %',p_message; END IF;
END $$;
GRANT USAGE ON SCHEMA poc_test TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION poc_test.assert(boolean,text) TO authenticated,service_role;

INSERT INTO auth.users(id,email) VALUES
  ('00000000-0000-0000-0000-000000000001','admin.synthetic.invalid'),
  ('00000000-0000-0000-0000-000000000002','entry.synthetic.invalid'),
  ('00000000-0000-0000-0000-000000000003','validator.synthetic.invalid'),
  ('00000000-0000-0000-0000-000000000004','matcher.synthetic.invalid');
INSERT INTO public.user_roles(user_id,role) VALUES
  ('00000000-0000-0000-0000-000000000001','admin'),
  ('00000000-0000-0000-0000-000000000002','user'),
  ('00000000-0000-0000-0000-000000000003','manager'),
  ('00000000-0000-0000-0000-000000000004','auditor');
