-- 0Z1B Core Collections / Remittances
-- LOCAL CANDIDATE ONLY. Never applied to Supabase by this lot.
-- Additive schema: Bank Sync Flow prepares, controls and justifies collections.
-- It neither executes payments nor posts accounting entries.

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Core tables (eleven) and structural invariants
-- --------------------------------------------------------------------------

CREATE TABLE public.collection_receipts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES auth.users(id),
  client_name                text NOT NULL CHECK (btrim(client_name) <> ''),
  receipt_method             text NOT NULL CHECK (receipt_method IN ('CHECK','EFFECT','TRANSFER','CASH')),
  expected_amount            numeric(18,2) NOT NULL CHECK (expected_amount > 0),
  currency                   text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  client_bank                text,
  declared_credit_date       date,
  source_report_date         date,
  business_nature            text NOT NULL DEFAULT 'STANDARD'
                               CHECK (business_nature IN ('STANDARD','PROROGATION')),
  legacy_classification      text CHECK (legacy_classification IN ('LEGACY_PENDING_0Z1C','LEGACY_UNGROUPED')),
  status                     text NOT NULL DEFAULT 'UNMATCHED'
                               CHECK (status IN ('UNMATCHED','PARTIALLY_MATCHED','MATCHED','REJECTED','EXCEPTION')),
  duplicate_review_status    text NOT NULL DEFAULT 'NONE'
                               CHECK (duplicate_review_status IN ('NONE','OPEN','RESOLVED')),
  duplicate_basis            text,
  display_note               text,
  CONSTRAINT collection_receipts_prorogation_classification CHECK (
    (business_nature = 'PROROGATION' AND legacy_classification = 'LEGACY_PENDING_0Z1C')
    OR business_nature <> 'PROROGATION'
  )
);

CREATE TABLE public.collection_instruments (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES auth.users(id),
  instrument_type            text NOT NULL CHECK (instrument_type IN ('CHECK','EFFECT')),
  identity_namespace         text NOT NULL CHECK (btrim(identity_namespace) <> ''),
  normalized_identity_hash   text NOT NULL CHECK (normalized_identity_hash ~ '^[0-9a-f]{64}$'),
  identity_strength          text NOT NULL CHECK (identity_strength IN ('STRONG_VERIFIED','PROBABILISTIC')),
  instrument_reference       text,
  drawn_bank                 text,
  client_name                text,
  nominal_amount             numeric(18,2) CHECK (nominal_amount > 0),
  currency                   text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  maturity_date              date
);

CREATE UNIQUE INDEX uq_collection_instruments_strong_identity
  ON public.collection_instruments(identity_namespace, normalized_identity_hash)
  WHERE identity_strength = 'STRONG_VERIFIED';

CREATE TABLE public.collection_bank_remittances (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES auth.users(id),
  validated_at               timestamptz,
  validated_by               uuid REFERENCES auth.users(id),
  deposit_account_id         uuid NOT NULL REFERENCES public.daily_statement_account_registry(id),
  deposit_currency           text NOT NULL CHECK (deposit_currency ~ '^[A-Z]{3}$'),
  declared_total_amount      numeric(18,2) NOT NULL CHECK (declared_total_amount > 0),
  deposit_date               date NOT NULL,
  slip_reference             text,
  remittance_kind            text NOT NULL DEFAULT 'PHYSICAL'
                               CHECK (remittance_kind IN ('PHYSICAL','LOGICAL_TRANSFER','LOGICAL_CASH')),
  capture_mode               text NOT NULL CHECK (capture_mode IN ('MANUAL','SCAN','IMPORT')),
  source_document_ref        text,
  document_metadata          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(document_metadata) = 'object'),
  capture_control_status     text NOT NULL DEFAULT 'TO_REVIEW'
                               CHECK (capture_control_status IN ('TO_REVIEW','HUMAN_CONFIRMED')),
  status                     text NOT NULL DEFAULT 'DRAFT'
                               CHECK (status IN ('DRAFT','SUBMITTED','WITHDRAWAL_REQUESTED','WITHDRAWN',
                                                 'CREDIT_PROPOSED','PARTIALLY_CREDITED','CREDITED',
                                                 'CANCELLED','EXCEPTION'))
);

CREATE TABLE public.collection_bank_remittance_items (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES auth.users(id),
  validated_at               timestamptz,
  validated_by               uuid REFERENCES auth.users(id),
  remittance_id              uuid NOT NULL REFERENCES public.collection_bank_remittances(id),
  receipt_id                 uuid NOT NULL REFERENCES public.collection_receipts(id),
  instrument_id              uuid REFERENCES public.collection_instruments(id),
  item_amount                numeric(18,2) NOT NULL CHECK (item_amount > 0),
  currency                   text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status                     text NOT NULL DEFAULT 'DRAFT'
                               CHECK (status IN ('DRAFT','SUBMITTED','WITHDRAWAL_REQUESTED','WITHDRAWN',
                                                 'CREDIT_PROPOSED','PARTIALLY_CREDITED','CREDITED',
                                                 'CANCELLED','EXCEPTION')),
  replaces_remittance_item_id uuid REFERENCES public.collection_bank_remittance_items(id),
  CONSTRAINT collection_item_no_self_replace CHECK (replaces_remittance_item_id IS NULL OR replaces_remittance_item_id <> id)
);

CREATE UNIQUE INDEX uq_collection_item_current_receipt
  ON public.collection_bank_remittance_items(receipt_id)
  WHERE status NOT IN ('WITHDRAWN','CANCELLED');

CREATE UNIQUE INDEX uq_collection_item_replacement
  ON public.collection_bank_remittance_items(replaces_remittance_item_id)
  WHERE replaces_remittance_item_id IS NOT NULL;

CREATE TABLE public.collection_import_origins (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES auth.users(id),
  receipt_id                 uuid NOT NULL REFERENCES public.collection_receipts(id),
  excel_filename             text NOT NULL CHECK (btrim(excel_filename) <> ''),
  excel_source_row           integer NOT NULL CHECK (excel_source_row > 0),
  unique_excel_traceability  text,
  source_row_hash            text NOT NULL CHECK (source_row_hash ~ '^[0-9a-f]{64}$'),
  load_id                    uuid NOT NULL,
  is_active                  boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX uq_collection_import_origin_active
  ON public.collection_import_origins(excel_filename, excel_source_row)
  WHERE is_active;

CREATE TABLE public.collection_invoice_allocations (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES auth.users(id),
  receipt_id                 uuid NOT NULL REFERENCES public.collection_receipts(id),
  invoice_reference          text NOT NULL CHECK (btrim(invoice_reference) <> ''),
  allocated_amount           numeric(18,2) NOT NULL CHECK (allocated_amount > 0),
  currency                   text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status                     text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','CANCELLED')),
  validation_evidence        text
);

CREATE TABLE public.collection_match_proposals (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  proposed_by                uuid NOT NULL REFERENCES auth.users(id),
  decided_at                 timestamptz,
  decided_by                 uuid REFERENCES auth.users(id),
  credit_daily_line_id       uuid NOT NULL REFERENCES public.daily_statement_lines_canonical(id),
  fee_evidence_plan          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fee_evidence_plan) = 'array'),
  allocation_plan            jsonb NOT NULL CHECK (jsonb_typeof(allocation_plan) = 'array'),
  proposed_credit_consumed_amount numeric(18,2) NOT NULL CHECK (proposed_credit_consumed_amount > 0),
  proposed_fee_consumed_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (proposed_fee_consumed_amount >= 0),
  evidence_basis             text NOT NULL CHECK (evidence_basis IN ('EXACT_CREDIT','NET_OF_DISCOUNT','FEES_SEPARATE')),
  allocation_mode            text NOT NULL CHECK (allocation_mode IN ('SINGLE_ITEM','AGGREGATED')),
  status                     text NOT NULL DEFAULT 'PENDING'
                               CHECK (status IN ('PENDING','CONFIRMED','REJECTED','WITHDRAWN','INVALIDATED','SUPERSEDED')),
  reason                     text NOT NULL CHECK (btrim(reason) <> ''),
  cross_account_fee          boolean NOT NULL DEFAULT false,
  cross_account_fee_reason   text,
  reference_source_daily_line_id uuid REFERENCES public.daily_statement_lines_canonical(id),
  extracted_reference        text,
  normalized_reference       text,
  reference_confidence       numeric(5,4) CHECK (reference_confidence BETWEEN 0 AND 1),
  CONSTRAINT collection_proposal_fee_shape CHECK (
    (evidence_basis = 'FEES_SEPARATE' AND proposed_fee_consumed_amount > 0 AND jsonb_array_length(fee_evidence_plan) > 0)
    OR (evidence_basis <> 'FEES_SEPARATE' AND proposed_fee_consumed_amount = 0 AND jsonb_array_length(fee_evidence_plan) = 0)
  ),
  CONSTRAINT collection_proposal_cross_account_reason CHECK (
    NOT cross_account_fee OR (cross_account_fee_reason IS NOT NULL AND btrim(cross_account_fee_reason) <> '')
  )
);

CREATE TABLE public.collection_bank_line_allocations (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES auth.users(id),
  proposal_id                uuid NOT NULL REFERENCES public.collection_match_proposals(id),
  allocation_type            text NOT NULL CHECK (allocation_type IN ('CREDIT_ALLOCATION','FEE_EVIDENCE')),
  remittance_item_id         uuid REFERENCES public.collection_bank_remittance_items(id),
  daily_line_id              uuid NOT NULL REFERENCES public.daily_statement_lines_canonical(id),
  evidence_account_id        uuid NOT NULL REFERENCES public.daily_statement_account_registry(id),
  credit_line_consumed_amount numeric(18,2),
  fee_line_consumed_amount   numeric(18,2),
  settled_gross_amount       numeric(18,2),
  observed_fee_amount        numeric(18,2),
  net_liquidity_amount       numeric(18,2),
  evidence_basis             text NOT NULL CHECK (evidence_basis IN ('EXACT_CREDIT','NET_OF_DISCOUNT','FEES_SEPARATE')),
  allocation_mode            text NOT NULL CHECK (allocation_mode IN ('SINGLE_ITEM','AGGREGATED')),
  settlement_extent          text CHECK (settlement_extent IN ('FULL','PARTIAL')),
  allocation_status          text NOT NULL DEFAULT 'CONFIRMED'
                               CHECK (allocation_status IN ('CONFIRMED','EXCEPTION','SUPERSEDED')),
  supersedes_allocation_id   uuid REFERENCES public.collection_bank_line_allocations(id),
  CONSTRAINT collection_allocation_shape CHECK (
    (allocation_type = 'CREDIT_ALLOCATION'
      AND remittance_item_id IS NOT NULL
      AND credit_line_consumed_amount > 0
      AND fee_line_consumed_amount IS NULL
      AND settled_gross_amount > 0
      AND observed_fee_amount >= 0
      AND net_liquidity_amount >= 0
      AND settlement_extent IS NOT NULL)
    OR
    (allocation_type = 'FEE_EVIDENCE'
      AND remittance_item_id IS NULL
      AND credit_line_consumed_amount IS NULL
      AND fee_line_consumed_amount > 0
      AND settled_gross_amount IS NULL
      AND observed_fee_amount IS NULL
      AND net_liquidity_amount IS NULL
      AND settlement_extent IS NULL)
  )
);

CREATE UNIQUE INDEX uq_collection_allocation_supersedes
  ON public.collection_bank_line_allocations(supersedes_allocation_id)
  WHERE supersedes_allocation_id IS NOT NULL;

