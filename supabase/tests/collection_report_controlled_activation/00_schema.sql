\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE collection_test_manager LOGIN IN ROLE authenticated;
CREATE SCHEMA auth;

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
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE FUNCTION public.has_role(p_user_id uuid, p_role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_user_id AND role=p_role) $$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE TABLE public.collection_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  client_code text NOT NULL,
  collection_amount numeric NOT NULL,
  bank_name text,
  status text DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  date_of_validity date,
  facture_no text,
  no_chq_bd text,
  bank_name_display text,
  depo_ref text,
  nj integer,
  taux numeric,
  interet numeric,
  commission numeric,
  tob numeric,
  frais_escompte numeric,
  bank_commission numeric,
  sg_or_fa_no text,
  d_n_amount numeric,
  income numeric,
  date_of_impay date,
  reglement_impaye date,
  remarques text,
  credited_date date,
  processing_status text DEFAULT 'NEW',
  matched_bank_deposit_id uuid,
  match_confidence numeric,
  match_method text,
  processed_at timestamp,
  excel_source_row integer,
  excel_filename text,
  excel_processed_at timestamptz DEFAULT now(),
  unique_excel_traceability text,
  collection_type text,
  effet_echeance_date date,
  effet_status text,
  cheque_number text,
  cheque_status text,
  CONSTRAINT check_excel_traceability_not_null CHECK (
    (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL)
    OR (excel_filename IS NULL AND excel_source_row IS NULL)
  )
);
CREATE UNIQUE INDEX idx_collection_excel_source
  ON public.collection_report(excel_filename, excel_source_row)
  WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;
ALTER TABLE public.collection_report
  ADD CONSTRAINT unique_excel_traceability UNIQUE (unique_excel_traceability);

CREATE FUNCTION public.detect_collection_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  is_date boolean;
  is_number boolean;
BEGIN
  IF NEW.collection_type IS NOT NULL AND NEW.collection_type <> 'UNKNOWN' THEN
    RETURN NEW;
  END IF;
  IF NEW.no_chq_bd IS NULL THEN
    RETURN NEW;
  END IF;

  is_date := NEW.no_chq_bd ~ '^\d{2}[/\-]\d{2}[/\-]\d{4}$'
    OR NEW.no_chq_bd ~ '^\d{4}[/\-]\d{2}[/\-]\d{2}$';
  is_number := NEW.no_chq_bd ~ '^\d+$';

  IF is_date THEN
    NEW.collection_type := 'EFFET';
    BEGIN
      IF NEW.no_chq_bd ~ '^\d{2}/\d{2}/\d{4}$' THEN
        NEW.effet_echeance_date := to_date(NEW.no_chq_bd, 'DD/MM/YYYY');
      ELSIF NEW.no_chq_bd ~ '^\d{2}-\d{2}-\d{4}$' THEN
        NEW.effet_echeance_date := to_date(NEW.no_chq_bd, 'DD-MM-YYYY');
      ELSIF NEW.no_chq_bd ~ '^\d{4}/\d{2}/\d{2}$' THEN
        NEW.effet_echeance_date := to_date(NEW.no_chq_bd, 'YYYY/MM/DD');
      ELSIF NEW.no_chq_bd ~ '^\d{4}-\d{2}-\d{2}$' THEN
        NEW.effet_echeance_date := to_date(NEW.no_chq_bd, 'YYYY-MM-DD');
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
    IF NEW.effet_status IS NULL THEN
      NEW.effet_status := 'PENDING';
    END IF;
  ELSIF is_number THEN
    NEW.collection_type := 'CHEQUE';
    NEW.cheque_number := NEW.no_chq_bd;
    IF NEW.cheque_status IS NULL THEN
      NEW.cheque_status := 'PENDING';
    END IF;
  ELSE
    NEW.collection_type := 'UNKNOWN';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_detect_collection_type
BEFORE INSERT OR UPDATE ON public.collection_report
FOR EACH ROW EXECUTE FUNCTION public.detect_collection_type();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_report TO authenticated;
ALTER TABLE public.collection_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_report_select ON public.collection_report
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY collection_report_insert ON public.collection_report
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );
CREATE POLICY collection_report_update ON public.collection_report
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE SCHEMA test;
CREATE FUNCTION test.assert(p_condition boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'ASSERT_FAILED: %', p_message;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA test TO authenticated;
GRANT EXECUTE ON FUNCTION test.assert(boolean, text) TO authenticated;
