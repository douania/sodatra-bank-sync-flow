BEGIN;

CREATE TABLE public.financial_write_commands (
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('SAVE_BANK_REPORT_V1', 'SAVE_FUND_POSITION_V1')),
  command_key uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{32}$'),
  result_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (actor_id, operation, command_key),
  CHECK ((result_id IS NULL) = (completed_at IS NULL))
);

ALTER TABLE public.financial_write_commands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.financial_write_commands
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_bank_report_atomic_v1(
  p_command_key uuid,
  p_report jsonb,
  p_facilities jsonb,
  p_deposits jsonb,
  p_impayes jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_command public.financial_write_commands%ROWTYPE;
  v_report_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FINANCIAL_WRITE_FORBIDDEN';
  END IF;

  IF p_command_key IS NULL
    OR p_report IS NULL
    OR p_facilities IS NULL
    OR p_deposits IS NULL
    OR p_impayes IS NULL
    OR jsonb_typeof(p_report) <> 'object'
    OR jsonb_typeof(p_facilities) <> 'array'
    OR jsonb_typeof(p_deposits) <> 'array'
    OR jsonb_typeof(p_impayes) <> 'array'
  THEN
    RAISE EXCEPTION 'BANK_REPORT_PAYLOAD_INVALID';
  END IF;

  IF NOT p_report ?& ARRAY['bank_name','report_date','opening_balance','closing_balance']
    OR p_report - ARRAY['bank_name','report_date','opening_balance','closing_balance'] <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'BANK_REPORT_KEYS_INVALID';
  END IF;

  IF jsonb_typeof(p_report->'bank_name') <> 'string'
    OR btrim(p_report->>'bank_name') = ''
    OR jsonb_typeof(p_report->'report_date') <> 'string'
    OR jsonb_typeof(p_report->'opening_balance') <> 'number'
    OR (p_report->>'opening_balance')::numeric <> trunc((p_report->>'opening_balance')::numeric)
    OR jsonb_typeof(p_report->'closing_balance') <> 'number'
    OR (p_report->>'closing_balance')::numeric <> trunc((p_report->>'closing_balance')::numeric)
  THEN
    RAISE EXCEPTION 'BANK_REPORT_VALUES_INVALID';
  END IF;

  IF jsonb_array_length(p_facilities) > 1000
    OR jsonb_array_length(p_deposits) > 1000
    OR jsonb_array_length(p_impayes) > 1000
  THEN
    RAISE EXCEPTION 'BANK_REPORT_CHILD_LIMIT_EXCEEDED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_facilities) AS e(item)
    WHERE jsonb_typeof(item) <> 'object'
      OR item - ARRAY['facility_type','limit_amount','used_amount','available_amount'] <> '{}'::jsonb
      OR NOT item ?& ARRAY['facility_type','limit_amount','used_amount','available_amount']
      OR jsonb_typeof(item->'facility_type') <> 'string'
      OR btrim(item->>'facility_type') = ''
      OR jsonb_typeof(item->'limit_amount') <> 'number'
      OR (item->>'limit_amount')::numeric <> trunc((item->>'limit_amount')::numeric)
      OR jsonb_typeof(item->'used_amount') <> 'number'
      OR (item->>'used_amount')::numeric <> trunc((item->>'used_amount')::numeric)
      OR jsonb_typeof(item->'available_amount') <> 'number'
      OR (item->>'available_amount')::numeric <> trunc((item->>'available_amount')::numeric)
  ) THEN
    RAISE EXCEPTION 'BANK_FACILITY_KEYS_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_deposits) AS e(item)
    WHERE jsonb_typeof(item) <> 'object'
      OR item - ARRAY['date_depot','date_valeur','type_reglement','client_code','reference','montant'] <> '{}'::jsonb
      OR NOT item ?& ARRAY['date_depot','date_valeur','type_reglement','client_code','reference','montant']
      OR jsonb_typeof(item->'date_depot') <> 'string'
      OR jsonb_typeof(item->'date_valeur') NOT IN ('string','null')
      OR jsonb_typeof(item->'type_reglement') <> 'string'
      OR btrim(item->>'type_reglement') = ''
      OR jsonb_typeof(item->'client_code') NOT IN ('string','null')
      OR jsonb_typeof(item->'reference') NOT IN ('string','null')
      OR jsonb_typeof(item->'montant') <> 'number'
      OR (item->>'montant')::numeric <> trunc((item->>'montant')::numeric)
  ) THEN
    RAISE EXCEPTION 'BANK_DEPOSIT_KEYS_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_impayes) AS e(item)
    WHERE jsonb_typeof(item) <> 'object'
      OR item - ARRAY['date_echeance','date_retour','client_code','description','montant'] <> '{}'::jsonb
      OR NOT item ?& ARRAY['date_echeance','date_retour','client_code','description','montant']
      OR jsonb_typeof(item->'date_echeance') <> 'string'
      OR jsonb_typeof(item->'date_retour') NOT IN ('string','null')
      OR jsonb_typeof(item->'client_code') <> 'string'
      OR btrim(item->>'client_code') = ''
      OR jsonb_typeof(item->'description') NOT IN ('string','null')
      OR jsonb_typeof(item->'montant') <> 'number'
      OR (item->>'montant')::numeric <> trunc((item->>'montant')::numeric)
  ) THEN
    RAISE EXCEPTION 'BANK_IMPAYE_KEYS_INVALID';
  END IF;

  v_payload_hash := md5(jsonb_build_object(
    'report', p_report,
    'facilities', p_facilities,
    'deposits', p_deposits,
    'impayes', p_impayes
  )::text);

  INSERT INTO public.financial_write_commands (
    actor_id, operation, command_key, payload_hash
  ) VALUES (
    v_actor, 'SAVE_BANK_REPORT_V1', p_command_key, v_payload_hash
  ) ON CONFLICT DO NOTHING;

  SELECT * INTO v_command
  FROM public.financial_write_commands
  WHERE actor_id = v_actor
    AND operation = 'SAVE_BANK_REPORT_V1'
    AND command_key = p_command_key
  FOR UPDATE;

  IF v_command.payload_hash <> v_payload_hash THEN
    RAISE EXCEPTION 'FINANCIAL_COMMAND_PAYLOAD_MISMATCH';
  END IF;
  IF v_command.result_id IS NOT NULL THEN
    RETURN v_command.result_id;
  END IF;

  INSERT INTO public.bank_reports (
    bank_name, report_date, opening_balance, closing_balance
  ) VALUES (
    p_report->>'bank_name',
    (p_report->>'report_date')::date,
    (p_report->>'opening_balance')::bigint,
    (p_report->>'closing_balance')::bigint
  ) RETURNING id INTO v_report_id;

  INSERT INTO public.bank_facilities (
    bank_report_id, facility_type, limit_amount, used_amount, available_amount
  )
  SELECT
    v_report_id, x.facility_type, x.limit_amount, x.used_amount, x.available_amount
  FROM jsonb_to_recordset(p_facilities) AS x(
    facility_type text,
    limit_amount bigint,
    used_amount bigint,
    available_amount bigint
  );

  INSERT INTO public.deposits_not_cleared (
    bank_report_id, date_depot, date_valeur, type_reglement, client_code, reference, montant
  )
  SELECT
    v_report_id, x.date_depot, x.date_valeur, x.type_reglement, x.client_code, x.reference, x.montant
  FROM jsonb_to_recordset(p_deposits) AS x(
    date_depot date,
    date_valeur date,
    type_reglement text,
    client_code text,
    reference text,
    montant bigint
  );

  INSERT INTO public.impayes (
    bank_report_id, date_echeance, date_retour, client_code, description, montant
  )
  SELECT
    v_report_id, x.date_echeance, x.date_retour, x.client_code, x.description, x.montant
  FROM jsonb_to_recordset(p_impayes) AS x(
    date_echeance date,
    date_retour date,
    client_code text,
    description text,
    montant bigint
  );

  UPDATE public.financial_write_commands
  SET result_id = v_report_id, completed_at = now()
  WHERE actor_id = v_actor
    AND operation = 'SAVE_BANK_REPORT_V1'
    AND command_key = p_command_key;

  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_fund_position_atomic_v1(
  p_command_key uuid,
  p_position jsonb,
  p_details jsonb,
  p_holds jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_command public.financial_write_commands%ROWTYPE;
  v_fund_position_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FINANCIAL_WRITE_FORBIDDEN';
  END IF;

  IF p_command_key IS NULL
    OR p_position IS NULL
    OR p_details IS NULL
    OR p_holds IS NULL
    OR jsonb_typeof(p_position) <> 'object'
    OR jsonb_typeof(p_details) <> 'array'
    OR jsonb_typeof(p_holds) <> 'array'
  THEN
    RAISE EXCEPTION 'FUND_POSITION_PAYLOAD_INVALID';
  END IF;

  IF NOT p_position ?& ARRAY[
    'report_date','total_fund_available','collections_not_deposited','grand_total',
    'deposit_for_day','payment_for_day'
  ] OR p_position - ARRAY[
    'report_date','total_fund_available','collections_not_deposited','grand_total',
    'deposit_for_day','payment_for_day'
  ] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'FUND_POSITION_KEYS_INVALID';
  END IF;

  IF jsonb_typeof(p_position->'report_date') <> 'string'
    OR jsonb_typeof(p_position->'total_fund_available') <> 'number'
    OR (p_position->>'total_fund_available')::numeric <> trunc((p_position->>'total_fund_available')::numeric)
    OR jsonb_typeof(p_position->'collections_not_deposited') <> 'number'
    OR (p_position->>'collections_not_deposited')::numeric <> trunc((p_position->>'collections_not_deposited')::numeric)
    OR jsonb_typeof(p_position->'grand_total') <> 'number'
    OR (p_position->>'grand_total')::numeric <> trunc((p_position->>'grand_total')::numeric)
    OR jsonb_typeof(p_position->'deposit_for_day') NOT IN ('number','null')
    OR (
      jsonb_typeof(p_position->'deposit_for_day') = 'number'
      AND (p_position->>'deposit_for_day')::numeric <> trunc((p_position->>'deposit_for_day')::numeric)
    )
    OR jsonb_typeof(p_position->'payment_for_day') NOT IN ('number','null')
    OR (
      jsonb_typeof(p_position->'payment_for_day') = 'number'
      AND (p_position->>'payment_for_day')::numeric <> trunc((p_position->>'payment_for_day')::numeric)
    )
  THEN
    RAISE EXCEPTION 'FUND_POSITION_VALUES_INVALID';
  END IF;

  IF jsonb_array_length(p_details) > 1000 OR jsonb_array_length(p_holds) > 1000 THEN
    RAISE EXCEPTION 'FUND_POSITION_CHILD_LIMIT_EXCEEDED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_details) AS e(item)
    WHERE jsonb_typeof(item) <> 'object'
      OR item - ARRAY[
        'bank_name','balance','fund_applied','net_balance','non_validated_deposit','grand_balance'
      ] <> '{}'::jsonb
      OR NOT item ?& ARRAY[
        'bank_name','balance','fund_applied','net_balance','non_validated_deposit','grand_balance'
      ]
      OR jsonb_typeof(item->'bank_name') <> 'string'
      OR btrim(item->>'bank_name') = ''
      OR jsonb_typeof(item->'balance') <> 'number'
      OR (item->>'balance')::numeric <> trunc((item->>'balance')::numeric)
      OR jsonb_typeof(item->'fund_applied') <> 'number'
      OR (item->>'fund_applied')::numeric <> trunc((item->>'fund_applied')::numeric)
      OR jsonb_typeof(item->'net_balance') <> 'number'
      OR (item->>'net_balance')::numeric <> trunc((item->>'net_balance')::numeric)
      OR jsonb_typeof(item->'non_validated_deposit') <> 'number'
      OR (item->>'non_validated_deposit')::numeric <> trunc((item->>'non_validated_deposit')::numeric)
      OR jsonb_typeof(item->'grand_balance') <> 'number'
      OR (item->>'grand_balance')::numeric <> trunc((item->>'grand_balance')::numeric)
  ) THEN
    RAISE EXCEPTION 'FUND_POSITION_DETAIL_KEYS_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_holds) AS e(item)
    WHERE jsonb_typeof(item) <> 'object'
      OR item - ARRAY[
        'hold_date','cheque_number','client_bank','client_name','facture_reference',
        'amount','deposit_date','days_remaining'
      ] <> '{}'::jsonb
      OR NOT item ?& ARRAY[
        'hold_date','cheque_number','client_bank','client_name','facture_reference',
        'amount','deposit_date','days_remaining'
      ]
      OR jsonb_typeof(item->'hold_date') <> 'string'
      OR jsonb_typeof(item->'cheque_number') NOT IN ('string','null')
      OR jsonb_typeof(item->'client_bank') NOT IN ('string','null')
      OR jsonb_typeof(item->'client_name') <> 'string'
      OR btrim(item->>'client_name') = ''
      OR jsonb_typeof(item->'facture_reference') NOT IN ('string','null')
      OR jsonb_typeof(item->'amount') <> 'number'
      OR (item->>'amount')::numeric <> trunc((item->>'amount')::numeric)
      OR jsonb_typeof(item->'deposit_date') NOT IN ('string','null')
      OR jsonb_typeof(item->'days_remaining') NOT IN ('number','null')
      OR (
        jsonb_typeof(item->'days_remaining') = 'number'
        AND (item->>'days_remaining')::numeric <> trunc((item->>'days_remaining')::numeric)
      )
  ) THEN
    RAISE EXCEPTION 'FUND_POSITION_HOLD_KEYS_INVALID';
  END IF;

  v_payload_hash := md5(jsonb_build_object(
    'position', p_position,
    'details', p_details,
    'holds', p_holds
  )::text);

  INSERT INTO public.financial_write_commands (
    actor_id, operation, command_key, payload_hash
  ) VALUES (
    v_actor, 'SAVE_FUND_POSITION_V1', p_command_key, v_payload_hash
  ) ON CONFLICT DO NOTHING;

  SELECT * INTO v_command
  FROM public.financial_write_commands
  WHERE actor_id = v_actor
    AND operation = 'SAVE_FUND_POSITION_V1'
    AND command_key = p_command_key
  FOR UPDATE;

  IF v_command.payload_hash <> v_payload_hash THEN
    RAISE EXCEPTION 'FINANCIAL_COMMAND_PAYLOAD_MISMATCH';
  END IF;
  IF v_command.result_id IS NOT NULL THEN
    RETURN v_command.result_id;
  END IF;

  INSERT INTO public.fund_position (
    report_date, total_fund_available, collections_not_deposited, grand_total,
    deposit_for_day, payment_for_day
  ) VALUES (
    (p_position->>'report_date')::date,
    (p_position->>'total_fund_available')::bigint,
    (p_position->>'collections_not_deposited')::bigint,
    (p_position->>'grand_total')::bigint,
    NULLIF(p_position->>'deposit_for_day', '')::bigint,
    NULLIF(p_position->>'payment_for_day', '')::bigint
  ) RETURNING id INTO v_fund_position_id;

  INSERT INTO public.fund_position_detail (
    fund_position_id, bank_name, balance, fund_applied, net_balance,
    non_validated_deposit, grand_balance
  )
  SELECT
    v_fund_position_id, x.bank_name, x.balance, x.fund_applied, x.net_balance,
    x.non_validated_deposit, x.grand_balance
  FROM jsonb_to_recordset(p_details) AS x(
    bank_name text,
    balance bigint,
    fund_applied bigint,
    net_balance bigint,
    non_validated_deposit bigint,
    grand_balance bigint
  );

  INSERT INTO public.fund_position_hold (
    fund_position_id, hold_date, cheque_number, client_bank, client_name,
    facture_reference, amount, deposit_date, days_remaining
  )
  SELECT
    v_fund_position_id, x.hold_date, x.cheque_number, x.client_bank, x.client_name,
    x.facture_reference, x.amount, x.deposit_date, x.days_remaining
  FROM jsonb_to_recordset(p_holds) AS x(
    hold_date date,
    cheque_number text,
    client_bank text,
    client_name text,
    facture_reference text,
    amount bigint,
    deposit_date date,
    days_remaining integer
  );

  UPDATE public.financial_write_commands
  SET result_id = v_fund_position_id, completed_at = now()
  WHERE actor_id = v_actor
    AND operation = 'SAVE_FUND_POSITION_V1'
    AND command_key = p_command_key;

  RETURN v_fund_position_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_bank_report_atomic_v1(uuid,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_bank_report_atomic_v1(uuid,jsonb,jsonb,jsonb,jsonb)
  TO authenticated;

REVOKE ALL ON FUNCTION public.save_fund_position_atomic_v1(uuid,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_fund_position_atomic_v1(uuid,jsonb,jsonb,jsonb)
  TO authenticated;

COMMENT ON TABLE public.financial_write_commands IS
  'Private idempotency ledger for atomic bank report and fund position writes.';
COMMENT ON FUNCTION public.save_bank_report_atomic_v1(uuid,jsonb,jsonb,jsonb,jsonb) IS
  'Atomically persists one bank report and all facilities, deposits and unpaid items.';
COMMENT ON FUNCTION public.save_fund_position_atomic_v1(uuid,jsonb,jsonb,jsonb) IS
  'Atomically persists one fund position and all detail and hold rows.';

COMMIT;