CREATE TABLE public.collection_events (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  actor_id                   uuid NOT NULL REFERENCES auth.users(id),
  command_name               text NOT NULL,
  event_type                 text NOT NULL,
  aggregate_type             text NOT NULL,
  aggregate_id               uuid,
  correlation_id             uuid NOT NULL,
  effective_at               timestamptz NOT NULL DEFAULT now(),
  amount                     numeric(18,2),
  currency                   text,
  reason                     text,
  metadata                   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX uq_collection_single_system_cutover
  ON public.collection_events(event_type)
  WHERE event_type = 'SYSTEM_OF_RECORD_CUTOVER';

CREATE TABLE public.collection_command_idempotency (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  completed_at               timestamptz,
  actor_id                   uuid NOT NULL REFERENCES auth.users(id),
  command_name               text NOT NULL,
  command_key                text NOT NULL CHECK (btrim(command_key) <> ''),
  payload_hash               text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result_payload             jsonb,
  UNIQUE(actor_id, command_name, command_key)
);

CREATE TABLE public.collection_domain_assignments (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  user_id                    uuid NOT NULL REFERENCES auth.users(id),
  capability                 text NOT NULL CHECK (capability IN (
                               'ENTRY','IMPORT_COLLECTIONS','VALIDATE_REMITTANCE','WITHDRAW_REMITTANCE',
                               'PROPOSE_MATCH','CONFIRM_MATCH','CORRECT_CAPTURE','CANCEL_REMITTANCE',
                               'RESOLVE_DUPLICATE','CORRECT_EVIDENCE','ACTIVATE_CUTOVER','AUDIT','MANAGE_ACCESS')),
  is_active                  boolean NOT NULL DEFAULT true,
  granted_by                 uuid NOT NULL REFERENCES auth.users(id),
  revoked_at                 timestamptz,
  revoked_by                 uuid REFERENCES auth.users(id),
  reason                     text NOT NULL CHECK (btrim(reason) <> ''),
  CONSTRAINT collection_assignment_lifecycle CHECK (
    (is_active AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (NOT is_active AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_collection_active_capability
  ON public.collection_domain_assignments(user_id, capability)
  WHERE is_active;

-- --------------------------------------------------------------------------
-- 2. Private helpers: actor, capability, idempotency, audit and projections
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.collection_require_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_actor) THEN
    RAISE EXCEPTION 'COLLECTION_AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_require_capability(p_actor uuid, p_capability text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.collection_domain_assignments a
    WHERE a.user_id = p_actor AND a.capability = p_capability AND a.is_active
  ) THEN
    RAISE EXCEPTION 'COLLECTION_CAPABILITY_REQUIRED:%', p_capability USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_payload_hash(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_payload, 'null'::jsonb)::text, 'UTF8')),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION public.collection_current_actor_has_capability(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.collection_domain_assignments a
    WHERE a.user_id = auth.uid()
      AND a.capability = upper(p_capability)
      AND a.is_active
  )
$$;

CREATE OR REPLACE FUNCTION public.collection_idempotency_begin(
  p_actor uuid, p_command text, p_key text, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_hash text := public.collection_payload_hash(p_payload); v_row public.collection_command_idempotency%ROWTYPE;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN RAISE EXCEPTION 'COLLECTION_COMMAND_KEY_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_command || ':' || p_key, 0));
  SELECT * INTO v_row FROM public.collection_command_idempotency
   WHERE actor_id=p_actor AND command_name=p_command AND command_key=p_key FOR UPDATE;
  IF FOUND THEN
    IF v_row.payload_hash <> v_hash THEN RAISE EXCEPTION 'COLLECTION_IDEMPOTENCY_PAYLOAD_MISMATCH'; END IF;
    IF v_row.result_payload IS NULL THEN RAISE EXCEPTION 'COLLECTION_IDEMPOTENCY_INCOMPLETE'; END IF;
    RETURN v_row.result_payload;
  END IF;
  INSERT INTO public.collection_command_idempotency(actor_id,command_name,command_key,payload_hash)
  VALUES (p_actor,p_command,p_key,v_hash);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_idempotency_finish(
  p_actor uuid, p_command text, p_key text, p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.collection_command_idempotency
     SET result_payload=p_result, completed_at=now()
   WHERE actor_id=p_actor AND command_name=p_command AND command_key=p_key AND result_payload IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_IDEMPOTENCY_ROW_MISSING'; END IF;
  RETURN p_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_append_event(
  p_actor uuid, p_command text, p_event text, p_aggregate_type text,
  p_aggregate_id uuid, p_correlation_id uuid, p_reason text,
  p_amount numeric DEFAULT NULL, p_currency text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN RAISE EXCEPTION 'COLLECTION_EVENT_METADATA_OBJECT_REQUIRED'; END IF;
  IF p_metadata ?| ARRAY['raw_text','raw_bytes','file_content','account_number','iban','password','secret','token'] THEN
    RAISE EXCEPTION 'COLLECTION_EVENT_SENSITIVE_METADATA_REJECTED';
  END IF;
  INSERT INTO public.collection_events(actor_id,command_name,event_type,aggregate_type,aggregate_id,
    correlation_id,reason,amount,currency,metadata)
  VALUES(p_actor,p_command,p_event,p_aggregate_type,p_aggregate_id,p_correlation_id,
    nullif(btrim(p_reason),''),p_amount,p_currency,p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_events_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'COLLECTION_EVENTS_APPEND_ONLY'; END;
$$;

CREATE TRIGGER trg_collection_events_immutable
BEFORE UPDATE OR DELETE ON public.collection_events
FOR EACH ROW EXECUTE FUNCTION public.collection_events_immutable();

CREATE OR REPLACE FUNCTION public.collection_recompute_receipt(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_expected numeric; v_settled numeric;
BEGIN
  SELECT expected_amount INTO v_expected FROM public.collection_receipts WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_RECEIPT_NOT_FOUND'; END IF;
  SELECT coalesce(sum(a.settled_gross_amount),0) INTO v_settled
    FROM public.collection_bank_line_allocations a
    JOIN public.collection_bank_remittance_items i ON i.id=a.remittance_item_id
   WHERE i.receipt_id=p_receipt_id AND a.allocation_type='CREDIT_ALLOCATION'
     AND a.allocation_status IN ('CONFIRMED','EXCEPTION');
  IF v_settled > v_expected THEN RAISE EXCEPTION 'COLLECTION_RECEIPT_OVERALLOCATED'; END IF;
  UPDATE public.collection_receipts SET updated_at=now(), status=CASE
    WHEN status='REJECTED' THEN 'REJECTED'
    WHEN v_settled=0 THEN 'UNMATCHED'
    WHEN v_settled<v_expected THEN 'PARTIALLY_MATCHED'
    WHEN v_settled=v_expected THEN 'MATCHED'
    ELSE 'EXCEPTION' END WHERE id=p_receipt_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_recompute_item(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_item public.collection_bank_remittance_items%ROWTYPE; v_settled numeric; v_pending boolean; v_bad boolean;
BEGIN
  SELECT * INTO v_item FROM public.collection_bank_remittance_items WHERE id=p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_ITEM_NOT_FOUND'; END IF;
  IF v_item.status IN ('WITHDRAWN','CANCELLED') THEN RETURN; END IF;
  SELECT coalesce(sum(settled_gross_amount),0), bool_or(allocation_status='EXCEPTION')
    INTO v_settled,v_bad FROM public.collection_bank_line_allocations
   WHERE remittance_item_id=p_item_id AND allocation_type='CREDIT_ALLOCATION'
     AND allocation_status IN ('CONFIRMED','EXCEPTION');
  SELECT EXISTS (
    SELECT 1 FROM public.collection_match_proposals p,
      LATERAL jsonb_array_elements(p.allocation_plan) e
    WHERE p.status='PENDING' AND (e->>'remittance_item_id')::uuid=p_item_id
      AND EXISTS (SELECT 1 FROM public.daily_statement_lines_canonical l WHERE l.id=p.credit_daily_line_id AND l.is_active)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p.fee_evidence_plan) f
        LEFT JOIN public.daily_statement_lines_canonical fl ON fl.id=(f->>'daily_line_id')::uuid
        WHERE fl.id IS NULL OR NOT fl.is_active)
  ) INTO v_pending;
  IF v_settled > v_item.item_amount THEN RAISE EXCEPTION 'COLLECTION_ITEM_OVERALLOCATED'; END IF;
  UPDATE public.collection_bank_remittance_items SET status=CASE
    WHEN coalesce(v_bad,false) THEN 'EXCEPTION'
    WHEN v_settled=v_item.item_amount THEN 'CREDITED'
    WHEN v_settled>0 THEN 'PARTIALLY_CREDITED'
    WHEN v_pending THEN 'CREDIT_PROPOSED'
    WHEN v_item.validated_at IS NOT NULL THEN 'SUBMITTED'
    ELSE 'DRAFT' END WHERE id=p_item_id;
  PERFORM public.collection_recompute_receipt(v_item.receipt_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_recompute_remittance(p_remittance_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_total int; v_current int; v_status text;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE status NOT IN ('WITHDRAWN','CANCELLED'))
    INTO v_total,v_current FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id;
  IF v_total=0 THEN v_status:='DRAFT';
  ELSIF v_current=0 THEN
    SELECT CASE WHEN bool_and(status='WITHDRAWN') THEN 'WITHDRAWN'
                WHEN bool_and(status='CANCELLED') THEN 'CANCELLED' ELSE 'EXCEPTION' END
      INTO v_status FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id;
  ELSIF EXISTS (SELECT 1 FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id AND status='EXCEPTION') THEN v_status:='EXCEPTION';
  ELSIF EXISTS (SELECT 1 FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id AND status='WITHDRAWAL_REQUESTED') THEN v_status:='WITHDRAWAL_REQUESTED';
  ELSIF EXISTS (SELECT 1 FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id AND status='PARTIALLY_CREDITED') THEN v_status:='PARTIALLY_CREDITED';
  ELSIF NOT EXISTS (SELECT 1 FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id AND status NOT IN ('WITHDRAWN','CANCELLED','CREDITED')) THEN v_status:='CREDITED';
  ELSIF EXISTS (SELECT 1 FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id AND status='CREDIT_PROPOSED') THEN v_status:='CREDIT_PROPOSED';
  ELSIF EXISTS (SELECT 1 FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id AND status='SUBMITTED') THEN v_status:='SUBMITTED';
  ELSE v_status:='DRAFT'; END IF;
  UPDATE public.collection_bank_remittances SET status=v_status,updated_at=now() WHERE id=p_remittance_id;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. Entry, validation, withdrawal, rerouting and import commands
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_collection_remittance_v1(
  p_command_key text, p_receipt jsonb, p_remittance jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_require_actor();
  v_cached jsonb; v_result jsonb; v_receipt_id uuid; v_remittance_id uuid;
  v_account public.daily_statement_account_registry%ROWTYPE;
  v_currency text := upper(p_receipt->>'currency');
  v_business_nature text := upper(coalesce(p_receipt->>'business_nature','STANDARD'));
BEGIN
  PERFORM public.collection_require_capability(v_actor,'ENTRY');
  v_cached := public.collection_idempotency_begin(v_actor,'create_collection_remittance_v1',p_command_key,
    jsonb_build_object('receipt',p_receipt,'remittance',p_remittance));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_account FROM public.daily_statement_account_registry
   WHERE id=(p_remittance->>'deposit_account_id')::uuid AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_ACTIVE_DEPOSIT_ACCOUNT_REQUIRED'; END IF;
  IF v_account.currency <> v_currency OR upper(p_remittance->>'deposit_currency') <> v_currency THEN
    RAISE EXCEPTION 'COLLECTION_CURRENCY_MISMATCH';
  END IF;
  IF upper(p_receipt->>'receipt_method') NOT IN ('CHECK','EFFECT','TRANSFER','CASH') THEN
    RAISE EXCEPTION 'COLLECTION_RECEIPT_METHOD_INVALID';
  END IF;
  IF v_business_nature NOT IN ('STANDARD','PROROGATION') THEN RAISE EXCEPTION 'COLLECTION_BUSINESS_NATURE_INVALID'; END IF;

  INSERT INTO public.collection_receipts(created_by,client_name,receipt_method,expected_amount,currency,
    client_bank,declared_credit_date,source_report_date,business_nature,legacy_classification,display_note)
  VALUES(v_actor,btrim(p_receipt->>'client_name'),upper(p_receipt->>'receipt_method'),
    (p_receipt->>'expected_amount')::numeric,v_currency,nullif(btrim(p_receipt->>'client_bank'),''),
    nullif(p_receipt->>'declared_credit_date','')::date,nullif(p_receipt->>'source_report_date','')::date,
    v_business_nature,CASE WHEN v_business_nature='PROROGATION' THEN 'LEGACY_PENDING_0Z1C' ELSE NULL END,
    nullif(btrim(p_receipt->>'display_note'),''))
  RETURNING id INTO v_receipt_id;

  INSERT INTO public.collection_bank_remittances(created_by,deposit_account_id,deposit_currency,
    declared_total_amount,deposit_date,slip_reference,remittance_kind,capture_mode,source_document_ref,
    document_metadata,capture_control_status)
  VALUES(v_actor,v_account.id,v_currency,(p_remittance->>'declared_total_amount')::numeric,
    (p_remittance->>'deposit_date')::date,nullif(btrim(p_remittance->>'slip_reference'),''),
    upper(coalesce(p_remittance->>'remittance_kind','PHYSICAL')),
    upper(p_remittance->>'capture_mode'),nullif(btrim(p_remittance->>'source_document_ref'),''),
    coalesce(p_remittance->'document_metadata','{}'::jsonb),
    CASE WHEN upper(p_remittance->>'capture_mode')='SCAN' THEN 'TO_REVIEW' ELSE 'HUMAN_CONFIRMED' END)
  RETURNING id INTO v_remittance_id;

  PERFORM public.collection_append_event(v_actor,'create_collection_remittance_v1','REMITTANCE_CREATED',
    'REMITTANCE',v_remittance_id,v_remittance_id,NULL,(p_receipt->>'expected_amount')::numeric,v_currency,
    jsonb_build_object('receipt_id',v_receipt_id,'capture_mode',upper(p_remittance->>'capture_mode')));
  v_result := jsonb_build_object('outcome','created','receipt_id',v_receipt_id,'remittance_id',v_remittance_id);
  RETURN public.collection_idempotency_finish(v_actor,'create_collection_remittance_v1',p_command_key,v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_collection_remittance_item_v1(
  p_command_key text, p_remittance_id uuid, p_receipt_id uuid, p_item jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_require_actor(); v_cached jsonb; v_result jsonb;
  v_rem public.collection_bank_remittances%ROWTYPE; v_receipt public.collection_receipts%ROWTYPE;
  v_instrument_id uuid; v_item_id uuid; v_inst jsonb := p_item->'instrument'; v_collision boolean := false;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'ENTRY');
  v_cached := public.collection_idempotency_begin(v_actor,'add_collection_remittance_item_v1',p_command_key,
    jsonb_build_object('remittance_id',p_remittance_id,'receipt_id',p_receipt_id,'item',p_item));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_rem FROM public.collection_bank_remittances WHERE id=p_remittance_id FOR UPDATE;
  SELECT * INTO v_receipt FROM public.collection_receipts WHERE id=p_receipt_id FOR UPDATE;
  IF v_rem.id IS NULL OR v_receipt.id IS NULL THEN RAISE EXCEPTION 'COLLECTION_REMITTANCE_OR_RECEIPT_NOT_FOUND'; END IF;
  IF v_rem.status <> 'DRAFT' THEN RAISE EXCEPTION 'COLLECTION_REMITTANCE_NOT_DRAFT'; END IF;
  IF v_receipt.status='REJECTED' THEN RAISE EXCEPTION 'COLLECTION_RECEIPT_REJECTED'; END IF;
  IF v_rem.deposit_currency <> v_receipt.currency
     OR upper(p_item->>'currency') <> v_receipt.currency
     OR (p_item->>'item_amount')::numeric <> v_receipt.expected_amount THEN
    RAISE EXCEPTION 'COLLECTION_ITEM_AMOUNT_OR_CURRENCY_MISMATCH';
  END IF;

  IF v_receipt.receipt_method IN ('CHECK','EFFECT') THEN
    IF v_inst IS NULL OR jsonb_typeof(v_inst)<>'object' THEN RAISE EXCEPTION 'COLLECTION_INSTRUMENT_REQUIRED'; END IF;
    IF upper(v_inst->>'instrument_type') <> v_receipt.receipt_method THEN RAISE EXCEPTION 'COLLECTION_INSTRUMENT_TYPE_MISMATCH'; END IF;
    IF upper(v_inst->>'identity_strength')='STRONG_VERIFIED' THEN
      SELECT id INTO v_instrument_id FROM public.collection_instruments
       WHERE identity_namespace=v_inst->>'identity_namespace'
         AND normalized_identity_hash=v_inst->>'normalized_identity_hash'
         AND identity_strength='STRONG_VERIFIED' FOR SHARE;
    ELSE
      SELECT EXISTS (SELECT 1 FROM public.collection_instruments
       WHERE identity_namespace=v_inst->>'identity_namespace'
         AND normalized_identity_hash=v_inst->>'normalized_identity_hash') INTO v_collision;
    END IF;
    IF v_instrument_id IS NULL THEN
      INSERT INTO public.collection_instruments(created_by,instrument_type,identity_namespace,
        normalized_identity_hash,identity_strength,instrument_reference,drawn_bank,client_name,
        nominal_amount,currency,maturity_date)
      VALUES(v_actor,upper(v_inst->>'instrument_type'),v_inst->>'identity_namespace',
        v_inst->>'normalized_identity_hash',upper(v_inst->>'identity_strength'),
        nullif(btrim(v_inst->>'instrument_reference'),''),nullif(btrim(v_inst->>'drawn_bank'),''),
        nullif(btrim(v_inst->>'client_name'),''),nullif(v_inst->>'nominal_amount','')::numeric,
        nullif(upper(v_inst->>'currency'),''),nullif(v_inst->>'maturity_date','')::date)
      RETURNING id INTO v_instrument_id;
    END IF;
    IF v_collision THEN
      UPDATE public.collection_receipts SET duplicate_review_status='OPEN',
        duplicate_basis=(v_inst->>'identity_namespace')||':'||(v_inst->>'normalized_identity_hash'),updated_at=now()
       WHERE id=p_receipt_id;
    END IF;
  ELSIF v_inst IS NOT NULL AND v_inst <> 'null'::jsonb THEN
    RAISE EXCEPTION 'COLLECTION_INSTRUMENT_NOT_ALLOWED';
  END IF;

  INSERT INTO public.collection_bank_remittance_items(created_by,remittance_id,receipt_id,instrument_id,
    item_amount,currency)
  VALUES(v_actor,p_remittance_id,p_receipt_id,v_instrument_id,v_receipt.expected_amount,v_receipt.currency)
  RETURNING id INTO v_item_id;
  PERFORM public.collection_append_event(v_actor,'add_collection_remittance_item_v1','REMITTANCE_ITEM_ADDED',
    'REMITTANCE_ITEM',v_item_id,p_remittance_id,NULL,v_receipt.expected_amount,v_receipt.currency,
    jsonb_build_object('receipt_id',p_receipt_id,'duplicate_review_open',v_collision));
  v_result:=jsonb_build_object('outcome','added','item_id',v_item_id,'instrument_id',v_instrument_id,
    'duplicate_review_status',CASE WHEN v_collision THEN 'OPEN' ELSE 'NONE' END);
  RETURN public.collection_idempotency_finish(v_actor,'add_collection_remittance_item_v1',p_command_key,v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_collection_remittance_v1(
  p_command_key text, p_remittance_id uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
DECLARE v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_result jsonb;
  v_rem public.collection_bank_remittances%ROWTYPE; v_sum numeric; v_count int;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'VALIDATE_REMITTANCE');
  v_cached:=public.collection_idempotency_begin(v_actor,'validate_collection_remittance_v1',p_command_key,
    jsonb_build_object('remittance_id',p_remittance_id,'reason',p_reason)); IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_rem FROM public.collection_bank_remittances WHERE id=p_remittance_id FOR UPDATE;
  IF v_rem.id IS NULL THEN RAISE EXCEPTION 'COLLECTION_REMITTANCE_NOT_FOUND'; END IF;
  IF v_rem.status<>'DRAFT' THEN RAISE EXCEPTION 'COLLECTION_REMITTANCE_NOT_DRAFT'; END IF;
  IF v_rem.created_by=v_actor THEN RAISE EXCEPTION 'COLLECTION_SECOND_ACTOR_REQUIRED'; END IF;
  IF v_rem.capture_control_status<>'HUMAN_CONFIRMED' THEN RAISE EXCEPTION 'COLLECTION_CAPTURE_HUMAN_CONFIRMATION_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_statement_account_registry a
    WHERE a.id=v_rem.deposit_account_id AND a.status='active' AND a.currency=v_rem.deposit_currency) THEN
    RAISE EXCEPTION 'COLLECTION_ACTIVE_DEPOSIT_ACCOUNT_REQUIRED'; END IF;
  SELECT count(*),coalesce(sum(i.item_amount),0) INTO v_count,v_sum
    FROM public.collection_bank_remittance_items i JOIN public.collection_receipts r ON r.id=i.receipt_id
   WHERE i.remittance_id=p_remittance_id AND i.status='DRAFT'
     AND i.currency=v_rem.deposit_currency AND r.currency=i.currency
     AND r.expected_amount=i.item_amount AND r.duplicate_review_status<>'OPEN';
  IF v_count=0 OR v_count<>(SELECT count(*) FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id)
     OR v_sum<>v_rem.declared_total_amount THEN RAISE EXCEPTION 'COLLECTION_REMITTANCE_VALIDATION_INVARIANT_FAILED'; END IF;
  UPDATE public.collection_bank_remittances SET validated_at=now(),validated_by=v_actor,updated_at=now() WHERE id=p_remittance_id;
  UPDATE public.collection_bank_remittance_items SET status='SUBMITTED',validated_at=now(),validated_by=v_actor
   WHERE remittance_id=p_remittance_id AND status='DRAFT';
  PERFORM public.collection_recompute_remittance(p_remittance_id);
  PERFORM public.collection_append_event(v_actor,'validate_collection_remittance_v1','REMITTANCE_VALIDATED',
    'REMITTANCE',p_remittance_id,p_remittance_id,p_reason,v_sum,v_rem.deposit_currency,'{}');
  v_result:=jsonb_build_object('outcome','validated','remittance_id',p_remittance_id,'item_count',v_count);
  RETURN public.collection_idempotency_finish(v_actor,'validate_collection_remittance_v1',p_command_key,v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_collection_remittance_withdrawal_v1(
  p_command_key text, p_item_id uuid, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_item public.collection_bank_remittance_items%ROWTYPE; v_result jsonb;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'WITHDRAW_REMITTANCE');
  IF p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'COLLECTION_REASON_REQUIRED'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'request_collection_remittance_withdrawal_v1',p_command_key,
    jsonb_build_object('item_id',p_item_id,'reason',p_reason)); IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_item FROM public.collection_bank_remittance_items WHERE id=p_item_id FOR UPDATE;
  IF v_item.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'COLLECTION_WITHDRAWAL_STATE_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM public.collection_match_proposals p,LATERAL jsonb_array_elements(p.allocation_plan)e
    WHERE p.status='PENDING' AND (e->>'remittance_item_id')::uuid=p_item_id
      AND EXISTS(SELECT 1 FROM public.daily_statement_lines_canonical l WHERE l.id=p.credit_daily_line_id AND l.is_active)) THEN
    RAISE EXCEPTION 'COLLECTION_ACTIVE_PROPOSAL_BLOCKS_WITHDRAWAL'; END IF;
  UPDATE public.collection_bank_remittance_items SET status='WITHDRAWAL_REQUESTED' WHERE id=p_item_id;
  PERFORM public.collection_append_event(v_actor,'request_collection_remittance_withdrawal_v1','WITHDRAWAL_REQUESTED',
    'REMITTANCE_ITEM',p_item_id,v_item.remittance_id,p_reason,v_item.item_amount,v_item.currency,'{}');
  PERFORM public.collection_recompute_remittance(v_item.remittance_id);
  v_result:=jsonb_build_object('outcome','withdrawal_requested','item_id',p_item_id);
  RETURN public.collection_idempotency_finish(v_actor,'request_collection_remittance_withdrawal_v1',p_command_key,v_result);
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_collection_remittance_withdrawal_v1(
  p_command_key text, p_item_id uuid, p_decision text, p_proof_reference text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_item public.collection_bank_remittance_items%ROWTYPE;
  v_request_actor uuid; v_result jsonb; v_decision text:=upper(p_decision);
BEGIN
  PERFORM public.collection_require_capability(v_actor,'WITHDRAW_REMITTANCE');
  IF v_decision NOT IN ('ACCEPT','REJECT') OR p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'COLLECTION_WITHDRAWAL_DECISION_INVALID'; END IF;
  IF p_proof_reference IS NULL OR btrim(p_proof_reference)='' THEN RAISE EXCEPTION 'COLLECTION_WITHDRAWAL_PROOF_REQUIRED'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'confirm_collection_remittance_withdrawal_v1',p_command_key,
    jsonb_build_object('item_id',p_item_id,'decision',v_decision,'proof_reference',p_proof_reference,'reason',p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_item FROM public.collection_bank_remittance_items WHERE id=p_item_id FOR UPDATE;
  IF v_item.status<>'WITHDRAWAL_REQUESTED' THEN RAISE EXCEPTION 'COLLECTION_WITHDRAWAL_NOT_REQUESTED'; END IF;
  SELECT actor_id INTO v_request_actor FROM public.collection_events
   WHERE aggregate_id=p_item_id AND event_type='WITHDRAWAL_REQUESTED' ORDER BY created_at DESC,id DESC LIMIT 1;
  IF v_request_actor=v_actor THEN RAISE EXCEPTION 'COLLECTION_SECOND_ACTOR_REQUIRED'; END IF;
  UPDATE public.collection_bank_remittance_items SET status=CASE WHEN v_decision='ACCEPT' THEN 'WITHDRAWN' ELSE 'SUBMITTED' END WHERE id=p_item_id;
  PERFORM public.collection_append_event(v_actor,'confirm_collection_remittance_withdrawal_v1',
    CASE WHEN v_decision='ACCEPT' THEN 'WITHDRAWAL_CONFIRMED' ELSE 'WITHDRAWAL_REJECTED' END,
    'REMITTANCE_ITEM',p_item_id,v_item.remittance_id,p_reason,v_item.item_amount,v_item.currency,
    jsonb_build_object('proof_reference',p_proof_reference));
  PERFORM public.collection_recompute_remittance(v_item.remittance_id);
  v_result:=jsonb_build_object('outcome',lower(v_decision),'item_id',p_item_id);
  RETURN public.collection_idempotency_finish(v_actor,'confirm_collection_remittance_withdrawal_v1',p_command_key,v_result);
END; $$;

CREATE OR REPLACE FUNCTION public.resubmit_collection_remittance_item_v1(
  p_command_key text, p_withdrawn_item_id uuid, p_new_deposit_account_id uuid,
  p_deposit_date date, p_slip_reference text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_old public.collection_bank_remittance_items%ROWTYPE;
  v_old_rem public.collection_bank_remittances%ROWTYPE; v_account public.daily_statement_account_registry%ROWTYPE;
  v_remittance_id uuid; v_item_id uuid; v_result jsonb;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'WITHDRAW_REMITTANCE');
  IF p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'COLLECTION_REASON_REQUIRED'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'resubmit_collection_remittance_item_v1',p_command_key,
    jsonb_build_object('withdrawn_item_id',p_withdrawn_item_id,'new_deposit_account_id',p_new_deposit_account_id,
      'deposit_date',p_deposit_date,'slip_reference',p_slip_reference,'reason',p_reason)); IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_old FROM public.collection_bank_remittance_items WHERE id=p_withdrawn_item_id FOR UPDATE;
  IF v_old.status<>'WITHDRAWN' THEN RAISE EXCEPTION 'COLLECTION_ITEM_NOT_WITHDRAWN'; END IF;
  SELECT * INTO v_old_rem FROM public.collection_bank_remittances WHERE id=v_old.remittance_id FOR SHARE;
  SELECT * INTO v_account FROM public.daily_statement_account_registry WHERE id=p_new_deposit_account_id AND status='active' FOR SHARE;
  IF v_account.id IS NULL OR v_account.currency<>v_old.currency THEN RAISE EXCEPTION 'COLLECTION_NEW_ACCOUNT_INVALID'; END IF;
  IF v_account.id=v_old_rem.deposit_account_id THEN RAISE EXCEPTION 'COLLECTION_REROUTE_ACCOUNT_MUST_CHANGE'; END IF;
  INSERT INTO public.collection_bank_remittances(created_by,deposit_account_id,deposit_currency,declared_total_amount,
    deposit_date,slip_reference,remittance_kind,capture_mode,capture_control_status)
  VALUES(v_actor,v_account.id,v_old.currency,v_old.item_amount,p_deposit_date,nullif(btrim(p_slip_reference),''),
    'PHYSICAL','MANUAL','HUMAN_CONFIRMED') RETURNING id INTO v_remittance_id;
  INSERT INTO public.collection_bank_remittance_items(created_by,remittance_id,receipt_id,instrument_id,item_amount,
    currency,replaces_remittance_item_id)
  VALUES(v_actor,v_remittance_id,v_old.receipt_id,v_old.instrument_id,v_old.item_amount,v_old.currency,p_withdrawn_item_id)
  RETURNING id INTO v_item_id;
  PERFORM public.collection_append_event(v_actor,'resubmit_collection_remittance_item_v1','REMITTANCE_ITEM_RESUBMITTED',
    'REMITTANCE_ITEM',v_item_id,v_remittance_id,p_reason,v_old.item_amount,v_old.currency,
    jsonb_build_object('replaces_item_id',p_withdrawn_item_id,'previous_account_id',v_old_rem.deposit_account_id,
      'new_account_id',p_new_deposit_account_id));
  v_result:=jsonb_build_object('outcome','resubmitted_draft','remittance_id',v_remittance_id,'item_id',v_item_id);
  RETURN public.collection_idempotency_finish(v_actor,'resubmit_collection_remittance_item_v1',p_command_key,v_result);
END; $$;

CREATE OR REPLACE FUNCTION public.allocate_collection_invoice_v1(
  p_command_key text, p_receipt_id uuid, p_invoice_reference text,
  p_amount numeric, p_currency text, p_validation_evidence text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_receipt public.collection_receipts%ROWTYPE;
  v_total numeric; v_id uuid; v_result jsonb;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'ENTRY');
  v_cached:=public.collection_idempotency_begin(v_actor,'allocate_collection_invoice_v1',p_command_key,
    jsonb_build_object('receipt_id',p_receipt_id,'invoice_reference',p_invoice_reference,'amount',p_amount,
      'currency',upper(p_currency),'validation_evidence',p_validation_evidence)); IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_receipt FROM public.collection_receipts WHERE id=p_receipt_id FOR UPDATE;
  IF v_receipt.id IS NULL OR p_amount<=0 OR upper(p_currency)<>v_receipt.currency THEN RAISE EXCEPTION 'COLLECTION_INVOICE_ALLOCATION_INVALID'; END IF;
  SELECT coalesce(sum(allocated_amount),0) INTO v_total FROM public.collection_invoice_allocations
   WHERE receipt_id=p_receipt_id AND status='CONFIRMED';
  IF v_total+p_amount>v_receipt.expected_amount THEN RAISE EXCEPTION 'COLLECTION_INVOICE_OVERALLOCATION'; END IF;
  INSERT INTO public.collection_invoice_allocations(created_by,receipt_id,invoice_reference,allocated_amount,currency,validation_evidence)
  VALUES(v_actor,p_receipt_id,btrim(p_invoice_reference),p_amount,v_receipt.currency,nullif(btrim(p_validation_evidence),'')) RETURNING id INTO v_id;
  PERFORM public.collection_append_event(v_actor,'allocate_collection_invoice_v1','INVOICE_ALLOCATED','RECEIPT',p_receipt_id,
    p_receipt_id,NULL,p_amount,v_receipt.currency,jsonb_build_object('invoice_allocation_id',v_id));
  v_result:=jsonb_build_object('outcome','allocated','invoice_allocation_id',v_id);
  RETURN public.collection_idempotency_finish(v_actor,'allocate_collection_invoice_v1',p_command_key,v_result);
END; $$;

CREATE OR REPLACE FUNCTION public.import_collection_receipts_v1(
  p_command_key text, p_mode text, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_result jsonb;
  v_mode text:=upper(p_mode); v_row jsonb; v_account public.daily_statement_account_registry%ROWTYPE;
  v_receipt_id uuid; v_remittance_id uuid; v_item_id uuid; v_instrument_id uuid;
  v_load_id uuid:=gen_random_uuid(); v_accepted int:=0; v_skipped int:=0; v_source_hash text;
  v_business text; v_request public.collection_events%ROWTYPE; v_last public.collection_events%ROWTYPE;
  v_request_id uuid; v_event_id uuid; v_cutover_date date; v_sha text;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'IMPORT_COLLECTIONS');
  IF v_mode IN ('REQUEST_CUTOVER','CANCEL_CUTOVER_REQUEST','CONFIRM_CUTOVER') THEN
    PERFORM public.collection_require_capability(v_actor,'ACTIVATE_CUTOVER');
  ELSIF v_mode<>'LOAD' THEN RAISE EXCEPTION 'COLLECTION_IMPORT_MODE_INVALID'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'import_collection_receipts_v1',p_command_key,
    jsonb_build_object('mode',v_mode,'payload',p_payload)); IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  -- All four phases serialize on the same transaction lock. This also enforces
  -- active-request uniqueness; no impossible partial index over journal history.
  PERFORM pg_advisory_xact_lock(hashtextextended('collection-core-cutover-v1',0));

  IF v_mode='LOAD' THEN
    IF EXISTS (SELECT 1 FROM public.collection_events WHERE event_type='SYSTEM_OF_RECORD_CUTOVER') THEN
      RAISE EXCEPTION 'COLLECTION_LEGACY_LOAD_CLOSED_AFTER_CUTOVER'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.collection_events r
      WHERE r.event_type='CUTOVER_REQUESTED'
        AND NOT EXISTS (SELECT 1 FROM public.collection_events c
          WHERE c.event_type IN ('CUTOVER_REQUEST_CANCELLED','SYSTEM_OF_RECORD_CUTOVER')
            AND c.metadata->>'request_id'=r.id::text)
    ) THEN RAISE EXCEPTION 'COLLECTION_LOAD_BLOCKED_BY_CUTOVER_REQUEST'; END IF;
    v_sha:=lower(p_payload->>'file_sha256');
    IF v_sha !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_payload->'rows')<>'array' THEN
      RAISE EXCEPTION 'COLLECTION_IMPORT_PAYLOAD_INVALID'; END IF;

    FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
      IF coalesce(v_row->>'excel_filename','')='' OR coalesce((v_row->>'excel_source_row')::int,0)<=0 THEN
        RAISE EXCEPTION 'COLLECTION_IMPORT_ORIGIN_REQUIRED'; END IF;
      v_source_hash:=lower(v_row->>'source_row_hash');
      IF v_source_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'COLLECTION_SOURCE_ROW_HASH_INVALID'; END IF;
      SELECT o.receipt_id INTO v_receipt_id FROM public.collection_import_origins o
       WHERE o.excel_filename=v_row->>'excel_filename'
         AND o.excel_source_row=(v_row->>'excel_source_row')::int AND o.is_active FOR SHARE;
      IF FOUND THEN
        IF NOT EXISTS (SELECT 1 FROM public.collection_import_origins o WHERE o.receipt_id=v_receipt_id
          AND o.source_row_hash=v_source_hash AND o.is_active) THEN
          RAISE EXCEPTION 'COLLECTION_IMPORT_ORIGIN_PAYLOAD_MISMATCH'; END IF;
        v_skipped:=v_skipped+1; CONTINUE;
      END IF;
      SELECT * INTO v_account FROM public.daily_statement_account_registry
       WHERE id=(v_row->>'deposit_account_id')::uuid AND status='active' FOR SHARE;
      IF v_account.id IS NULL OR v_account.currency<>upper(v_row->>'currency') THEN
        RAISE EXCEPTION 'COLLECTION_IMPORT_ACCOUNT_OR_CURRENCY_INVALID'; END IF;
      v_business:=upper(coalesce(v_row->>'business_nature','STANDARD'));
      INSERT INTO public.collection_receipts(created_by,client_name,receipt_method,expected_amount,currency,
        client_bank,declared_credit_date,source_report_date,business_nature,legacy_classification,duplicate_review_status)
      VALUES(v_actor,btrim(v_row->>'client_name'),upper(v_row->>'receipt_method'),(v_row->>'expected_amount')::numeric,
        v_account.currency,nullif(btrim(v_row->>'client_bank'),''),nullif(v_row->>'declared_credit_date','')::date,
        (v_row->>'source_report_date')::date,v_business,
        CASE WHEN v_business='PROROGATION' THEN 'LEGACY_PENDING_0Z1C' ELSE 'LEGACY_UNGROUPED' END,
        CASE WHEN coalesce((v_row->>'duplicate_probable')::boolean,false) THEN 'OPEN' ELSE 'NONE' END)
      RETURNING id INTO v_receipt_id;
      IF upper(v_row->>'receipt_method') IN ('CHECK','EFFECT') THEN
        IF (v_row->>'identity_strength')='STRONG_VERIFIED' THEN
          SELECT id INTO v_instrument_id FROM public.collection_instruments
           WHERE identity_namespace=v_row->>'identity_namespace'
             AND normalized_identity_hash=v_row->>'normalized_identity_hash'
             AND identity_strength='STRONG_VERIFIED' FOR SHARE;
        ELSE v_instrument_id:=NULL; END IF;
        IF v_instrument_id IS NULL THEN
          INSERT INTO public.collection_instruments(created_by,instrument_type,identity_namespace,normalized_identity_hash,
            identity_strength,instrument_reference,drawn_bank,client_name,nominal_amount,currency,maturity_date)
          VALUES(v_actor,upper(v_row->>'receipt_method'),v_row->>'identity_namespace',v_row->>'normalized_identity_hash',
            upper(v_row->>'identity_strength'),nullif(btrim(v_row->>'instrument_reference'),''),
            nullif(btrim(v_row->>'drawn_bank'),''),btrim(v_row->>'client_name'),(v_row->>'expected_amount')::numeric,
            v_account.currency,nullif(v_row->>'maturity_date','')::date) RETURNING id INTO v_instrument_id;
        END IF;
      ELSE v_instrument_id:=NULL; END IF;
      INSERT INTO public.collection_bank_remittances(created_by,deposit_account_id,deposit_currency,declared_total_amount,
        deposit_date,slip_reference,remittance_kind,capture_mode,source_document_ref,capture_control_status)
      VALUES(v_actor,v_account.id,v_account.currency,(v_row->>'expected_amount')::numeric,(v_row->>'deposit_date')::date,
        nullif(btrim(v_row->>'slip_reference'),''),
        CASE upper(v_row->>'receipt_method') WHEN 'TRANSFER' THEN 'LOGICAL_TRANSFER' WHEN 'CASH' THEN 'LOGICAL_CASH' ELSE 'PHYSICAL' END,
        'IMPORT',nullif(btrim(v_row->>'source_document_ref'),''),'HUMAN_CONFIRMED') RETURNING id INTO v_remittance_id;
      INSERT INTO public.collection_bank_remittance_items(created_by,remittance_id,receipt_id,instrument_id,item_amount,currency)
      VALUES(v_actor,v_remittance_id,v_receipt_id,v_instrument_id,(v_row->>'expected_amount')::numeric,v_account.currency)
      RETURNING id INTO v_item_id;
      INSERT INTO public.collection_import_origins(created_by,receipt_id,excel_filename,excel_source_row,
        unique_excel_traceability,source_row_hash,load_id)
      VALUES(v_actor,v_receipt_id,v_row->>'excel_filename',(v_row->>'excel_source_row')::int,
        nullif(v_row->>'unique_excel_traceability',''),v_source_hash,v_load_id);
      v_accepted:=v_accepted+1;
    END LOOP;
    v_event_id:=public.collection_append_event(v_actor,'import_collection_receipts_v1','IMPORT_LOAD_COMPLETED',
      'IMPORT_LOAD',v_load_id,v_load_id,NULL,NULL,NULL,
      jsonb_build_object('load_id',v_load_id,'file_sha256',v_sha,'accepted_count',v_accepted,'idempotent_count',v_skipped));
    v_result:=jsonb_build_object('outcome','loaded','load_id',v_load_id,'event_id',v_event_id,
      'accepted_count',v_accepted,'idempotent_count',v_skipped,'file_sha256',v_sha);

  ELSIF v_mode='REQUEST_CUTOVER' THEN
    IF EXISTS (SELECT 1 FROM public.collection_events WHERE event_type='SYSTEM_OF_RECORD_CUTOVER') THEN
      RAISE EXCEPTION 'COLLECTION_CUTOVER_ALREADY_ACTIVE'; END IF;
    IF EXISTS (SELECT 1 FROM public.collection_events r WHERE r.event_type='CUTOVER_REQUESTED'
      AND NOT EXISTS (SELECT 1 FROM public.collection_events c WHERE c.event_type IN ('CUTOVER_REQUEST_CANCELLED','SYSTEM_OF_RECORD_CUTOVER')
        AND c.metadata->>'request_id'=r.id::text)) THEN RAISE EXCEPTION 'COLLECTION_CUTOVER_REQUEST_ALREADY_ACTIVE'; END IF;
    IF coalesce((p_payload->>'report_validated')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'COLLECTION_VALIDATED_IMPORT_REPORT_REQUIRED'; END IF;
    v_cutover_date:=(p_payload->>'cutover_business_date')::date; v_sha:=lower(p_payload->>'final_file_sha256');
    IF v_sha !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'COLLECTION_FINAL_FILE_SHA_INVALID'; END IF;
    SELECT * INTO v_last FROM public.collection_events WHERE event_type='IMPORT_LOAD_COMPLETED'
      ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
    IF v_last.id IS NULL OR v_last.aggregate_id<>(p_payload->>'last_load_id')::uuid
       OR v_last.metadata->>'file_sha256'<>v_sha THEN RAISE EXCEPTION 'COLLECTION_LAST_LOAD_MISMATCH'; END IF;
    IF EXISTS (SELECT 1 FROM public.collection_import_origins o JOIN public.collection_receipts r ON r.id=o.receipt_id
      WHERE o.load_id=v_last.aggregate_id AND r.source_report_date>=v_cutover_date) THEN
      RAISE EXCEPTION 'COLLECTION_CUTOVER_DATE_OVERLAPS_SOURCE'; END IF;
    v_request_id:=public.collection_append_event(v_actor,'import_collection_receipts_v1','CUTOVER_REQUESTED',
      'SYSTEM_OF_RECORD',NULL,gen_random_uuid(),p_payload->>'report_reference',NULL,NULL,
      jsonb_build_object('cutover_business_date',v_cutover_date,'final_file_sha256',v_sha,
        'last_load_id',v_last.aggregate_id,'report_reference',p_payload->>'report_reference'));
    v_result:=jsonb_build_object('outcome','cutover_requested','request_id',v_request_id);

  ELSE
    SELECT * INTO v_request FROM public.collection_events r WHERE r.event_type='CUTOVER_REQUESTED'
      AND NOT EXISTS (SELECT 1 FROM public.collection_events c WHERE c.event_type IN ('CUTOVER_REQUEST_CANCELLED','SYSTEM_OF_RECORD_CUTOVER')
        AND c.metadata->>'request_id'=r.id::text)
      ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
    IF v_request.id IS NULL THEN RAISE EXCEPTION 'COLLECTION_ACTIVE_CUTOVER_REQUEST_NOT_FOUND'; END IF;
    IF v_request.actor_id=v_actor THEN RAISE EXCEPTION 'COLLECTION_SECOND_ACTOR_REQUIRED'; END IF;
    IF (p_payload->>'request_id')::uuid<>v_request.id THEN RAISE EXCEPTION 'COLLECTION_CUTOVER_REQUEST_MISMATCH'; END IF;
    IF p_payload->>'reason' IS NULL OR btrim(p_payload->>'reason')='' THEN RAISE EXCEPTION 'COLLECTION_REASON_REQUIRED'; END IF;
    IF v_mode='CANCEL_CUTOVER_REQUEST' THEN
      v_event_id:=public.collection_append_event(v_actor,'import_collection_receipts_v1','CUTOVER_REQUEST_CANCELLED',
        'SYSTEM_OF_RECORD',NULL,v_request.correlation_id,p_payload->>'reason',NULL,NULL,
        jsonb_build_object('request_id',v_request.id));
      v_result:=jsonb_build_object('outcome','cutover_request_cancelled','request_id',v_request.id,'event_id',v_event_id);
    ELSE
      SELECT * INTO v_last FROM public.collection_events WHERE event_type='IMPORT_LOAD_COMPLETED'
        ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
      IF v_last.aggregate_id<>(v_request.metadata->>'last_load_id')::uuid
         OR v_last.metadata->>'file_sha256'<>v_request.metadata->>'final_file_sha256'
         OR p_payload->>'final_file_sha256'<>v_request.metadata->>'final_file_sha256'
         OR (p_payload->>'cutover_business_date')::date<>(v_request.metadata->>'cutover_business_date')::date THEN
        RAISE EXCEPTION 'COLLECTION_CUTOVER_CONFIRMATION_MISMATCH'; END IF;
      v_event_id:=public.collection_append_event(v_actor,'import_collection_receipts_v1','SYSTEM_OF_RECORD_CUTOVER',
        'SYSTEM_OF_RECORD',v_request.id,v_request.correlation_id,p_payload->>'reason',NULL,NULL,
        jsonb_build_object('request_id',v_request.id,'cutover_business_date',v_request.metadata->>'cutover_business_date',
          'final_file_sha256',v_request.metadata->>'final_file_sha256','last_load_id',v_request.metadata->>'last_load_id'));
      v_result:=jsonb_build_object('outcome','cutover_confirmed','request_id',v_request.id,'event_id',v_event_id);
    END IF;
  END IF;
  RETURN public.collection_idempotency_finish(v_actor,'import_collection_receipts_v1',p_command_key,v_result);
END; $$;

-- --------------------------------------------------------------------------
-- 4. Matching proposals, second-actor confirmation and evidence rebind
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.propose_collection_match_v1(
  p_command_key text, p_action text, p_proposal_id uuid, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_result jsonb;
  v_action text:=upper(p_action); v_proposal public.collection_match_proposals%ROWTYPE;
  v_credit public.daily_statement_lines_canonical%ROWTYPE; v_credit_account uuid; v_credit_bank text; v_credit_currency text;
  v_entry jsonb; v_fee jsonb; v_item public.collection_bank_remittance_items%ROWTYPE;
  v_receipt public.collection_receipts%ROWTYPE;
  v_rem public.collection_bank_remittances%ROWTYPE; v_fee_line public.daily_statement_lines_canonical%ROWTYPE;
  v_fee_account uuid; v_fee_bank text; v_sum_credit numeric:=0; v_sum_fee numeric:=0; v_sum_gross numeric:=0;
  v_existing numeric; v_receipt_existing numeric; v_reserved numeric; v_count int:=0; v_ids uuid[]:='{}'; v_fee_ids uuid[]:='{}'; v_id uuid;
  v_basis text:=upper(p_payload->>'evidence_basis'); v_mode text:=upper(p_payload->>'allocation_mode');
BEGIN
  PERFORM public.collection_require_capability(v_actor,'PROPOSE_MATCH');
  v_cached:=public.collection_idempotency_begin(v_actor,'propose_collection_match_v1',p_command_key,
    jsonb_build_object('action',v_action,'proposal_id',p_proposal_id,'payload',p_payload));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_payload->>'reason' IS NULL OR btrim(p_payload->>'reason')='' THEN RAISE EXCEPTION 'COLLECTION_REASON_REQUIRED'; END IF;

  IF v_action='WITHDRAW_PROPOSAL' THEN
    SELECT * INTO v_proposal FROM public.collection_match_proposals WHERE id=p_proposal_id FOR UPDATE;
    IF v_proposal.id IS NULL OR v_proposal.status<>'PENDING' THEN RAISE EXCEPTION 'COLLECTION_PENDING_PROPOSAL_NOT_FOUND'; END IF;
    IF v_proposal.proposed_by<>v_actor THEN RAISE EXCEPTION 'COLLECTION_ONLY_PROPOSER_CAN_WITHDRAW'; END IF;
    UPDATE public.collection_match_proposals SET status='WITHDRAWN',decided_at=now(),decided_by=v_actor WHERE id=p_proposal_id;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_proposal.allocation_plan) LOOP
      PERFORM public.collection_recompute_item((v_entry->>'remittance_item_id')::uuid);
      SELECT remittance_id INTO v_id FROM public.collection_bank_remittance_items WHERE id=(v_entry->>'remittance_item_id')::uuid;
      PERFORM public.collection_recompute_remittance(v_id);
    END LOOP;
    PERFORM public.collection_append_event(v_actor,'propose_collection_match_v1','MATCH_PROPOSAL_WITHDRAWN',
      'MATCH_PROPOSAL',p_proposal_id,p_proposal_id,p_payload->>'reason',NULL,NULL,'{}');
    v_result:=jsonb_build_object('outcome','withdrawn','proposal_id',p_proposal_id);
    RETURN public.collection_idempotency_finish(v_actor,'propose_collection_match_v1',p_command_key,v_result);
  ELSIF v_action<>'CREATE' THEN RAISE EXCEPTION 'COLLECTION_PROPOSAL_ACTION_INVALID'; END IF;

  IF v_basis NOT IN ('EXACT_CREDIT','NET_OF_DISCOUNT','FEES_SEPARATE')
     OR v_mode NOT IN ('SINGLE_ITEM','AGGREGATED')
     OR jsonb_typeof(p_payload->'allocation_plan')<>'array'
     OR jsonb_array_length(p_payload->'allocation_plan')=0 THEN RAISE EXCEPTION 'COLLECTION_PROPOSAL_SHAPE_INVALID'; END IF;
  IF (p_payload->>'proposed_credit_consumed_amount')::numeric<=0 THEN RAISE EXCEPTION 'COLLECTION_PROPOSED_CREDIT_INVALID'; END IF;

  -- Deterministic locks: Daily lines, then items and receipts.
  PERFORM 1 FROM public.daily_statement_lines_canonical l
   WHERE l.id=(p_payload->>'credit_daily_line_id')::uuid
      OR l.id IN (SELECT (f->>'daily_line_id')::uuid FROM jsonb_array_elements(coalesce(p_payload->'fee_evidence_plan','[]')) f)
   ORDER BY l.id FOR UPDATE;
  SELECT l.* INTO v_credit FROM public.daily_statement_lines_canonical l
   WHERE l.id=(p_payload->>'credit_daily_line_id')::uuid;
  SELECT u.account_registry_id,u.currency INTO v_credit_account,v_credit_currency
    FROM public.daily_statement_units_canonical u WHERE u.id=v_credit.canonical_unit_id;
  IF v_credit.id IS NULL OR NOT v_credit.is_active OR v_credit.direction<>'credit' OR v_credit_account IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_ACTIVE_CREDIT_LINE_REQUIRED'; END IF;
  SELECT bank INTO v_credit_bank FROM public.daily_statement_account_registry WHERE id=v_credit_account;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_payload->'allocation_plan') LOOP
    v_id:=(v_entry->>'remittance_item_id')::uuid;
    IF v_id=ANY(v_ids) THEN RAISE EXCEPTION 'COLLECTION_DUPLICATE_ITEM_IN_PLAN'; END IF;
    v_ids:=array_append(v_ids,v_id); v_count:=v_count+1;
    SELECT * INTO v_item FROM public.collection_bank_remittance_items WHERE id=v_id FOR UPDATE;
    SELECT * INTO v_rem FROM public.collection_bank_remittances WHERE id=v_item.remittance_id FOR UPDATE;
    SELECT * INTO v_receipt FROM public.collection_receipts WHERE id=v_item.receipt_id FOR UPDATE;
    IF v_item.id IS NULL OR v_item.status NOT IN ('SUBMITTED','PARTIALLY_CREDITED')
       OR v_rem.deposit_account_id<>v_credit_account OR v_item.currency<>v_credit.currency
       OR v_rem.deposit_currency<>v_credit.currency THEN RAISE EXCEPTION 'COLLECTION_ITEM_CREDIT_ACCOUNT_OR_STATE_INVALID'; END IF;
    IF EXISTS (SELECT 1 FROM public.collection_receipts WHERE id=v_item.receipt_id AND duplicate_review_status='OPEN') THEN
      RAISE EXCEPTION 'COLLECTION_DUPLICATE_REVIEW_BLOCKS_MATCH'; END IF;
    IF EXISTS (SELECT 1 FROM public.collection_match_proposals p,LATERAL jsonb_array_elements(p.allocation_plan)e
      WHERE p.status='PENDING' AND (e->>'remittance_item_id')::uuid=v_item.id
        AND EXISTS(SELECT 1 FROM public.daily_statement_lines_canonical l WHERE l.id=p.credit_daily_line_id AND l.is_active)
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.fee_evidence_plan) f
          LEFT JOIN public.daily_statement_lines_canonical fl ON fl.id=(f->>'daily_line_id')::uuid
          WHERE fl.id IS NULL OR NOT fl.is_active)) THEN RAISE EXCEPTION 'COLLECTION_ITEM_ALREADY_RESERVED'; END IF;
    SELECT coalesce(sum(settled_gross_amount),0) INTO v_existing FROM public.collection_bank_line_allocations
      WHERE remittance_item_id=v_item.id AND allocation_type='CREDIT_ALLOCATION'
        AND allocation_status IN ('CONFIRMED','EXCEPTION');
    SELECT coalesce(sum(a.settled_gross_amount),0) INTO v_receipt_existing
      FROM public.collection_bank_line_allocations a
      JOIN public.collection_bank_remittance_items ri ON ri.id=a.remittance_item_id
      WHERE ri.receipt_id=v_item.receipt_id
        AND a.allocation_type='CREDIT_ALLOCATION'
        AND a.allocation_status IN ('CONFIRMED','EXCEPTION');
    IF (v_entry->>'credit_line_consumed_amount')::numeric<0
       OR (v_entry->>'settled_gross_amount')::numeric<=0
       OR (v_entry->>'observed_fee_amount')::numeric<0
       OR v_existing+(v_entry->>'settled_gross_amount')::numeric>v_item.item_amount THEN
      RAISE EXCEPTION 'COLLECTION_ITEM_PLAN_OVERALLOCATION'; END IF;
    IF v_receipt_existing+(v_entry->>'settled_gross_amount')::numeric>v_receipt.expected_amount THEN
      RAISE EXCEPTION 'COLLECTION_RECEIPT_PLAN_OVERALLOCATION'; END IF;
    IF v_basis='EXACT_CREDIT' AND ((v_entry->>'settled_gross_amount')::numeric<>(v_entry->>'credit_line_consumed_amount')::numeric
       OR (v_entry->>'observed_fee_amount')::numeric<>0) THEN RAISE EXCEPTION 'COLLECTION_EXACT_CREDIT_EQUATION_INVALID'; END IF;
    IF v_basis='NET_OF_DISCOUNT' AND (v_entry->>'settled_gross_amount')::numeric<>
       (v_entry->>'credit_line_consumed_amount')::numeric+(v_entry->>'observed_fee_amount')::numeric THEN
      RAISE EXCEPTION 'COLLECTION_NET_DISCOUNT_EQUATION_INVALID'; END IF;
    IF v_basis='FEES_SEPARATE' AND (v_entry->>'settled_gross_amount')::numeric<>(v_entry->>'credit_line_consumed_amount')::numeric THEN
      RAISE EXCEPTION 'COLLECTION_SEPARATE_FEE_EQUATION_INVALID'; END IF;
    v_sum_credit:=v_sum_credit+(v_entry->>'credit_line_consumed_amount')::numeric;
    v_sum_fee:=v_sum_fee+(v_entry->>'observed_fee_amount')::numeric;
    v_sum_gross:=v_sum_gross+(v_entry->>'settled_gross_amount')::numeric;
  END LOOP;
  IF (v_mode='SINGLE_ITEM' AND v_count<>1) OR (v_mode='AGGREGATED' AND v_count<2) THEN
    RAISE EXCEPTION 'COLLECTION_ALLOCATION_MODE_COUNT_INVALID'; END IF;
  IF v_sum_credit<>(p_payload->>'proposed_credit_consumed_amount')::numeric THEN RAISE EXCEPTION 'COLLECTION_CREDIT_PLAN_TOTAL_MISMATCH'; END IF;

  SELECT coalesce(sum(a.credit_line_consumed_amount),0) INTO v_existing
    FROM public.collection_bank_line_allocations a WHERE a.daily_line_id=v_credit.id
      AND a.allocation_type='CREDIT_ALLOCATION' AND a.allocation_status IN ('CONFIRMED','EXCEPTION');
  SELECT coalesce(sum((e->>'credit_line_consumed_amount')::numeric),0) INTO v_reserved
    FROM public.collection_match_proposals p,LATERAL jsonb_array_elements(p.allocation_plan)e
   WHERE p.status='PENDING' AND p.credit_daily_line_id=v_credit.id
     AND EXISTS(SELECT 1 FROM public.daily_statement_lines_canonical l WHERE l.id=p.credit_daily_line_id AND l.is_active)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.fee_evidence_plan) f
       LEFT JOIN public.daily_statement_lines_canonical fl ON fl.id=(f->>'daily_line_id')::uuid WHERE fl.id IS NULL OR NOT fl.is_active);
  IF v_existing+v_reserved+v_sum_credit>abs(v_credit.signed_amount) THEN RAISE EXCEPTION 'COLLECTION_CREDIT_LINE_OVERRESERVED'; END IF;

  IF v_basis='FEES_SEPARATE' THEN
    IF jsonb_typeof(p_payload->'fee_evidence_plan')<>'array' OR jsonb_array_length(p_payload->'fee_evidence_plan')=0 THEN
      RAISE EXCEPTION 'COLLECTION_FEE_EVIDENCE_REQUIRED'; END IF;
    v_reserved:=0;
    FOR v_fee IN SELECT value FROM jsonb_array_elements(p_payload->'fee_evidence_plan') LOOP
      v_id:=(v_fee->>'daily_line_id')::uuid;
      IF v_id=ANY(v_fee_ids) OR v_id=v_credit.id THEN RAISE EXCEPTION 'COLLECTION_DUPLICATE_FEE_LINE'; END IF;
      v_fee_ids:=array_append(v_fee_ids,v_id);
      SELECT l.* INTO v_fee_line FROM public.daily_statement_lines_canonical l WHERE l.id=v_id;
      SELECT u.account_registry_id INTO v_fee_account FROM public.daily_statement_units_canonical u
       WHERE u.id=v_fee_line.canonical_unit_id;
      IF v_fee_line.id IS NULL OR NOT v_fee_line.is_active OR v_fee_line.direction<>'debit' OR v_fee_line.currency<>v_credit.currency THEN
        RAISE EXCEPTION 'COLLECTION_ACTIVE_FEE_DEBIT_REQUIRED'; END IF;
      IF v_fee_account<>v_credit_account THEN
        SELECT bank INTO v_fee_bank FROM public.daily_statement_account_registry WHERE id=v_fee_account;
        IF NOT coalesce((p_payload->>'cross_account_fee')::boolean,false) OR v_fee_bank<>v_credit_bank THEN
          RAISE EXCEPTION 'COLLECTION_CROSS_ACCOUNT_FEE_INVALID'; END IF;
      END IF;
      SELECT coalesce(sum(fee_line_consumed_amount),0) INTO v_existing FROM public.collection_bank_line_allocations
       WHERE daily_line_id=v_id AND allocation_type='FEE_EVIDENCE' AND allocation_status IN ('CONFIRMED','EXCEPTION');
      SELECT coalesce(sum((f->>'fee_line_consumed_amount')::numeric),0) INTO v_reserved
       FROM public.collection_match_proposals p,LATERAL jsonb_array_elements(p.fee_evidence_plan) f
       WHERE p.status='PENDING' AND (f->>'daily_line_id')::uuid=v_id
         AND EXISTS(SELECT 1 FROM public.daily_statement_lines_canonical l WHERE l.id=p.credit_daily_line_id AND l.is_active)
         AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.fee_evidence_plan) x
           LEFT JOIN public.daily_statement_lines_canonical fl ON fl.id=(x->>'daily_line_id')::uuid WHERE fl.id IS NULL OR NOT fl.is_active);
      IF (v_fee->>'fee_line_consumed_amount')::numeric<=0
         OR v_existing+v_reserved+(v_fee->>'fee_line_consumed_amount')::numeric>abs(v_fee_line.signed_amount) THEN
        RAISE EXCEPTION 'COLLECTION_FEE_LINE_OVERRESERVED'; END IF;
    END LOOP;
    SELECT sum((f->>'fee_line_consumed_amount')::numeric) INTO v_reserved FROM jsonb_array_elements(p_payload->'fee_evidence_plan') f;
    IF v_sum_fee<>(p_payload->>'proposed_fee_consumed_amount')::numeric OR v_sum_fee<>v_reserved THEN
      RAISE EXCEPTION 'COLLECTION_FEE_PLAN_TOTAL_MISMATCH'; END IF;
  ELSIF coalesce((p_payload->>'proposed_fee_consumed_amount')::numeric,0)<>0
     OR coalesce(jsonb_array_length(p_payload->'fee_evidence_plan'),0)<>0 THEN RAISE EXCEPTION 'COLLECTION_UNEXPECTED_FEE_PLAN'; END IF;

  INSERT INTO public.collection_match_proposals(proposed_by,credit_daily_line_id,fee_evidence_plan,allocation_plan,
    proposed_credit_consumed_amount,proposed_fee_consumed_amount,evidence_basis,allocation_mode,reason,
    cross_account_fee,cross_account_fee_reason,reference_source_daily_line_id,extracted_reference,
    normalized_reference,reference_confidence)
  VALUES(v_actor,v_credit.id,coalesce(p_payload->'fee_evidence_plan','[]'),p_payload->'allocation_plan',
    v_sum_credit,CASE WHEN v_basis='FEES_SEPARATE' THEN v_sum_fee ELSE 0 END,v_basis,v_mode,btrim(p_payload->>'reason'),
    coalesce((p_payload->>'cross_account_fee')::boolean,false),nullif(btrim(p_payload->>'cross_account_fee_reason'),''),
    nullif(p_payload->>'reference_source_daily_line_id','')::uuid,nullif(p_payload->>'extracted_reference',''),
    nullif(p_payload->>'normalized_reference',''),nullif(p_payload->>'reference_confidence','')::numeric)
  RETURNING id INTO v_id;
  FOREACH p_proposal_id IN ARRAY v_ids LOOP
    PERFORM public.collection_recompute_item(p_proposal_id);
    SELECT remittance_id INTO v_item.remittance_id FROM public.collection_bank_remittance_items WHERE id=p_proposal_id;
    PERFORM public.collection_recompute_remittance(v_item.remittance_id);
  END LOOP;
  PERFORM public.collection_append_event(v_actor,'propose_collection_match_v1','MATCH_PROPOSED','MATCH_PROPOSAL',v_id,v_id,
    p_payload->>'reason',v_sum_gross,v_credit.currency,
    jsonb_build_object('evidence_basis',v_basis,'allocation_mode',v_mode,'item_count',v_count));
  v_result:=jsonb_build_object('outcome','proposed','proposal_id',v_id,'settled_gross_amount',v_sum_gross);
  RETURN public.collection_idempotency_finish(v_actor,'propose_collection_match_v1',p_command_key,v_result);
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_collection_match_v1(
  p_command_key text, p_proposal_id uuid, p_decision text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_result jsonb; v_decision text:=upper(p_decision);
  v_p public.collection_match_proposals%ROWTYPE; v_credit public.daily_statement_lines_canonical%ROWTYPE;
  v_credit_account uuid; v_entry jsonb; v_fee jsonb; v_item public.collection_bank_remittance_items%ROWTYPE;
  v_rem public.collection_bank_remittances%ROWTYPE; v_existing numeric; v_other_reserved numeric; v_total numeric;
  v_extent text; v_net numeric; v_fee_line public.daily_statement_lines_canonical%ROWTYPE; v_fee_account uuid; v_ids uuid[]:='{}';
BEGIN
  PERFORM public.collection_require_capability(v_actor,'CONFIRM_MATCH');
  IF v_decision NOT IN ('CONFIRM','REJECT') OR p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'COLLECTION_MATCH_DECISION_INVALID'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'confirm_collection_match_v1',p_command_key,
    jsonb_build_object('proposal_id',p_proposal_id,'decision',v_decision,'reason',p_reason)); IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_p FROM public.collection_match_proposals WHERE id=p_proposal_id FOR UPDATE;
  IF v_p.id IS NULL OR v_p.status<>'PENDING' THEN RAISE EXCEPTION 'COLLECTION_PENDING_PROPOSAL_NOT_FOUND'; END IF;
  IF v_p.proposed_by=v_actor THEN RAISE EXCEPTION 'COLLECTION_SECOND_ACTOR_REQUIRED'; END IF;
  IF v_decision='REJECT' THEN
    UPDATE public.collection_match_proposals SET status='REJECTED',decided_at=now(),decided_by=v_actor WHERE id=p_proposal_id;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_p.allocation_plan) LOOP
      PERFORM public.collection_recompute_item((v_entry->>'remittance_item_id')::uuid);
      SELECT remittance_id INTO v_item.remittance_id FROM public.collection_bank_remittance_items WHERE id=(v_entry->>'remittance_item_id')::uuid;
      PERFORM public.collection_recompute_remittance(v_item.remittance_id);
    END LOOP;
    PERFORM public.collection_append_event(v_actor,'confirm_collection_match_v1','MATCH_REJECTED','MATCH_PROPOSAL',p_proposal_id,p_proposal_id,p_reason,NULL,NULL,'{}');
    v_result:=jsonb_build_object('outcome','rejected','proposal_id',p_proposal_id);
    RETURN public.collection_idempotency_finish(v_actor,'confirm_collection_match_v1',p_command_key,v_result);
  END IF;

  PERFORM 1 FROM public.daily_statement_lines_canonical l WHERE l.id=v_p.credit_daily_line_id
    OR l.id IN (SELECT (f->>'daily_line_id')::uuid FROM jsonb_array_elements(v_p.fee_evidence_plan) f)
    ORDER BY l.id FOR UPDATE;
  SELECT l.* INTO v_credit FROM public.daily_statement_lines_canonical l WHERE l.id=v_p.credit_daily_line_id;
  SELECT u.account_registry_id INTO v_credit_account FROM public.daily_statement_units_canonical u
   WHERE u.id=v_credit.canonical_unit_id;
  IF v_credit.id IS NULL OR NOT v_credit.is_active OR v_credit.direction<>'credit'
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_p.fee_evidence_plan) f
       LEFT JOIN public.daily_statement_lines_canonical l ON l.id=(f->>'daily_line_id')::uuid
       WHERE l.id IS NULL OR NOT l.is_active) THEN
    UPDATE public.collection_match_proposals SET status='INVALIDATED',decided_at=now(),decided_by=v_actor WHERE id=p_proposal_id;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_p.allocation_plan) LOOP
      PERFORM public.collection_recompute_item((v_entry->>'remittance_item_id')::uuid);
      SELECT remittance_id INTO v_item.remittance_id FROM public.collection_bank_remittance_items
       WHERE id=(v_entry->>'remittance_item_id')::uuid;
      PERFORM public.collection_recompute_remittance(v_item.remittance_id);
    END LOOP;
    PERFORM public.collection_append_event(v_actor,'confirm_collection_match_v1','MATCH_PROPOSAL_INVALIDATED',
      'MATCH_PROPOSAL',p_proposal_id,p_proposal_id,p_reason,NULL,NULL,
      jsonb_build_object('credit_daily_line_id',v_p.credit_daily_line_id));
    v_result:=jsonb_build_object('outcome','invalidated','proposal_id',p_proposal_id);
    RETURN public.collection_idempotency_finish(v_actor,'confirm_collection_match_v1',p_command_key,v_result);
  END IF;
  SELECT coalesce(sum(credit_line_consumed_amount),0) INTO v_existing FROM public.collection_bank_line_allocations
    WHERE daily_line_id=v_credit.id AND allocation_type='CREDIT_ALLOCATION' AND allocation_status IN ('CONFIRMED','EXCEPTION');
  SELECT coalesce(sum((e->>'credit_line_consumed_amount')::numeric),0) INTO v_other_reserved
    FROM public.collection_match_proposals p,LATERAL jsonb_array_elements(p.allocation_plan)e
    WHERE p.status='PENDING' AND p.id<>v_p.id AND p.credit_daily_line_id=v_credit.id
      AND EXISTS(SELECT 1 FROM public.daily_statement_lines_canonical l WHERE l.id=p.credit_daily_line_id AND l.is_active)
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.fee_evidence_plan) f
        LEFT JOIN public.daily_statement_lines_canonical fl ON fl.id=(f->>'daily_line_id')::uuid WHERE fl.id IS NULL OR NOT fl.is_active);
  IF v_existing+v_other_reserved+v_p.proposed_credit_consumed_amount>abs(v_credit.signed_amount) THEN
    RAISE EXCEPTION 'COLLECTION_CREDIT_LINE_OVERALLOCATED'; END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_p.allocation_plan) LOOP
    SELECT * INTO v_item FROM public.collection_bank_remittance_items WHERE id=(v_entry->>'remittance_item_id')::uuid FOR UPDATE;
    SELECT * INTO v_rem FROM public.collection_bank_remittances WHERE id=v_item.remittance_id FOR UPDATE;
    PERFORM 1 FROM public.collection_receipts WHERE id=v_item.receipt_id FOR UPDATE;
    IF v_item.id IS NULL OR v_item.status NOT IN ('CREDIT_PROPOSED','PARTIALLY_CREDITED')
       OR v_rem.deposit_account_id<>v_credit_account OR v_item.currency<>v_credit.currency THEN
      RAISE EXCEPTION 'COLLECTION_CONFIRM_ITEM_ACCOUNT_OR_STATE_INVALID'; END IF;
    SELECT coalesce(sum(settled_gross_amount),0) INTO v_existing FROM public.collection_bank_line_allocations
      WHERE remittance_item_id=v_item.id AND allocation_type='CREDIT_ALLOCATION' AND allocation_status IN ('CONFIRMED','EXCEPTION');
    v_total:=v_existing+(v_entry->>'settled_gross_amount')::numeric;
    IF v_total>v_item.item_amount THEN RAISE EXCEPTION 'COLLECTION_ITEM_OVERALLOCATED'; END IF;
    v_extent:=CASE WHEN v_total=v_item.item_amount THEN 'FULL' ELSE 'PARTIAL' END;
    v_net:=CASE WHEN v_p.evidence_basis='FEES_SEPARATE' THEN
      (v_entry->>'credit_line_consumed_amount')::numeric-(v_entry->>'observed_fee_amount')::numeric
      ELSE (v_entry->>'credit_line_consumed_amount')::numeric END;
    IF v_net<0 THEN RAISE EXCEPTION 'COLLECTION_NET_LIQUIDITY_NEGATIVE'; END IF;
    INSERT INTO public.collection_bank_line_allocations(created_by,proposal_id,allocation_type,remittance_item_id,
      daily_line_id,evidence_account_id,credit_line_consumed_amount,settled_gross_amount,observed_fee_amount,
      net_liquidity_amount,evidence_basis,allocation_mode,settlement_extent)
    VALUES(v_actor,v_p.id,'CREDIT_ALLOCATION',v_item.id,v_credit.id,v_credit_account,
      (v_entry->>'credit_line_consumed_amount')::numeric,(v_entry->>'settled_gross_amount')::numeric,
      (v_entry->>'observed_fee_amount')::numeric,v_net,v_p.evidence_basis,v_p.allocation_mode,v_extent);
    v_ids:=array_append(v_ids,v_item.id);
  END LOOP;
  FOR v_fee IN SELECT value FROM jsonb_array_elements(v_p.fee_evidence_plan) LOOP
    SELECT l.* INTO v_fee_line FROM public.daily_statement_lines_canonical l WHERE l.id=(v_fee->>'daily_line_id')::uuid;
    SELECT u.account_registry_id INTO v_fee_account FROM public.daily_statement_units_canonical u
     WHERE u.id=v_fee_line.canonical_unit_id;
    IF v_fee_line.id IS NULL OR NOT v_fee_line.is_active OR v_fee_line.direction<>'debit' THEN
      RAISE EXCEPTION 'COLLECTION_FEE_EVIDENCE_INACTIVE'; END IF;
    SELECT coalesce(sum(fee_line_consumed_amount),0) INTO v_existing FROM public.collection_bank_line_allocations
      WHERE daily_line_id=v_fee_line.id AND allocation_type='FEE_EVIDENCE' AND allocation_status IN ('CONFIRMED','EXCEPTION');
    SELECT coalesce(sum((f->>'fee_line_consumed_amount')::numeric),0) INTO v_other_reserved
      FROM public.collection_match_proposals p,LATERAL jsonb_array_elements(p.fee_evidence_plan)f
      WHERE p.status='PENDING' AND p.id<>v_p.id AND (f->>'daily_line_id')::uuid=v_fee_line.id;
    IF v_existing+v_other_reserved+(v_fee->>'fee_line_consumed_amount')::numeric>abs(v_fee_line.signed_amount) THEN
      RAISE EXCEPTION 'COLLECTION_FEE_LINE_OVERALLOCATED'; END IF;
    INSERT INTO public.collection_bank_line_allocations(created_by,proposal_id,allocation_type,daily_line_id,evidence_account_id,
      fee_line_consumed_amount,evidence_basis,allocation_mode)
    VALUES(v_actor,v_p.id,'FEE_EVIDENCE',v_fee_line.id,v_fee_account,(v_fee->>'fee_line_consumed_amount')::numeric,
      v_p.evidence_basis,v_p.allocation_mode);
  END LOOP;
  UPDATE public.collection_match_proposals SET status='CONFIRMED',decided_at=now(),decided_by=v_actor WHERE id=v_p.id;
  FOREACH p_proposal_id IN ARRAY v_ids LOOP
    PERFORM public.collection_recompute_item(p_proposal_id);
    SELECT remittance_id INTO v_item.remittance_id FROM public.collection_bank_remittance_items WHERE id=p_proposal_id;
    PERFORM public.collection_recompute_remittance(v_item.remittance_id);
  END LOOP;
  PERFORM public.collection_append_event(v_actor,'confirm_collection_match_v1','MATCH_CONFIRMED','MATCH_PROPOSAL',v_p.id,v_p.id,
    p_reason,NULL,v_credit.currency,jsonb_build_object('evidence_basis',v_p.evidence_basis,'allocation_mode',v_p.allocation_mode));
  v_result:=jsonb_build_object('outcome','confirmed','proposal_id',v_p.id,'allocation_count',array_length(v_ids,1));
  RETURN public.collection_idempotency_finish(v_actor,'confirm_collection_match_v1',p_command_key,v_result);
