-- ============================================================================
-- 0Z1B CORE PHASE B — BOUNDED DAILY V2 READS AND SCOPED MATCHING
-- ============================================================================
-- Additive migration. Collections never mutates Daily v2. Candidate discovery
-- is exposed only through scoped SECURITY DEFINER read functions.
-- ============================================================================

BEGIN;

ALTER TABLE public.collection_domain_assignments
  ADD COLUMN capability_scope jsonb;

ALTER TABLE public.collection_domain_assignments
  ADD CONSTRAINT collection_assignment_scope_object
  CHECK (capability_scope IS NULL OR jsonb_typeof(capability_scope) = 'object');

ALTER TABLE public.collection_match_proposals
  ADD COLUMN expected_canonical_unit_id uuid,
  ADD COLUMN expected_daily_line_hash text,
  ADD COLUMN expected_account_registry_id uuid,
  ADD COLUMN expected_accounting_date date,
  ADD COLUMN expected_credit_amount numeric(18,2),
  ADD COLUMN expected_currency text,
  ADD COLUMN expected_source_attempt_id uuid,
  ADD COLUMN expected_source_raw_text_hash text,
  ADD COLUMN reference_signal text,
  ADD COLUMN candidate_reason_codes text[];

ALTER TABLE public.collection_match_proposals
  ADD CONSTRAINT collection_proposal_phase_b_snapshot_shape CHECK (
    (expected_canonical_unit_id IS NULL
      AND expected_daily_line_hash IS NULL
      AND expected_account_registry_id IS NULL
      AND expected_accounting_date IS NULL
      AND expected_credit_amount IS NULL
      AND expected_currency IS NULL
      AND expected_source_attempt_id IS NULL
      AND expected_source_raw_text_hash IS NULL
      AND reference_signal IS NULL
      AND candidate_reason_codes IS NULL)
    OR
    (expected_canonical_unit_id IS NOT NULL
      AND expected_daily_line_hash ~ '^[0-9a-f]{64}$'
      AND expected_account_registry_id IS NOT NULL
      AND expected_accounting_date IS NOT NULL
      AND expected_credit_amount > 0
      AND expected_currency ~ '^[A-Z]{3}$'
      AND expected_source_attempt_id IS NOT NULL
      AND expected_source_raw_text_hash ~ '^[0-9a-f]{64}$'
      AND reference_signal IN (
        'REFERENCE_TOKEN_EXACT','REFERENCE_NOT_AVAILABLE',
        'REFERENCE_TOO_SHORT','REFERENCE_NOT_FOUND'
      )
      AND candidate_reason_codes IS NOT NULL)
  );

-- --------------------------------------------------------------------------
-- Strict, versioned capability scope
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.collection_phase_b_scope_is_valid(p_scope jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_expires_at timestamptz;
  v_item_count integer;
  v_line_count integer;
  v_hash_count integer;
BEGIN
  IF p_scope IS NULL OR jsonb_typeof(p_scope) <> 'object' THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_scope) AS k(key)
    WHERE k.key NOT IN (
      'version','mode','campaign_id','remittance_item_ids',
      'daily_line_ids','daily_line_hashes','expires_at'
    )
  ) THEN RETURN false; END IF;
  IF jsonb_typeof(p_scope->'version') <> 'number' OR p_scope->>'version' <> '1'
     OR jsonb_typeof(p_scope->'mode') <> 'string'
     OR p_scope->>'mode' <> 'PILOT_ALLOWLIST_V1'
     OR jsonb_typeof(p_scope->'campaign_id') <> 'string'
     OR char_length(p_scope->>'campaign_id') NOT BETWEEN 1 AND 200
     OR p_scope->>'campaign_id' !~ '^PILOT-0Z1B-[A-Za-z0-9:_-]+$'
     OR jsonb_typeof(p_scope->'remittance_item_ids') <> 'array'
     OR jsonb_typeof(p_scope->'daily_line_ids') <> 'array'
     OR jsonb_typeof(p_scope->'daily_line_hashes') <> 'array'
     OR jsonb_typeof(p_scope->'expires_at') <> 'string' THEN RETURN false; END IF;

  BEGIN
    v_expires_at := (p_scope->>'expires_at')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF v_expires_at <= statement_timestamp() THEN RETURN false; END IF;

  v_item_count := jsonb_array_length(p_scope->'remittance_item_ids');
  v_line_count := jsonb_array_length(p_scope->'daily_line_ids');
  v_hash_count := jsonb_array_length(p_scope->'daily_line_hashes');
  IF v_item_count < 1 OR v_line_count < 1 OR v_line_count <> v_hash_count THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_scope->'remittance_item_ids') e(value)
    WHERE jsonb_typeof(e.value) <> 'string'
       OR trim(both '"' from e.value::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_scope->'daily_line_ids') e(value)
    WHERE jsonb_typeof(e.value) <> 'string'
       OR trim(both '"' from e.value::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_scope->'daily_line_hashes') e(value)
    WHERE jsonb_typeof(e.value) <> 'string'
       OR trim(both '"' from e.value::text) !~ '^[0-9a-f]{64}$'
  ) THEN RETURN false; END IF;

  IF (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements_text(p_scope->'remittance_item_ids'))
     OR (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements_text(p_scope->'daily_line_ids'))
     OR (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements_text(p_scope->'daily_line_hashes'))
  THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_require_phase_b_scope(
  p_actor uuid,
  p_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_scope jsonb;
  v_capability text := upper(coalesce(p_capability,''));
BEGIN
  IF v_capability NOT IN ('PROPOSE_MATCH','CONFIRM_MATCH') THEN
    RAISE EXCEPTION 'COLLECTION_PHASE_B_CAPABILITY_INVALID' USING ERRCODE='42501';
  END IF;
  SELECT a.capability_scope INTO v_scope
  FROM public.collection_domain_assignments a
  WHERE a.user_id=p_actor AND a.capability=v_capability AND a.is_active;
  IF NOT public.collection_phase_b_scope_is_valid(v_scope) THEN
    RAISE EXCEPTION 'COLLECTION_SCOPED_CAPABILITY_REQUIRED:%',v_capability USING ERRCODE='42501';
  END IF;
  RETURN v_scope;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_phase_b_scope_allows(
  p_scope jsonb,
  p_item_id uuid,
  p_daily_line_id uuid,
  p_daily_line_hash text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.collection_phase_b_scope_is_valid(p_scope)
    AND (p_item_id IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_scope->'remittance_item_ids') e(value)
      WHERE e.value=p_item_id::text
    ))
    AND (p_daily_line_id IS NULL OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(p_scope->'daily_line_ids') WITH ORDINALITY i(value,n)
      JOIN jsonb_array_elements_text(p_scope->'daily_line_hashes') WITH ORDINALITY h(value,n) USING(n)
      WHERE i.value=p_daily_line_id::text AND h.value=p_daily_line_hash
    ))
