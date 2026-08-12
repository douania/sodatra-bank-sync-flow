\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin','manager','auditor','user');

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

INSERT INTO public.user_roles(user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000002','manager'),
  ('00000000-0000-0000-0000-000000000003','user');

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE FUNCTION public.has_role(p_user_id uuid, p_role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_user_id AND role=p_role) $$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE TABLE public.bank_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name text NOT NULL,
  report_date date NOT NULL,
  opening_balance bigint NOT NULL,
  closing_balance bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.bank_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_report_id uuid REFERENCES public.bank_reports(id) ON DELETE CASCADE,
  facility_type text NOT NULL,
  limit_amount bigint NOT NULL,
  used_amount bigint NOT NULL,
  available_amount bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.deposits_not_cleared (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_report_id uuid REFERENCES public.bank_reports(id) ON DELETE CASCADE,
  date_depot date NOT NULL,
  date_valeur date,
  type_reglement text NOT NULL,
  client_code text,
  reference text,
  montant bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.impayes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_report_id uuid REFERENCES public.bank_reports(id) ON DELETE CASCADE,
  date_echeance date NOT NULL,
  date_retour date,
  client_code text NOT NULL,
  description text,
  montant bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fund_position (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  total_fund_available bigint NOT NULL,
  collections_not_deposited bigint NOT NULL,
  grand_total bigint NOT NULL,
  deposit_for_day bigint,
  payment_for_day bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fund_position_detail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_position_id uuid REFERENCES public.fund_position(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  balance bigint NOT NULL,
  fund_applied bigint,
  net_balance bigint NOT NULL,
  non_validated_deposit bigint,
  grand_balance bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fund_position_hold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_position_id uuid REFERENCES public.fund_position(id) ON DELETE CASCADE,
  hold_date date NOT NULL,
  cheque_number text,
  client_bank text,
  client_name text NOT NULL,
  facture_reference text,
  amount bigint NOT NULL,
  deposit_date date,
  days_remaining integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA test;
CREATE FUNCTION test.assert(p_condition boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF NOT COALESCE(p_condition,false) THEN RAISE EXCEPTION 'ASSERT_FAILED: %',p_message; END IF; END $$;
GRANT USAGE ON SCHEMA test TO authenticated;
GRANT EXECUTE ON FUNCTION test.assert(boolean, text) TO authenticated;