END; $$;

CREATE OR REPLACE FUNCTION public.rebind_collection_superseded_evidence_v1(
  p_command_key text, p_allocation_id uuid, p_new_daily_line_id uuid, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_old public.collection_bank_line_allocations%ROWTYPE;
  v_old_line public.daily_statement_lines_canonical%ROWTYPE; v_new public.daily_statement_lines_canonical%ROWTYPE;
  v_old_account uuid; v_new_account uuid; v_existing numeric; v_new_id uuid; v_result jsonb; v_remittance_id uuid;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'CORRECT_EVIDENCE');
  IF p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'COLLECTION_REASON_REQUIRED'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'rebind_collection_superseded_evidence_v1',p_command_key,
    jsonb_build_object('allocation_id',p_allocation_id,'new_daily_line_id',p_new_daily_line_id,'reason',p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_old FROM public.collection_bank_line_allocations WHERE id=p_allocation_id FOR UPDATE;
  IF v_old.id IS NULL OR v_old.allocation_status='SUPERSEDED' THEN RAISE EXCEPTION 'COLLECTION_ACTIVE_ALLOCATION_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.daily_statement_lines_canonical WHERE id IN (v_old.daily_line_id,p_new_daily_line_id) ORDER BY id FOR UPDATE;
  SELECT l.* INTO v_old_line FROM public.daily_statement_lines_canonical l WHERE l.id=v_old.daily_line_id;
  SELECT u.account_registry_id INTO v_old_account FROM public.daily_statement_units_canonical u
   WHERE u.id=v_old_line.canonical_unit_id;
  SELECT l.* INTO v_new FROM public.daily_statement_lines_canonical l WHERE l.id=p_new_daily_line_id;
  SELECT u.account_registry_id INTO v_new_account FROM public.daily_statement_units_canonical u
   WHERE u.id=v_new.canonical_unit_id;
  IF v_old_line.is_active OR v_new.id IS NULL OR NOT v_new.is_active OR v_new.direction<>v_old_line.direction
     OR v_new.currency<>v_old_line.currency OR v_new_account<>v_old_account THEN
    RAISE EXCEPTION 'COLLECTION_REBIND_EVIDENCE_INCOMPATIBLE'; END IF;
  IF v_old.allocation_type='CREDIT_ALLOCATION' THEN
    SELECT coalesce(sum(credit_line_consumed_amount),0) INTO v_existing FROM public.collection_bank_line_allocations
     WHERE daily_line_id=v_new.id AND allocation_type='CREDIT_ALLOCATION' AND allocation_status IN ('CONFIRMED','EXCEPTION');
    IF v_existing+v_old.credit_line_consumed_amount>abs(v_new.signed_amount) THEN RAISE EXCEPTION 'COLLECTION_REBIND_OVERALLOCATES_LINE'; END IF;
  ELSE
    SELECT coalesce(sum(fee_line_consumed_amount),0) INTO v_existing FROM public.collection_bank_line_allocations
     WHERE daily_line_id=v_new.id AND allocation_type='FEE_EVIDENCE' AND allocation_status IN ('CONFIRMED','EXCEPTION');
    IF v_existing+v_old.fee_line_consumed_amount>abs(v_new.signed_amount) THEN RAISE EXCEPTION 'COLLECTION_REBIND_OVERALLOCATES_LINE'; END IF;
  END IF;
  UPDATE public.collection_bank_line_allocations SET allocation_status='SUPERSEDED' WHERE id=v_old.id;
  INSERT INTO public.collection_bank_line_allocations(created_by,proposal_id,allocation_type,remittance_item_id,daily_line_id,
    evidence_account_id,credit_line_consumed_amount,fee_line_consumed_amount,settled_gross_amount,observed_fee_amount,
    net_liquidity_amount,evidence_basis,allocation_mode,settlement_extent,allocation_status,supersedes_allocation_id)
  VALUES(v_actor,v_old.proposal_id,v_old.allocation_type,v_old.remittance_item_id,v_new.id,v_new_account,
    v_old.credit_line_consumed_amount,v_old.fee_line_consumed_amount,v_old.settled_gross_amount,v_old.observed_fee_amount,
    v_old.net_liquidity_amount,v_old.evidence_basis,v_old.allocation_mode,v_old.settlement_extent,'CONFIRMED',v_old.id)
  RETURNING id INTO v_new_id;
  IF v_old.remittance_item_id IS NOT NULL THEN
    PERFORM public.collection_recompute_item(v_old.remittance_item_id);
    SELECT remittance_id INTO v_remittance_id FROM public.collection_bank_remittance_items WHERE id=v_old.remittance_item_id;
    PERFORM public.collection_recompute_remittance(v_remittance_id);
  END IF;
  PERFORM public.collection_append_event(v_actor,'rebind_collection_superseded_evidence_v1','EVIDENCE_REBOUND',
    'BANK_LINE_ALLOCATION',v_new_id,v_old.proposal_id,p_reason,NULL,v_new.currency,
    jsonb_build_object('supersedes_allocation_id',v_old.id,'old_daily_line_id',v_old.daily_line_id,'new_daily_line_id',v_new.id));
  v_result:=jsonb_build_object('outcome','rebound','allocation_id',v_new_id,'supersedes_allocation_id',v_old.id);
  RETURN public.collection_idempotency_finish(v_actor,'rebind_collection_superseded_evidence_v1',p_command_key,v_result);
END; $$;

-- --------------------------------------------------------------------------
-- 5. Bounded correction, cancellation, duplicate decision and access grants
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.correct_collection_capture_v1(
  p_command_key text, p_subject_type text, p_subject_id uuid, p_patch jsonb, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_result jsonb; v_type text:=upper(p_subject_type);
  v_key text; v_receipt public.collection_receipts%ROWTYPE; v_rem public.collection_bank_remittances%ROWTYPE;
  v_item public.collection_bank_remittance_items%ROWTYPE; v_instrument public.collection_instruments%ROWTYPE;
  v_invoice_total numeric; v_settled numeric; v_new_instrument_id uuid; v_old_instrument_id uuid;
  v_before_hash text; v_after_hash text;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'CORRECT_CAPTURE');
  IF p_reason IS NULL OR btrim(p_reason)='' OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN
    RAISE EXCEPTION 'COLLECTION_CORRECTION_REASON_AND_PATCH_REQUIRED'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'correct_collection_capture_v1',p_command_key,
    jsonb_build_object('subject_type',v_type,'subject_id',p_subject_id,'patch',p_patch,'reason',p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF v_type='RECEIPT' THEN
    SELECT * INTO v_receipt FROM public.collection_receipts WHERE id=p_subject_id FOR UPDATE;
    IF v_receipt.id IS NULL THEN RAISE EXCEPTION 'COLLECTION_RECEIPT_NOT_FOUND'; END IF;
    PERFORM 1 FROM public.collection_bank_remittance_items WHERE receipt_id=p_subject_id ORDER BY id FOR UPDATE;
    PERFORM 1 FROM public.collection_invoice_allocations WHERE receipt_id=p_subject_id ORDER BY id FOR UPDATE;
    PERFORM 1 FROM public.collection_bank_line_allocations a JOIN public.collection_bank_remittance_items i ON i.id=a.remittance_item_id
      WHERE i.receipt_id=p_subject_id ORDER BY a.id FOR UPDATE OF a;
    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
      IF v_key NOT IN ('client_name','receipt_method','client_bank','expected_amount','currency','declared_credit_date','display_note') THEN
        RAISE EXCEPTION 'COLLECTION_CORRECTION_FIELD_NOT_ALLOWED:%',v_key; END IF;
      IF EXISTS(SELECT 1 FROM public.collection_bank_remittance_items WHERE receipt_id=p_subject_id AND status<>'DRAFT')
         AND v_key NOT IN ('declared_credit_date','display_note') THEN RAISE EXCEPTION 'COLLECTION_POST_DRAFT_CORRECTION_NOT_ALLOWED'; END IF;
    END LOOP;
    SELECT coalesce(sum(allocated_amount),0) INTO v_invoice_total FROM public.collection_invoice_allocations
      WHERE receipt_id=p_subject_id AND status='CONFIRMED';
    SELECT coalesce(sum(a.settled_gross_amount),0) INTO v_settled FROM public.collection_bank_line_allocations a
      JOIN public.collection_bank_remittance_items i ON i.id=a.remittance_item_id
      WHERE i.receipt_id=p_subject_id AND a.allocation_type='CREDIT_ALLOCATION' AND a.allocation_status IN ('CONFIRMED','EXCEPTION');
    IF p_patch ? 'expected_amount' AND (p_patch->>'expected_amount')::numeric<greatest(v_invoice_total,v_settled) THEN
      RAISE EXCEPTION 'COLLECTION_CORRECTION_BELOW_ALLOCATED_AMOUNT'; END IF;
    v_before_hash:=public.collection_payload_hash(to_jsonb(v_receipt)-'client_name'-'client_bank'-'display_note');
    UPDATE public.collection_receipts SET
      client_name=CASE WHEN p_patch?'client_name' THEN btrim(p_patch->>'client_name') ELSE client_name END,
      receipt_method=CASE WHEN p_patch?'receipt_method' THEN upper(p_patch->>'receipt_method') ELSE receipt_method END,
      client_bank=CASE WHEN p_patch?'client_bank' THEN nullif(btrim(p_patch->>'client_bank'),'') ELSE client_bank END,
      expected_amount=CASE WHEN p_patch?'expected_amount' THEN (p_patch->>'expected_amount')::numeric ELSE expected_amount END,
      currency=CASE WHEN p_patch?'currency' THEN upper(p_patch->>'currency') ELSE currency END,
      declared_credit_date=CASE WHEN p_patch?'declared_credit_date' THEN nullif(p_patch->>'declared_credit_date','')::date ELSE declared_credit_date END,
      display_note=CASE WHEN p_patch?'display_note' THEN nullif(btrim(p_patch->>'display_note'),'') ELSE display_note END,
      duplicate_review_status=CASE WHEN p_patch ?| ARRAY['client_name','receipt_method','client_bank','expected_amount','currency'] THEN 'OPEN' ELSE duplicate_review_status END,
      duplicate_basis=CASE WHEN p_patch ?| ARRAY['client_name','receipt_method','client_bank','expected_amount','currency'] THEN 'CORRECTION_REVIEW_REQUIRED' ELSE duplicate_basis END,
      updated_at=now() WHERE id=p_subject_id RETURNING * INTO v_receipt;
    v_after_hash:=public.collection_payload_hash(to_jsonb(v_receipt)-'client_name'-'client_bank'-'display_note');

  ELSIF v_type='REMITTANCE' THEN
    SELECT * INTO v_rem FROM public.collection_bank_remittances WHERE id=p_subject_id FOR UPDATE;
    IF v_rem.id IS NULL OR v_rem.status<>'DRAFT' THEN RAISE EXCEPTION 'COLLECTION_REMITTANCE_NOT_DRAFT'; END IF;
    PERFORM 1 FROM public.collection_bank_remittance_items WHERE remittance_id=p_subject_id ORDER BY id FOR UPDATE;
    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
      IF v_key NOT IN ('deposit_account_id','deposit_currency','declared_total_amount','deposit_date','slip_reference',
                       'source_document_ref','document_metadata','capture_control_status') THEN
        RAISE EXCEPTION 'COLLECTION_CORRECTION_FIELD_NOT_ALLOWED:%',v_key; END IF;
    END LOOP;
    IF p_patch?'declared_total_amount' AND (p_patch->>'declared_total_amount')::numeric<
      (SELECT coalesce(sum(item_amount),0) FROM public.collection_bank_remittance_items WHERE remittance_id=p_subject_id) THEN
      RAISE EXCEPTION 'COLLECTION_REMITTANCE_TOTAL_BELOW_ITEMS'; END IF;
    IF p_patch?'deposit_account_id' AND NOT EXISTS(SELECT 1 FROM public.daily_statement_account_registry a
      WHERE a.id=(p_patch->>'deposit_account_id')::uuid AND a.status='active'
        AND a.currency=upper(coalesce(p_patch->>'deposit_currency',v_rem.deposit_currency))) THEN
      RAISE EXCEPTION 'COLLECTION_ACTIVE_DEPOSIT_ACCOUNT_REQUIRED'; END IF;
    v_before_hash:=public.collection_payload_hash(to_jsonb(v_rem)-'source_document_ref'-'document_metadata'-'slip_reference');
    UPDATE public.collection_bank_remittances SET
      deposit_account_id=CASE WHEN p_patch?'deposit_account_id' THEN (p_patch->>'deposit_account_id')::uuid ELSE deposit_account_id END,
      deposit_currency=CASE WHEN p_patch?'deposit_currency' THEN upper(p_patch->>'deposit_currency') ELSE deposit_currency END,
      declared_total_amount=CASE WHEN p_patch?'declared_total_amount' THEN (p_patch->>'declared_total_amount')::numeric ELSE declared_total_amount END,
      deposit_date=CASE WHEN p_patch?'deposit_date' THEN (p_patch->>'deposit_date')::date ELSE deposit_date END,
      slip_reference=CASE WHEN p_patch?'slip_reference' THEN nullif(btrim(p_patch->>'slip_reference'),'') ELSE slip_reference END,
      source_document_ref=CASE WHEN p_patch?'source_document_ref' THEN nullif(btrim(p_patch->>'source_document_ref'),'') ELSE source_document_ref END,
      document_metadata=CASE WHEN p_patch?'document_metadata' THEN p_patch->'document_metadata' ELSE document_metadata END,
      capture_control_status=CASE WHEN p_patch?'capture_control_status' THEN upper(p_patch->>'capture_control_status') ELSE capture_control_status END,
      updated_at=now() WHERE id=p_subject_id RETURNING * INTO v_rem;
    IF EXISTS(SELECT 1 FROM public.collection_bank_remittance_items i JOIN public.collection_receipts r ON r.id=i.receipt_id
      WHERE i.remittance_id=p_subject_id AND (i.currency<>v_rem.deposit_currency OR r.currency<>v_rem.deposit_currency)) THEN
      RAISE EXCEPTION 'COLLECTION_CORRECTION_CURRENCY_MISMATCH'; END IF;
    v_after_hash:=public.collection_payload_hash(to_jsonb(v_rem)-'source_document_ref'-'document_metadata'-'slip_reference');

  ELSIF v_type='REMITTANCE_ITEM' THEN
    SELECT * INTO v_item FROM public.collection_bank_remittance_items WHERE id=p_subject_id FOR UPDATE;
    IF v_item.id IS NULL OR v_item.status<>'DRAFT' THEN RAISE EXCEPTION 'COLLECTION_ITEM_NOT_DRAFT'; END IF;
    v_old_instrument_id:=v_item.instrument_id;
    SELECT * INTO v_rem FROM public.collection_bank_remittances WHERE id=v_item.remittance_id FOR UPDATE;
    SELECT * INTO v_receipt FROM public.collection_receipts WHERE id=v_item.receipt_id FOR UPDATE;
    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
      IF v_key NOT IN ('item_amount','instrument_id') THEN RAISE EXCEPTION 'COLLECTION_CORRECTION_FIELD_NOT_ALLOWED:%',v_key; END IF;
    END LOOP;
    IF p_patch?'item_amount' AND (p_patch->>'item_amount')::numeric<>v_receipt.expected_amount THEN
      RAISE EXCEPTION 'COLLECTION_ITEM_AMOUNT_OR_CURRENCY_MISMATCH'; END IF;
    IF p_patch?'instrument_id' THEN
      v_new_instrument_id:=nullif(p_patch->>'instrument_id','')::uuid;
      IF v_receipt.receipt_method IN ('CHECK','EFFECT') AND v_new_instrument_id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_INSTRUMENT_REQUIRED';
      ELSIF v_receipt.receipt_method IN ('TRANSFER','CASH') AND v_new_instrument_id IS NOT NULL THEN
        RAISE EXCEPTION 'COLLECTION_INSTRUMENT_NOT_ALLOWED';
      END IF;
      IF v_new_instrument_id IS NOT NULL THEN
        SELECT * INTO v_instrument FROM public.collection_instruments WHERE id=v_new_instrument_id FOR SHARE;
        IF v_instrument.id IS NULL THEN RAISE EXCEPTION 'COLLECTION_INSTRUMENT_NOT_FOUND'; END IF;
        IF v_instrument.instrument_type<>v_receipt.receipt_method THEN
          RAISE EXCEPTION 'COLLECTION_INSTRUMENT_TYPE_MISMATCH'; END IF;
        IF (v_instrument.currency IS NOT NULL AND v_instrument.currency<>v_receipt.currency)
           OR (v_instrument.nominal_amount IS NOT NULL AND v_instrument.nominal_amount<>v_receipt.expected_amount) THEN
          RAISE EXCEPTION 'COLLECTION_INSTRUMENT_AMOUNT_OR_CURRENCY_MISMATCH'; END IF;
      END IF;
    END IF;
    v_before_hash:=public.collection_payload_hash(to_jsonb(v_item));
    UPDATE public.collection_bank_remittance_items SET
      item_amount=CASE WHEN p_patch?'item_amount' THEN (p_patch->>'item_amount')::numeric ELSE item_amount END,
      instrument_id=CASE WHEN p_patch?'instrument_id' THEN v_new_instrument_id ELSE instrument_id END
      WHERE id=p_subject_id RETURNING * INTO v_item;
    IF p_patch?'instrument_id' AND v_item.instrument_id IS DISTINCT FROM v_old_instrument_id THEN
      UPDATE public.collection_receipts
      SET duplicate_review_status='OPEN',
          duplicate_basis='CORRECTION_INSTRUMENT_REVIEW_REQUIRED',
          updated_at=now()
      WHERE id=v_item.receipt_id;
    END IF;
    IF (SELECT coalesce(sum(item_amount),0) FROM public.collection_bank_remittance_items WHERE remittance_id=v_item.remittance_id)>v_rem.declared_total_amount THEN
      RAISE EXCEPTION 'COLLECTION_REMITTANCE_TOTAL_BELOW_ITEMS'; END IF;
    v_after_hash:=public.collection_payload_hash(to_jsonb(v_item));
  ELSE RAISE EXCEPTION 'COLLECTION_CORRECTION_SUBJECT_INVALID'; END IF;

  PERFORM public.collection_append_event(v_actor,'correct_collection_capture_v1','CAPTURE_CORRECTED',v_type,p_subject_id,
    p_subject_id,p_reason,NULL,NULL,jsonb_build_object('changed_fields',(SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_patch) k),
      'before_safe_hash',v_before_hash,'after_safe_hash',v_after_hash));
  v_result:=jsonb_build_object('outcome','corrected','subject_type',v_type,'subject_id',p_subject_id);
  RETURN public.collection_idempotency_finish(v_actor,'correct_collection_capture_v1',p_command_key,v_result);
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_collection_remittance_v1(
  p_command_key text, p_remittance_id uuid, p_mode text, p_document_reference text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_rem public.collection_bank_remittances%ROWTYPE;
  v_result jsonb; v_mode text:=upper(p_mode);
BEGIN
  PERFORM public.collection_require_capability(v_actor,'CANCEL_REMITTANCE');
  IF p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'COLLECTION_REASON_REQUIRED'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'cancel_collection_remittance_v1',p_command_key,
    jsonb_build_object('remittance_id',p_remittance_id,'mode',v_mode,'document_reference',p_document_reference,'reason',p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_rem FROM public.collection_bank_remittances WHERE id=p_remittance_id FOR UPDATE;
  PERFORM 1 FROM public.collection_bank_remittance_items WHERE remittance_id=p_remittance_id ORDER BY id FOR UPDATE;
  IF v_rem.id IS NULL OR v_mode NOT IN ('DRAFT_CANCEL','VALIDATED_NOT_DEPOSITED') THEN RAISE EXCEPTION 'COLLECTION_CANCEL_MODE_INVALID'; END IF;
  IF v_mode='DRAFT_CANCEL' AND v_rem.status<>'DRAFT' THEN RAISE EXCEPTION 'COLLECTION_REMITTANCE_NOT_DRAFT'; END IF;
  IF v_mode='VALIDATED_NOT_DEPOSITED' THEN
    IF v_rem.status<>'SUBMITTED' OR v_rem.validated_by=v_actor OR p_document_reference IS NULL OR btrim(p_document_reference)='' THEN
      RAISE EXCEPTION 'COLLECTION_VALIDATED_CANCEL_REQUIREMENTS_FAILED'; END IF;
    IF EXISTS(SELECT 1 FROM public.collection_bank_remittance_items i WHERE i.remittance_id=p_remittance_id AND
      (i.status<>'SUBMITTED' OR EXISTS(SELECT 1 FROM public.collection_bank_line_allocations a WHERE a.remittance_item_id=i.id)
       OR EXISTS(SELECT 1 FROM public.collection_match_proposals p,LATERAL jsonb_array_elements(p.allocation_plan)e
         WHERE p.status='PENDING' AND (e->>'remittance_item_id')::uuid=i.id))) THEN
      RAISE EXCEPTION 'COLLECTION_VALIDATED_CANCEL_BLOCKED'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.collection_bank_remittance_items i JOIN public.collection_receipts r ON r.id=i.receipt_id
    WHERE i.remittance_id=p_remittance_id AND r.duplicate_review_status='OPEN') THEN RAISE EXCEPTION 'COLLECTION_DUPLICATE_REVIEW_BLOCKS_CANCEL'; END IF;
  UPDATE public.collection_bank_remittance_items SET status='CANCELLED' WHERE remittance_id=p_remittance_id AND status IN ('DRAFT','SUBMITTED');
  PERFORM public.collection_recompute_remittance(p_remittance_id);
  PERFORM public.collection_append_event(v_actor,'cancel_collection_remittance_v1','REMITTANCE_CANCELLED','REMITTANCE',p_remittance_id,
    p_remittance_id,p_reason,v_rem.declared_total_amount,v_rem.deposit_currency,
    jsonb_build_object('mode',v_mode,'document_reference',p_document_reference));
  v_result:=jsonb_build_object('outcome','cancelled','remittance_id',p_remittance_id,'mode',v_mode);
  RETURN public.collection_idempotency_finish(v_actor,'cancel_collection_remittance_v1',p_command_key,v_result);
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_collection_duplicate_v1(
  p_command_key text, p_receipt_id uuid, p_decision text, p_existing_instrument_id uuid, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_receipt public.collection_receipts%ROWTYPE;
  v_decision text:=upper(p_decision); v_result jsonb;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'RESOLVE_DUPLICATE');
  IF v_decision NOT IN ('SAME_INSTRUMENT_LINK','DISTINCT_KEEP','REJECT_CAPTURE') OR p_reason IS NULL OR btrim(p_reason)='' THEN
    RAISE EXCEPTION 'COLLECTION_DUPLICATE_DECISION_INVALID'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'resolve_collection_duplicate_v1',p_command_key,
    jsonb_build_object('receipt_id',p_receipt_id,'decision',v_decision,'existing_instrument_id',p_existing_instrument_id,'reason',p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_receipt FROM public.collection_receipts WHERE id=p_receipt_id FOR UPDATE;
  PERFORM 1 FROM public.collection_bank_remittance_items WHERE receipt_id=p_receipt_id ORDER BY id FOR UPDATE;
  IF v_receipt.id IS NULL OR v_receipt.duplicate_review_status<>'OPEN' THEN RAISE EXCEPTION 'COLLECTION_DUPLICATE_REVIEW_NOT_OPEN'; END IF;
  IF v_decision='SAME_INSTRUMENT_LINK' THEN
    IF p_existing_instrument_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.collection_instruments WHERE id=p_existing_instrument_id) THEN
      RAISE EXCEPTION 'COLLECTION_EXISTING_INSTRUMENT_REQUIRED'; END IF;
    UPDATE public.collection_bank_remittance_items SET instrument_id=p_existing_instrument_id
      WHERE receipt_id=p_receipt_id AND status='DRAFT';
  ELSIF v_decision='DISTINCT_KEEP' THEN
    IF EXISTS(SELECT 1 FROM public.collection_bank_remittance_items i JOIN public.collection_instruments x ON x.id=i.instrument_id
      WHERE i.receipt_id=p_receipt_id AND x.identity_strength='STRONG_VERIFIED') THEN
      RAISE EXCEPTION 'COLLECTION_STRONG_IDENTITY_CANNOT_BE_DISTINCT'; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM public.collection_bank_remittance_items WHERE receipt_id=p_receipt_id AND status<>'DRAFT')
       OR EXISTS(SELECT 1 FROM public.collection_bank_line_allocations a JOIN public.collection_bank_remittance_items i ON i.id=a.remittance_item_id
         WHERE i.receipt_id=p_receipt_id) THEN RAISE EXCEPTION 'COLLECTION_REJECT_CAPTURE_TOO_LATE'; END IF;
    UPDATE public.collection_bank_remittance_items SET status='CANCELLED' WHERE receipt_id=p_receipt_id AND status='DRAFT';
    UPDATE public.collection_receipts SET status='REJECTED' WHERE id=p_receipt_id;
  END IF;
  UPDATE public.collection_receipts SET duplicate_review_status='RESOLVED',updated_at=now() WHERE id=p_receipt_id;
  PERFORM public.collection_append_event(v_actor,'resolve_collection_duplicate_v1','DUPLICATE_RESOLVED','RECEIPT',p_receipt_id,
    p_receipt_id,p_reason,NULL,v_receipt.currency,jsonb_build_object('decision',v_decision,'existing_instrument_id',p_existing_instrument_id));
  v_result:=jsonb_build_object('outcome','resolved','receipt_id',p_receipt_id,'decision',v_decision);
  RETURN public.collection_idempotency_finish(v_actor,'resolve_collection_duplicate_v1',p_command_key,v_result);
END; $$;

CREATE OR REPLACE FUNCTION public.grant_collection_capability_v1(
  p_command_key text, p_user_id uuid, p_capability text, p_active boolean, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_actor uuid:=public.collection_require_actor(); v_cached jsonb; v_result jsonb; v_id uuid; v_cap text:=upper(p_capability);
BEGIN
  IF NOT public.has_role(v_actor,'admin'::public.app_role)
     AND NOT EXISTS(SELECT 1 FROM public.collection_domain_assignments WHERE user_id=v_actor AND capability='MANAGE_ACCESS' AND is_active) THEN
    RAISE EXCEPTION 'COLLECTION_MANAGE_ACCESS_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR btrim(p_reason)='' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION 'COLLECTION_ACCESS_ASSIGNMENT_INVALID'; END IF;
  IF v_cap NOT IN ('ENTRY','IMPORT_COLLECTIONS','VALIDATE_REMITTANCE','WITHDRAW_REMITTANCE','PROPOSE_MATCH',
    'CONFIRM_MATCH','CORRECT_CAPTURE','CANCEL_REMITTANCE','RESOLVE_DUPLICATE','CORRECT_EVIDENCE',
    'ACTIVATE_CUTOVER','AUDIT','MANAGE_ACCESS') THEN RAISE EXCEPTION 'COLLECTION_CAPABILITY_INVALID'; END IF;
  v_cached:=public.collection_idempotency_begin(v_actor,'grant_collection_capability_v1',p_command_key,
    jsonb_build_object('user_id',p_user_id,'capability',v_cap,'active',p_active,'reason',p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_active THEN
    IF EXISTS(SELECT 1 FROM public.collection_domain_assignments WHERE user_id=p_user_id AND capability=v_cap AND is_active) THEN
      RAISE EXCEPTION 'COLLECTION_CAPABILITY_ALREADY_ACTIVE'; END IF;
    INSERT INTO public.collection_domain_assignments(user_id,capability,granted_by,reason)
    VALUES(p_user_id,v_cap,v_actor,btrim(p_reason)) RETURNING id INTO v_id;
  ELSE
    UPDATE public.collection_domain_assignments SET is_active=false,revoked_at=now(),revoked_by=v_actor
     WHERE user_id=p_user_id AND capability=v_cap AND is_active RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'COLLECTION_ACTIVE_CAPABILITY_NOT_FOUND'; END IF;
  END IF;
  PERFORM public.collection_append_event(v_actor,'grant_collection_capability_v1',
    CASE WHEN p_active THEN 'CAPABILITY_GRANTED' ELSE 'CAPABILITY_REVOKED' END,'DOMAIN_ASSIGNMENT',v_id,v_id,p_reason,NULL,NULL,
    jsonb_build_object('user_id',p_user_id,'capability',v_cap));
  v_result:=jsonb_build_object('outcome',CASE WHEN p_active THEN 'granted' ELSE 'revoked' END,'assignment_id',v_id,
    'user_id',p_user_id,'capability',v_cap);
  RETURN public.collection_idempotency_finish(v_actor,'grant_collection_capability_v1',p_command_key,v_result);
END; $$;

-- --------------------------------------------------------------------------
-- 6. Single exception projection and versioned read-only register export
-- --------------------------------------------------------------------------

CREATE VIEW public.collection_exception_status_v
WITH (security_invoker=true)
AS
WITH exception_rows AS (
SELECT 'RECEIPT'::text subject_type,r.id subject_id,'UNMATCHED'::text exception_code,
       'WARNING'::text severity,false blocking,NULL::uuid daily_line_id,
       'receipt_status'::text detection_basis
FROM public.collection_receipts r
WHERE r.status='UNMATCHED' AND coalesce(r.legacy_classification,'')<>'LEGACY_PENDING_0Z1C'
UNION ALL
SELECT 'RECEIPT',r.id,'PARTIALLY_MATCHED','WARNING',false,NULL,'receipt_status'
FROM public.collection_receipts r WHERE r.status='PARTIALLY_MATCHED'
UNION ALL
SELECT 'RECEIPT',r.id,'DECLARED_CREDIT_WITHOUT_EVIDENCE','WARNING',false,NULL,'declared_credit_date'
FROM public.collection_receipts r
WHERE r.declared_credit_date IS NOT NULL AND r.status IN ('UNMATCHED','PARTIALLY_MATCHED')
  AND coalesce(r.legacy_classification,'')<>'LEGACY_PENDING_0Z1C'
UNION ALL
SELECT 'RECEIPT',r.id,'DUPLICATE_REVIEW_OPEN','ERROR',true,NULL,'duplicate_review_status'
FROM public.collection_receipts r WHERE r.duplicate_review_status='OPEN'
UNION ALL
SELECT 'MATCH_PROPOSAL',p.id,'PROPOSAL_EVIDENCE_INACTIVE','ERROR',true,p.credit_daily_line_id,'daily_v2_is_active'
FROM public.collection_match_proposals p
WHERE p.status='PENDING' AND (
  NOT EXISTS(SELECT 1 FROM public.daily_statement_lines_canonical l WHERE l.id=p.credit_daily_line_id AND l.is_active)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.fee_evidence_plan) f
    LEFT JOIN public.daily_statement_lines_canonical l ON l.id=(f->>'daily_line_id')::uuid
    WHERE l.id IS NULL OR NOT l.is_active))
UNION ALL
SELECT 'BANK_LINE_ALLOCATION',a.id,'CONFIRMED_EVIDENCE_INACTIVE','ERROR',true,a.daily_line_id,'daily_v2_is_active'
FROM public.collection_bank_line_allocations a
JOIN public.daily_statement_lines_canonical l ON l.id=a.daily_line_id
WHERE a.allocation_status IN ('CONFIRMED','EXCEPTION') AND NOT l.is_active
UNION ALL
SELECT 'DAILY_LINE',l.id,'BANK_CREDIT_WITHOUT_RECEIPT','INFO',false,l.id,'unallocated_active_credit'
FROM public.daily_statement_lines_canonical l
WHERE l.is_active AND l.direction='credit'
  AND NOT EXISTS(SELECT 1 FROM public.collection_bank_line_allocations a
    WHERE a.daily_line_id=l.id AND a.allocation_type='CREDIT_ALLOCATION' AND a.allocation_status IN ('CONFIRMED','EXCEPTION'))
  AND NOT EXISTS(SELECT 1 FROM public.collection_match_proposals p WHERE p.credit_daily_line_id=l.id AND p.status='PENDING')
UNION ALL
SELECT 'REMITTANCE_ITEM',i.id,'UNEXPECTED_CREDIT_AFTER_WITHDRAWAL','ERROR',true,l.id,'withdrawn_item_reference_on_old_account'
FROM public.collection_bank_remittance_items i
JOIN public.collection_bank_remittances b ON b.id=i.remittance_id
JOIN public.collection_instruments x ON x.id=i.instrument_id AND nullif(btrim(x.instrument_reference),'') IS NOT NULL
JOIN public.daily_statement_units_canonical u ON u.account_registry_id=b.deposit_account_id
JOIN public.daily_statement_lines_canonical l ON l.canonical_unit_id=u.id AND l.is_active AND l.direction='credit'
  AND position(lower(x.instrument_reference) in lower(l.description_sanitized))>0
JOIN LATERAL (
  SELECT e.effective_at
  FROM public.collection_events e
  WHERE e.aggregate_id=i.id AND e.event_type='WITHDRAWAL_CONFIRMED'
  ORDER BY e.effective_at DESC,e.id DESC
  LIMIT 1
) withdrawal ON true
WHERE i.status='WITHDRAWN'
  AND l.accounting_date>=withdrawal.effective_at::date
  AND NOT EXISTS (
    SELECT 1 FROM public.collection_bank_line_allocations a
    WHERE a.remittance_item_id=i.id AND a.daily_line_id=l.id
      AND a.allocation_type='CREDIT_ALLOCATION'
      AND a.allocation_status IN ('CONFIRMED','EXCEPTION','SUPERSEDED'))
UNION ALL
SELECT 'MATCH_PROPOSAL',p.id,'UNEXPLAINED_FEES','ERROR',true,
       CASE WHEN jsonb_array_length(p.fee_evidence_plan)>0 THEN (p.fee_evidence_plan->0->>'daily_line_id')::uuid ELSE NULL END,
       'fee_evidence_plan'
FROM public.collection_match_proposals p
WHERE p.evidence_basis='FEES_SEPARATE' AND p.status='PENDING'
  AND (p.proposed_fee_consumed_amount<=0 OR jsonb_array_length(p.fee_evidence_plan)=0)
UNION ALL
SELECT 'REMITTANCE',b.id,'CAPTURE_INCONSISTENCY','ERROR',true,NULL,'header_item_total_or_currency'
FROM public.collection_bank_remittances b
WHERE EXISTS(SELECT 1 FROM public.collection_bank_remittance_items i
  JOIN public.collection_receipts r ON r.id=i.receipt_id
  WHERE i.remittance_id=b.id AND (i.currency<>b.deposit_currency OR r.currency<>b.deposit_currency OR r.expected_amount<>i.item_amount))
   OR b.declared_total_amount<>(SELECT coalesce(sum(i.item_amount),0) FROM public.collection_bank_remittance_items i
      WHERE i.remittance_id=b.id AND i.status<>'CANCELLED')
)
SELECT * FROM exception_rows
WHERE public.collection_current_actor_has_capability('AUDIT');

CREATE OR REPLACE FUNCTION public.export_collection_register_v1()
RETURNS TABLE(
  export_contract_version text,
  remittance_item_id uuid,
  receipt_id uuid,
  excel_filename text,
  excel_source_row integer,
  deposit_date date,
  client_name text,
  receipt_method text,
  instrument_reference text,
  expected_amount numeric,
  settled_gross_amount numeric,
  credit_consumed_amount numeric,
  observed_fee_amount numeric,
  net_liquidity_amount numeric,
  currency text,
  deposit_account_id uuid,
  item_status text,
  receipt_status text,
  proof_class text,
  declared_credit_date date,
  proven_credit_date date,
  remaining_amount numeric,
  current_exception_code text,
  exception_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_actor uuid:=public.collection_require_actor();
BEGIN
  PERFORM public.collection_require_capability(v_actor,'AUDIT');
  RETURN QUERY
  SELECT 'COLLECTION_REGISTER_V1'::text,i.id,r.id,o.excel_filename,o.excel_source_row,b.deposit_date,
    r.client_name,r.receipt_method,x.instrument_reference,r.expected_amount,
    coalesce(a.settled,0),coalesce(a.credit,0),coalesce(a.fee,0),coalesce(a.net,0),r.currency,b.deposit_account_id,
    i.status,r.status,coalesce(a.proof_class,'UNPROVEN'),r.declared_credit_date,a.proven_date,
    r.expected_amount-coalesce(a.settled,0),ex.exception_code,coalesce(ex.exception_count,0)
  FROM public.collection_bank_remittance_items i
  JOIN public.collection_receipts r ON r.id=i.receipt_id
  JOIN public.collection_bank_remittances b ON b.id=i.remittance_id
  LEFT JOIN public.collection_instruments x ON x.id=i.instrument_id
  LEFT JOIN LATERAL (SELECT io.excel_filename,io.excel_source_row FROM public.collection_import_origins io
    WHERE io.receipt_id=r.id AND io.is_active ORDER BY io.created_at DESC LIMIT 1) o ON true
  LEFT JOIN LATERAL (
    SELECT sum(al.settled_gross_amount) settled,sum(al.credit_line_consumed_amount) credit,
      sum(al.observed_fee_amount) fee,sum(al.net_liquidity_amount) net,
      CASE WHEN bool_or(al.evidence_basis='NET_OF_DISCOUNT') THEN 'DISCOUNT_CREDITED'
           ELSE max(al.evidence_basis) END proof_class,max(dl.accounting_date) proven_date
    FROM public.collection_bank_line_allocations al
    JOIN public.daily_statement_lines_canonical dl ON dl.id=al.daily_line_id
    WHERE al.remittance_item_id=i.id AND al.allocation_type='CREDIT_ALLOCATION'
      AND al.allocation_status IN ('CONFIRMED','EXCEPTION')) a ON true
  LEFT JOIN LATERAL (
    SELECT (array_agg(e.exception_code ORDER BY CASE e.severity WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,e.exception_code))[1] exception_code,
      count(*) exception_count FROM public.collection_exception_status_v e
    WHERE (e.subject_type='REMITTANCE_ITEM' AND e.subject_id=i.id)
       OR (e.subject_type='RECEIPT' AND e.subject_id=r.id)
       OR (e.subject_type='REMITTANCE' AND e.subject_id=b.id)) ex ON true
  ORDER BY b.deposit_date,i.id;
END; $$;

-- --------------------------------------------------------------------------
-- 7. RLS, grants and API surface
-- --------------------------------------------------------------------------

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'collection_bank_remittances','collection_bank_remittance_items','collection_receipts',
    'collection_import_origins','collection_instruments','collection_invoice_allocations',
    'collection_match_proposals','collection_bank_line_allocations','collection_command_idempotency'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated, service_role',v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ('||
      'public.has_role(auth.uid(),''admin''::public.app_role) OR '||
      'public.has_role(auth.uid(),''manager''::public.app_role) OR '||
      'public.has_role(auth.uid(),''auditor''::public.app_role) OR '||
      'public.has_role(auth.uid(),''user''::public.app_role))',
      v_table||'_select',v_table);
  END LOOP;
END $$;

ALTER TABLE public.collection_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.collection_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.collection_events TO authenticated,service_role;
CREATE POLICY collection_events_audit_select ON public.collection_events
  FOR SELECT TO authenticated
  USING (public.collection_current_actor_has_capability('AUDIT'));

ALTER TABLE public.collection_domain_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.collection_domain_assignments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.collection_domain_assignments TO authenticated,service_role;
CREATE POLICY collection_domain_assignments_bounded_select ON public.collection_domain_assignments
  FOR SELECT TO authenticated
  USING (
    user_id=auth.uid()
    OR public.collection_current_actor_has_capability('AUDIT')
    OR public.collection_current_actor_has_capability('MANAGE_ACCESS')
  );

REVOKE ALL ON TABLE public.collection_exception_status_v FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.collection_exception_status_v TO authenticated,service_role;

DO $$
DECLARE v_proc record;
BEGIN
  FOR v_proc IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (p.proname LIKE 'collection\_%' ESCAPE '\' OR p.proname='export_collection_register_v1')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',v_proc.signature);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.create_collection_remittance_v1(text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_collection_remittance_item_v1(text,uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_collection_remittance_v1(text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_collection_remittance_withdrawal_v1(text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_collection_remittance_withdrawal_v1(text,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_collection_remittance_item_v1(text,uuid,uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_collection_receipts_v1(text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_collection_invoice_v1(text,uuid,text,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_collection_match_v1(text,text,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_collection_match_v1(text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rebind_collection_superseded_evidence_v1(text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_collection_capture_v1(text,text,uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_collection_remittance_v1(text,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_collection_duplicate_v1(text,uuid,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_collection_capability_v1(text,uuid,text,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_collection_register_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.collection_current_actor_has_capability(text) TO authenticated,service_role;

COMMENT ON VIEW public.collection_exception_status_v IS
  'Unique read-only Core exception projection. No second review table or view.';
COMMENT ON FUNCTION public.export_collection_register_v1() IS
  'Read-only COLLECTION_REGISTER_V1 export; prepares evidence and never posts accounting entries.';

COMMIT;