$$;

CREATE OR REPLACE FUNCTION public.collection_current_actor_has_phase_b_capability(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collection_domain_assignments a
    WHERE a.user_id=auth.uid() AND a.capability=upper(p_capability) AND a.is_active
      AND a.capability IN ('PROPOSE_MATCH','CONFIRM_MATCH')
      AND public.collection_phase_b_scope_is_valid(a.capability_scope)
  )
$$;

-- --------------------------------------------------------------------------
-- Deterministic reference signal. Leading zeroes are never numeric-cast.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.collection_normalize_reference(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT nullif(btrim(regexp_replace(upper(coalesce(p_value,'')),'[^A-Z0-9]+',' ','g')),'')
$$;

CREATE OR REPLACE FUNCTION public.collection_reference_signal(
  p_reference text,
  p_description_sanitized text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_reference text := public.collection_normalize_reference(p_reference);
  v_description text := public.collection_normalize_reference(p_description_sanitized);
  v_compact text;
BEGIN
  IF v_reference IS NULL THEN RETURN 'REFERENCE_NOT_AVAILABLE'; END IF;
  v_compact := regexp_replace(v_reference,'[^A-Z0-9]','','g');
  IF char_length(v_compact) < 4 THEN RETURN 'REFERENCE_TOO_SHORT'; END IF;
  IF position(' '||v_reference||' ' IN ' '||coalesce(v_description,'')||' ') > 0 THEN
    RETURN 'REFERENCE_TOKEN_EXACT';
  END IF;
  RETURN 'REFERENCE_NOT_FOUND';
END;
$$;

-- --------------------------------------------------------------------------
-- Scoped access administration. V1 remains usable for non-Phase-B grants.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_collection_capability_v2(
  p_command_key text,
  p_user_id uuid,
  p_capability text,
  p_active boolean,
  p_reason text,
  p_scope jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid:=public.collection_require_actor();
  v_cached jsonb;
  v_result jsonb;
  v_id uuid;
  v_cap text:=upper(coalesce(p_capability,''));
  v_assignment_scope jsonb;
BEGIN
  IF NOT public.has_role(v_actor,'admin'::public.app_role)
     AND NOT EXISTS(
       SELECT 1 FROM public.collection_domain_assignments
       WHERE user_id=v_actor AND capability='MANAGE_ACCESS' AND is_active
     ) THEN RAISE EXCEPTION 'COLLECTION_MANAGE_ACCESS_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR btrim(p_reason)='' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION 'COLLECTION_ACCESS_ASSIGNMENT_INVALID'; END IF;
  IF v_cap NOT IN ('ENTRY','IMPORT_COLLECTIONS','VALIDATE_REMITTANCE','WITHDRAW_REMITTANCE','PROPOSE_MATCH',
    'CONFIRM_MATCH','CORRECT_CAPTURE','CANCEL_REMITTANCE','RESOLVE_DUPLICATE','CORRECT_EVIDENCE',
    'ACTIVATE_CUTOVER','AUDIT','MANAGE_ACCESS') THEN RAISE EXCEPTION 'COLLECTION_CAPABILITY_INVALID'; END IF;
  IF p_active AND v_cap IN ('PROPOSE_MATCH','CONFIRM_MATCH')
     AND NOT public.collection_phase_b_scope_is_valid(p_scope) THEN
    RAISE EXCEPTION 'COLLECTION_PHASE_B_SCOPE_REQUIRED'; END IF;
  IF p_active AND v_cap NOT IN ('PROPOSE_MATCH','CONFIRM_MATCH') AND p_scope IS NOT NULL THEN
    RAISE EXCEPTION 'COLLECTION_UNEXPECTED_CAPABILITY_SCOPE'; END IF;
  IF NOT p_active AND p_scope IS NOT NULL THEN RAISE EXCEPTION 'COLLECTION_REVOKE_SCOPE_FORBIDDEN'; END IF;

  v_cached:=public.collection_idempotency_begin(v_actor,'grant_collection_capability_v2',p_command_key,
    jsonb_build_object('user_id',p_user_id,'capability',v_cap,'active',p_active,'reason',p_reason,'scope',p_scope));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_active THEN
    IF EXISTS(SELECT 1 FROM public.collection_domain_assignments WHERE user_id=p_user_id AND capability=v_cap AND is_active) THEN
      RAISE EXCEPTION 'COLLECTION_CAPABILITY_ALREADY_ACTIVE'; END IF;
    INSERT INTO public.collection_domain_assignments(user_id,capability,granted_by,reason,capability_scope)
    VALUES(p_user_id,v_cap,v_actor,btrim(p_reason),p_scope) RETURNING id INTO v_id;
    v_assignment_scope:=p_scope;
  ELSE
    UPDATE public.collection_domain_assignments
      SET is_active=false,revoked_at=now(),revoked_by=v_actor
      WHERE user_id=p_user_id AND capability=v_cap AND is_active
      RETURNING id,capability_scope INTO v_id,v_assignment_scope;
    IF v_id IS NULL THEN RAISE EXCEPTION 'COLLECTION_ACTIVE_CAPABILITY_NOT_FOUND'; END IF;
  END IF;
  PERFORM public.collection_append_event(v_actor,'grant_collection_capability_v2',
    CASE WHEN p_active THEN 'CAPABILITY_GRANTED' ELSE 'CAPABILITY_REVOKED' END,
    'DOMAIN_ASSIGNMENT',v_id,v_id,p_reason,NULL,NULL,
    jsonb_build_object(
      'user_id',p_user_id,'capability',v_cap,
      'scope_mode',CASE WHEN v_assignment_scope IS NULL THEN NULL ELSE v_assignment_scope->>'mode' END,
      'campaign_id',CASE WHEN v_assignment_scope IS NULL THEN NULL ELSE v_assignment_scope->>'campaign_id' END,
      'scope',v_assignment_scope
    ));
  v_result:=jsonb_build_object(
    'outcome',CASE WHEN p_active THEN 'granted' ELSE 'revoked' END,
    'assignment_id',v_id,'user_id',p_user_id,'capability',v_cap
  );
  RETURN public.collection_idempotency_finish(v_actor,'grant_collection_capability_v2',p_command_key,v_result);
END;
$$;

-- --------------------------------------------------------------------------
-- Read-only candidate discovery, bounded by item, account and server scope
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_collection_match_candidates_v1(
  p_remittance_item_id uuid,
  p_date_from date,
  p_date_to date,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  daily_line_id uuid,
  canonical_unit_id uuid,
  daily_line_hash text,
  account_registry_id uuid,
  accounting_date date,
  value_date date,
  description_sanitized text,
  credit_amount numeric,
  unallocated_credit_amount numeric,
  currency text,
  source_attempt_id uuid,
  source_raw_text_hash text,
  reference_signal text,
  reason_codes text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid:=public.collection_require_actor();
  v_scope jsonb;
  v_item record;
  v_campaign_id text;
BEGIN
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from OR p_date_to-p_date_from>120 THEN
    RAISE EXCEPTION 'COLLECTION_MATCH_DATE_WINDOW_INVALID'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'COLLECTION_MATCH_LIMIT_INVALID'; END IF;
  v_scope:=public.collection_require_phase_b_scope(v_actor,'PROPOSE_MATCH');
  IF NOT public.collection_phase_b_scope_allows(v_scope,p_remittance_item_id,NULL,NULL) THEN RETURN; END IF;
  v_campaign_id:=v_scope->>'campaign_id';

  SELECT i.id,i.item_amount,i.currency,i.status,b.deposit_account_id,b.deposit_currency,
         b.deposit_date,b.status remittance_status,r.duplicate_review_status,x.instrument_reference,
         coalesce((SELECT sum(a.settled_gross_amount) FROM public.collection_bank_line_allocations a
           WHERE a.remittance_item_id=i.id AND a.allocation_type='CREDIT_ALLOCATION'
             AND a.allocation_status IN ('CONFIRMED','EXCEPTION')),0) settled_amount
    INTO v_item
  FROM public.collection_bank_remittance_items i
  JOIN public.collection_bank_remittances b ON b.id=i.remittance_id
  JOIN public.collection_receipts r ON r.id=i.receipt_id
  LEFT JOIN public.collection_instruments x ON x.id=i.instrument_id
  JOIN public.daily_statement_account_registry ar ON ar.id=b.deposit_account_id AND ar.status='active'
  WHERE i.id=p_remittance_item_id;
  IF v_item.id IS NULL OR v_item.status NOT IN ('SUBMITTED','PARTIALLY_CREDITED')
     OR v_item.remittance_status NOT IN ('SUBMITTED','PARTIALLY_CREDITED')
     OR v_item.duplicate_review_status='OPEN'
     OR v_item.deposit_account_id IS NULL
     OR v_item.currency<>v_item.deposit_currency THEN
    RAISE EXCEPTION 'COLLECTION_MATCH_ITEM_NOT_AVAILABLE'; END IF;

  RETURN QUERY
  SELECT l.id,u.id,l.daily_line_hash,u.account_registry_id,l.accounting_date,l.value_date,
         l.description_sanitized,l.credit_amount,
         l.credit_amount-coalesce(used.consumed,0)-coalesce(reserved.reserved,0),l.currency,
         att.id,att.raw_text_hash,
         public.collection_reference_signal(v_item.instrument_reference,l.description_sanitized),
         ARRAY['EXACT_ACCOUNT','EXACT_CURRENCY','ACTIVE_CANONICAL_CREDIT','AVAILABLE_CREDIT_POSITIVE']::text[]
         || CASE WHEN l.credit_amount=(v_item.item_amount-v_item.settled_amount)
              THEN ARRAY['EXACT_AMOUNT']::text[]
              WHEN l.credit_amount<(v_item.item_amount-v_item.settled_amount)
              THEN ARRAY['LOWER_AMOUNT_DISCOUNT_POSSIBLE']::text[] ELSE '{}'::text[] END
         || ARRAY[public.collection_reference_signal(v_item.instrument_reference,l.description_sanitized)]::text[]
         || CASE WHEN l.accounting_date>=v_item.deposit_date THEN ARRAY['DATE_ON_OR_AFTER_DEPOSIT']::text[]
              ELSE ARRAY['DATE_BEFORE_DEPOSIT_REVIEW']::text[] END
         || CASE WHEN l.credit_amount-coalesce(used.consumed,0)-coalesce(reserved.reserved,0)<l.credit_amount
              THEN ARRAY['PARTIAL_ALLOCATION_ONLY']::text[] ELSE '{}'::text[] END
  FROM public.daily_statement_lines_canonical l
  JOIN public.daily_statement_units_canonical u ON u.id=l.canonical_unit_id
  JOIN public.daily_statement_units_staging st ON st.id=u.promoted_from_staging_unit_id
  JOIN public.daily_statement_export_attempts att ON att.id=st.attempt_id
  JOIN public.daily_statement_account_registry ar ON ar.id=u.account_registry_id
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(a.credit_line_consumed_amount),0) consumed
    FROM public.collection_bank_line_allocations a
    WHERE a.daily_line_id=l.id AND a.allocation_type='CREDIT_ALLOCATION'
      AND a.allocation_status IN ('CONFIRMED','EXCEPTION')
  ) used ON true
  LEFT JOIN LATERAL (
    SELECT coalesce(sum((e->>'credit_line_consumed_amount')::numeric),0) reserved
    FROM public.collection_match_proposals p
    CROSS JOIN LATERAL jsonb_array_elements(p.allocation_plan) e
    WHERE p.credit_daily_line_id=l.id AND p.status='PENDING'
      AND EXISTS(SELECT 1 FROM public.daily_statement_lines_canonical x WHERE x.id=p.credit_daily_line_id AND x.is_active)
      AND NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(p.fee_evidence_plan) f
        LEFT JOIN public.daily_statement_lines_canonical fl ON fl.id=(f->>'daily_line_id')::uuid
        WHERE fl.id IS NULL OR NOT fl.is_active
      )
  ) reserved ON true
  WHERE l.is_active AND l.direction='credit' AND l.credit_amount>0
    AND u.status='ingested' AND u.account_registry_id=v_item.deposit_account_id
    AND l.currency=v_item.currency AND u.currency=v_item.currency
    AND ar.status='active' AND l.accounting_date BETWEEN p_date_from AND p_date_to
    AND att.id IS NOT NULL AND att.raw_text_hash ~ '^[0-9a-f]{64}$'
    AND att.source_file_name_redacted LIKE v_campaign_id||'%'
    AND public.collection_phase_b_scope_allows(v_scope,v_item.id,l.id,l.daily_line_hash)
    AND l.credit_amount-coalesce(used.consumed,0)-coalesce(reserved.reserved,0)>0
  ORDER BY l.accounting_date DESC,l.id DESC
  LIMIT p_limit;
END;
$$;

-- --------------------------------------------------------------------------
-- V2 write envelopes: scoped, snapshot-bound, V1 retained as private engine
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.propose_collection_match_v2(
  p_command_key text,
  p_action text,
  p_proposal_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid:=public.collection_require_actor();
  v_scope jsonb:=public.collection_require_phase_b_scope(v_actor,'PROPOSE_MATCH');
  v_cached jsonb;
  v_result jsonb;
  v_inner_payload jsonb;
  v_action text:=upper(coalesce(p_action,''));
  v_item_id uuid;
  v_line_id uuid;
  v_proposal public.collection_match_proposals%ROWTYPE;
  v_evidence record;
  v_reference text;
  v_signal text;
  v_reason_codes text[];
  v_settled_amount numeric;
  v_consumed_amount numeric;
  v_reserved_amount numeric;
BEGIN
  v_cached:=public.collection_idempotency_begin(v_actor,'propose_collection_match_v2',p_command_key,
    jsonb_build_object('action',v_action,'proposal_id',p_proposal_id,'payload',p_payload));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF v_action='WITHDRAW_PROPOSAL' THEN
    SELECT * INTO v_proposal FROM public.collection_match_proposals WHERE id=p_proposal_id;
    IF v_proposal.id IS NULL OR v_proposal.expected_daily_line_hash IS NULL
       OR NOT public.collection_phase_b_scope_allows(
         v_scope,(v_proposal.allocation_plan->0->>'remittance_item_id')::uuid,
         v_proposal.credit_daily_line_id,v_proposal.expected_daily_line_hash
       ) THEN RAISE EXCEPTION 'COLLECTION_SCOPED_PROPOSAL_NOT_AVAILABLE'; END IF;
    v_result:=public.propose_collection_match_v1(p_command_key||':INNER',v_action,p_proposal_id,p_payload);
    RETURN public.collection_idempotency_finish(v_actor,'propose_collection_match_v2',p_command_key,v_result);
  END IF;

  IF v_action<>'CREATE' OR jsonb_typeof(p_payload)<>'object'
     OR p_payload->>'evidence_basis' NOT IN ('EXACT_CREDIT','NET_OF_DISCOUNT')
     OR p_payload->>'allocation_mode'<>'SINGLE_ITEM'
     OR jsonb_typeof(p_payload->'allocation_plan')<>'array'
     OR jsonb_array_length(p_payload->'allocation_plan')<>1
     OR coalesce((p_payload->>'proposed_fee_consumed_amount')::numeric,0)<>0
     OR jsonb_typeof(p_payload->'fee_evidence_plan')<>'array'
     OR jsonb_array_length(p_payload->'fee_evidence_plan')<>0 THEN
    RAISE EXCEPTION 'COLLECTION_PHASE_B_PROPOSAL_SHAPE_INVALID'; END IF;

  v_item_id:=(p_payload->'allocation_plan'->0->>'remittance_item_id')::uuid;
  v_line_id:=(p_payload->>'credit_daily_line_id')::uuid;
  IF NOT public.collection_phase_b_scope_allows(
    v_scope,v_item_id,v_line_id,p_payload->>'expected_daily_line_hash'
  ) THEN
    RAISE EXCEPTION 'COLLECTION_SCOPED_EVIDENCE_NOT_AVAILABLE';
  END IF;
  PERFORM 1 FROM public.daily_statement_lines_canonical l WHERE l.id=v_line_id FOR UPDATE;
  SELECT l.id line_id,l.canonical_unit_id,l.daily_line_hash,u.account_registry_id,l.accounting_date,
         l.credit_amount,l.currency,l.description_sanitized,l.is_active,l.direction,u.status unit_status,
         ar.status account_status,att.id source_attempt_id,att.raw_text_hash,att.source_file_name_redacted,
         x.instrument_reference,i.item_amount,b.deposit_date
    INTO v_evidence
  FROM public.daily_statement_lines_canonical l
  JOIN public.daily_statement_units_canonical u ON u.id=l.canonical_unit_id
  JOIN public.daily_statement_units_staging st ON st.id=u.promoted_from_staging_unit_id
  JOIN public.daily_statement_export_attempts att ON att.id=st.attempt_id
  JOIN public.daily_statement_account_registry ar ON ar.id=u.account_registry_id
  JOIN public.collection_bank_remittance_items i ON i.id=v_item_id
  JOIN public.collection_bank_remittances b ON b.id=i.remittance_id
  LEFT JOIN public.collection_instruments x ON x.id=i.instrument_id
  WHERE l.id=v_line_id;
  IF v_evidence.line_id IS NULL
     OR NOT public.collection_phase_b_scope_allows(v_scope,v_item_id,v_line_id,v_evidence.daily_line_hash)
     OR NOT v_evidence.is_active OR v_evidence.direction<>'credit'
     OR v_evidence.unit_status<>'ingested' OR v_evidence.account_status<>'active'
     OR v_evidence.source_file_name_redacted NOT LIKE (v_scope->>'campaign_id')||'%'
     OR v_evidence.canonical_unit_id IS DISTINCT FROM (p_payload->>'expected_canonical_unit_id')::uuid
     OR v_evidence.daily_line_hash IS DISTINCT FROM p_payload->>'expected_daily_line_hash'
     OR v_evidence.account_registry_id IS DISTINCT FROM (p_payload->>'expected_account_registry_id')::uuid
     OR v_evidence.accounting_date IS DISTINCT FROM (p_payload->>'expected_accounting_date')::date
     OR v_evidence.credit_amount IS DISTINCT FROM (p_payload->>'expected_credit_amount')::numeric
     OR v_evidence.currency IS DISTINCT FROM p_payload->>'expected_currency'
     OR v_evidence.source_attempt_id IS DISTINCT FROM (p_payload->>'expected_source_attempt_id')::uuid
     OR v_evidence.raw_text_hash IS DISTINCT FROM p_payload->>'expected_source_raw_text_hash' THEN
    RAISE EXCEPTION 'COLLECTION_PHASE_B_EVIDENCE_SNAPSHOT_MISMATCH'; END IF;

  v_reference:=public.collection_normalize_reference(v_evidence.instrument_reference);
  v_signal:=public.collection_reference_signal(v_evidence.instrument_reference,v_evidence.description_sanitized);
  SELECT coalesce(sum(a.settled_gross_amount),0) INTO v_settled_amount
  FROM public.collection_bank_line_allocations a
  WHERE a.remittance_item_id=v_item_id AND a.allocation_type='CREDIT_ALLOCATION'
    AND a.allocation_status IN ('CONFIRMED','EXCEPTION');
  SELECT coalesce(sum(a.credit_line_consumed_amount),0) INTO v_consumed_amount
  FROM public.collection_bank_line_allocations a
  WHERE a.daily_line_id=v_line_id AND a.allocation_type='CREDIT_ALLOCATION'
    AND a.allocation_status IN ('CONFIRMED','EXCEPTION');
  SELECT coalesce(sum((e->>'credit_line_consumed_amount')::numeric),0) INTO v_reserved_amount
  FROM public.collection_match_proposals p
  CROSS JOIN LATERAL jsonb_array_elements(p.allocation_plan) e
  WHERE p.credit_daily_line_id=v_line_id AND p.status='PENDING';
  v_reason_codes:=ARRAY['EXACT_ACCOUNT','EXACT_CURRENCY','ACTIVE_CANONICAL_CREDIT','AVAILABLE_CREDIT_POSITIVE']::text[]
    || CASE WHEN v_evidence.credit_amount=(v_evidence.item_amount-v_settled_amount)
         THEN ARRAY['EXACT_AMOUNT']::text[]
         WHEN v_evidence.credit_amount<(v_evidence.item_amount-v_settled_amount)
         THEN ARRAY['LOWER_AMOUNT_DISCOUNT_POSSIBLE']::text[] ELSE '{}'::text[] END
    || ARRAY[v_signal]::text[]
    || CASE WHEN v_evidence.accounting_date>=v_evidence.deposit_date
         THEN ARRAY['DATE_ON_OR_AFTER_DEPOSIT']::text[] ELSE ARRAY['DATE_BEFORE_DEPOSIT_REVIEW']::text[] END
    || CASE WHEN v_evidence.credit_amount-v_consumed_amount-v_reserved_amount<v_evidence.credit_amount
         THEN ARRAY['PARTIAL_ALLOCATION_ONLY']::text[] ELSE '{}'::text[] END;
  v_inner_payload:=p_payload || jsonb_build_object(
    'reference_source_daily_line_id',v_line_id,
    'extracted_reference',CASE WHEN v_signal='REFERENCE_TOKEN_EXACT' THEN v_reference ELSE NULL END,
    'normalized_reference',CASE WHEN v_signal='REFERENCE_TOKEN_EXACT' THEN v_reference ELSE NULL END,
    'reference_confidence',CASE WHEN v_signal='REFERENCE_TOKEN_EXACT' THEN 1 ELSE NULL END
  );
  v_result:=public.propose_collection_match_v1(p_command_key||':INNER','CREATE',NULL,v_inner_payload);
  UPDATE public.collection_match_proposals SET
    expected_canonical_unit_id=v_evidence.canonical_unit_id,
    expected_daily_line_hash=v_evidence.daily_line_hash,
    expected_account_registry_id=v_evidence.account_registry_id,
    expected_accounting_date=v_evidence.accounting_date,
    expected_credit_amount=v_evidence.credit_amount,
    expected_currency=v_evidence.currency,
    expected_source_attempt_id=v_evidence.source_attempt_id,
    expected_source_raw_text_hash=v_evidence.raw_text_hash,
    reference_signal=v_signal,
    candidate_reason_codes=v_reason_codes
  WHERE id=(v_result->>'proposal_id')::uuid AND proposed_by=v_actor;
  RETURN public.collection_idempotency_finish(v_actor,'propose_collection_match_v2',p_command_key,v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_collection_match_v2(
  p_command_key text,
  p_proposal_id uuid,
  p_decision text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid:=public.collection_require_actor();
  v_scope jsonb:=public.collection_require_phase_b_scope(v_actor,'CONFIRM_MATCH');
  v_cached jsonb;
  v_result jsonb;
  v_proposal public.collection_match_proposals%ROWTYPE;
  v_item jsonb;
  v_line record;
BEGIN
  v_cached:=public.collection_idempotency_begin(v_actor,'confirm_collection_match_v2',p_command_key,
    jsonb_build_object('proposal_id',p_proposal_id,'decision',upper(coalesce(p_decision,'')),'reason',p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  SELECT * INTO v_proposal FROM public.collection_match_proposals WHERE id=p_proposal_id FOR UPDATE;
  IF v_proposal.id IS NULL OR v_proposal.expected_daily_line_hash IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_SCOPED_PROPOSAL_NOT_AVAILABLE'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_proposal.allocation_plan) LOOP
    IF NOT public.collection_phase_b_scope_allows(
      v_scope,(v_item->>'remittance_item_id')::uuid,
      v_proposal.credit_daily_line_id,v_proposal.expected_daily_line_hash
    ) THEN RAISE EXCEPTION 'COLLECTION_SCOPED_PROPOSAL_NOT_AVAILABLE'; END IF;
  END LOOP;
  SELECT l.canonical_unit_id,l.daily_line_hash,u.account_registry_id,l.accounting_date,
         l.credit_amount,l.currency,att.id source_attempt_id,att.raw_text_hash
    INTO v_line
  FROM public.daily_statement_lines_canonical l
  JOIN public.daily_statement_units_canonical u ON u.id=l.canonical_unit_id
  JOIN public.daily_statement_units_staging st ON st.id=u.promoted_from_staging_unit_id
  JOIN public.daily_statement_export_attempts att ON att.id=st.attempt_id
  WHERE l.id=v_proposal.credit_daily_line_id;
  IF upper(coalesce(p_decision,''))='CONFIRM' AND (
     v_line.canonical_unit_id IS DISTINCT FROM v_proposal.expected_canonical_unit_id
     OR v_line.daily_line_hash IS DISTINCT FROM v_proposal.expected_daily_line_hash
     OR v_line.account_registry_id IS DISTINCT FROM v_proposal.expected_account_registry_id
     OR v_line.accounting_date IS DISTINCT FROM v_proposal.expected_accounting_date
     OR v_line.credit_amount IS DISTINCT FROM v_proposal.expected_credit_amount
     OR v_line.currency IS DISTINCT FROM v_proposal.expected_currency
     OR v_line.source_attempt_id IS DISTINCT FROM v_proposal.expected_source_attempt_id
     OR v_line.raw_text_hash IS DISTINCT FROM v_proposal.expected_source_raw_text_hash) THEN
    RAISE EXCEPTION 'COLLECTION_PHASE_B_EVIDENCE_SNAPSHOT_MISMATCH'; END IF;
  v_result:=public.confirm_collection_match_v1(
    p_command_key||':INNER',p_proposal_id,upper(p_decision),p_reason
  );
  RETURN public.collection_idempotency_finish(v_actor,'confirm_collection_match_v2',p_command_key,v_result);
END;
$$;

-- --------------------------------------------------------------------------
-- Bounded review queue for the independent confirmer
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_collection_match_reviews_v1(p_limit integer DEFAULT 50)
RETURNS TABLE(
  proposal_id uuid,
  created_at timestamptz,
  proposed_by uuid,
  remittance_item_id uuid,
  client_name text,
  deposit_account_id uuid,
  account_safe_alias text,
  nominal_amount numeric,
  credit_amount numeric,
  observed_fee_amount numeric,
  evidence_basis text,
  proposal_reason text,
  accounting_date date,
  description_sanitized text,
  reference_signal text,
  reason_codes text[],
  evidence_available boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid:=public.collection_require_actor();
  v_scope jsonb:=public.collection_require_phase_b_scope(v_actor,'CONFIRM_MATCH');
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'COLLECTION_MATCH_LIMIT_INVALID'; END IF;
  RETURN QUERY
  SELECT p.id,p.created_at,p.proposed_by,i.id,r.client_name,b.deposit_account_id,ar.safe_alias,
         (e.value->>'settled_gross_amount')::numeric,p.proposed_credit_consumed_amount,
         (e.value->>'observed_fee_amount')::numeric,p.evidence_basis,p.reason,l.accounting_date,
         l.description_sanitized,p.reference_signal,coalesce(p.candidate_reason_codes,'{}'::text[]),
         (l.is_active AND l.direction='credit' AND u.status='ingested' AND ar.status='active'
          AND l.canonical_unit_id=p.expected_canonical_unit_id
          AND l.daily_line_hash=p.expected_daily_line_hash
          AND u.account_registry_id=p.expected_account_registry_id
          AND l.accounting_date=p.expected_accounting_date
          AND l.credit_amount=p.expected_credit_amount
          AND l.currency=p.expected_currency
          AND att.id=p.expected_source_attempt_id
          AND att.raw_text_hash=p.expected_source_raw_text_hash)
  FROM public.collection_match_proposals p
  CROSS JOIN LATERAL jsonb_array_elements(p.allocation_plan) e
  JOIN public.collection_bank_remittance_items i ON i.id=(e.value->>'remittance_item_id')::uuid
  JOIN public.collection_bank_remittances b ON b.id=i.remittance_id
  JOIN public.collection_receipts r ON r.id=i.receipt_id
  JOIN public.daily_statement_lines_canonical l ON l.id=p.credit_daily_line_id
  JOIN public.daily_statement_units_canonical u ON u.id=l.canonical_unit_id
  JOIN public.daily_statement_units_staging st ON st.id=u.promoted_from_staging_unit_id
  JOIN public.daily_statement_export_attempts att ON att.id=st.attempt_id
  JOIN public.daily_statement_account_registry ar ON ar.id=u.account_registry_id
  WHERE p.status='PENDING' AND p.allocation_mode='SINGLE_ITEM'
    AND p.expected_daily_line_hash IS NOT NULL
    AND public.collection_phase_b_scope_allows(v_scope,i.id,p.credit_daily_line_id,p.expected_daily_line_hash)
  ORDER BY p.created_at DESC,p.id DESC
  LIMIT p_limit;
END;
$$;

-- --------------------------------------------------------------------------
-- Close direct read/write bypasses and expose only the bounded surface
-- --------------------------------------------------------------------------

REVOKE SELECT ON TABLE public.collection_match_proposals FROM authenticated,service_role;
REVOKE SELECT ON TABLE public.collection_bank_line_allocations FROM authenticated,service_role;
REVOKE SELECT ON TABLE public.collection_exception_status_v FROM authenticated,service_role;

REVOKE ALL ON FUNCTION public.propose_collection_match_v1(text,text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.confirm_collection_match_v1(text,uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE v_signature regprocedure;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.collection_phase_b_scope_is_valid(jsonb)'::regprocedure,
    'public.collection_require_phase_b_scope(uuid,text)'::regprocedure,
    'public.collection_phase_b_scope_allows(jsonb,uuid,uuid,text)'::regprocedure,
    'public.collection_current_actor_has_phase_b_capability(text)'::regprocedure,
    'public.collection_normalize_reference(text)'::regprocedure,
    'public.collection_reference_signal(text,text)'::regprocedure,
    'public.grant_collection_capability_v2(text,uuid,text,boolean,text,jsonb)'::regprocedure,
    'public.list_collection_match_candidates_v1(uuid,date,date,integer)'::regprocedure,
    'public.propose_collection_match_v2(text,text,uuid,jsonb)'::regprocedure,
    'public.confirm_collection_match_v2(text,uuid,text,text)'::regprocedure,
    'public.list_collection_match_reviews_v1(integer)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_signature);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.collection_current_actor_has_phase_b_capability(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_collection_capability_v2(text,uuid,text,boolean,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_collection_match_candidates_v1(uuid,date,date,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_collection_match_v2(text,text,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_collection_match_v2(text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_collection_match_reviews_v1(integer) TO authenticated;

COMMENT ON FUNCTION public.list_collection_match_candidates_v1(uuid,date,date,integer) IS
  'Read-only Phase B candidate discovery, bounded by scoped item, exact account, currency and Daily v2 provenance.';
COMMENT ON FUNCTION public.list_collection_match_reviews_v1(integer) IS
  'Read-only Phase B confirmation queue, bounded by the confirmer scoped allowlist.';
COMMENT ON COLUMN public.collection_domain_assignments.capability_scope IS
  'Versioned server-enforced scope. Phase B accepts only PILOT_ALLOWLIST_V1 in this release.';

COMMIT;
