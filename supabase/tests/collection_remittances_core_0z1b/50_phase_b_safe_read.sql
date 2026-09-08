\set ON_ERROR_STOP on

-- Phase B uses two new synthetic actors: a manager proposes and a user confirms.
INSERT INTO auth.users(id,email) VALUES
  ('00000000-0000-4000-8000-000000000005','phase-b-operator.synthetic.invalid'),
  ('00000000-0000-4000-8000-000000000006','phase-b-controller.synthetic.invalid');
INSERT INTO public.user_roles(user_id,role) VALUES
  ('00000000-0000-4000-8000-000000000005','manager'),
  ('00000000-0000-4000-8000-000000000006','user');

-- Synthetic provenance-complete Daily v2 evidence. It is inserted only in the
-- disposable replay database; production creation remains pipeline-only.
INSERT INTO public.daily_statement_export_attempts(
  id,created_by,source_file_name_redacted,raw_text_hash
) VALUES (
  '40000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'PILOT-0Z1B-PG17-PHASE-B-synthetic.csv',repeat('a',64)
),(
  '40000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'PILOT-0Z1B-PG17-PHASE-B-wrong-bank.csv',repeat('b',64)
);
INSERT INTO public.daily_statement_units_staging(id,attempt_id,status) VALUES
  ('41000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','promoted'),
  ('41000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','promoted');
INSERT INTO public.daily_statement_units_canonical(
  id,promoted_from_staging_unit_id,bank,account_fingerprint,currency,accounting_date,status,account_registry_id
) VALUES
  ('42000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',
   'BANK_A',repeat('a',64),'XOF','2026-08-05','ingested','10000000-0000-0000-0000-000000000001'),
  ('42000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002',
   'BANK_B',repeat('b',64),'XOF','2026-08-05','ingested','10000000-0000-0000-0000-000000000002');
INSERT INTO public.daily_statement_lines_canonical(
  id,canonical_unit_id,daily_line_hash,is_active,accounting_date,value_date,
  description_sanitized,debit_amount,credit_amount,signed_amount,direction,currency
) VALUES
  ('43000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001',repeat('c',64),true,
   '2026-08-05','2026-08-05','CREDIT CHECK 000123',NULL,1000,1000,'credit','XOF'),
  ('43000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000002',repeat('d',64),true,
   '2026-08-05','2026-08-05','CREDIT CHECK 000123',NULL,1000,1000,'credit','XOF'),
  ('43000000-0000-4000-8000-000000000003','42000000-0000-4000-8000-000000000001',repeat('e',64),false,
   '2026-08-05','2026-08-05','INACTIVE CREDIT CHECK 000123',NULL,1000,1000,'credit','XOF'),
  ('43000000-0000-4000-8000-000000000004','42000000-0000-4000-8000-000000000001',repeat('f',64),true,
   '2026-08-05','2026-08-05','DEBIT CHECK 000123',1000,NULL,-1000,'debit','XOF');

-- Create and independently validate one current Bank A item using existing Core commands.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id,(x->>'item_id') item_id
FROM (SELECT public.create_collection_entry_v1(
  'phase-b-entry',
  jsonb_build_object('client_name','PILOT-0Z1B-PG17-PHASE-B CLIENT','receipt_method','CHECK',
    'expected_amount',1000,'currency','XOF','client_bank','SYNTHETIC DRAWN BANK'),
  jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001',
    'deposit_currency','XOF','declared_total_amount',1000,'deposit_date','2026-08-05',
    'slip_reference','PILOT-0Z1B-PG17-PHASE-B SLIP','capture_mode','MANUAL','remittance_kind','PHYSICAL'),
  jsonb_build_object('item_amount',1000,'currency','XOF','instrument',jsonb_build_object(
    'instrument_type','CHECK','identity_namespace','CHECK:PHASE-B','normalized_identity_hash',repeat('e',64),
    'identity_strength','STRONG_VERIFIED','instrument_reference','000123','nominal_amount',1000,'currency','XOF')),
  NULL
) x) s \gset phase_b_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1(
  'phase-b-validate',:'phase_b_remittance_id','PILOT-0Z1B-PG17-PHASE-B independent validation'
);
RESET ROLE;

-- A and B receive only scoped Phase B capabilities; B also receives AUDIT for export.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.grant_collection_capability_v2(
  'phase-b-grant-a','00000000-0000-4000-8000-000000000005','PROPOSE_MATCH',true,'synthetic scoped grant',
  jsonb_build_object('version',1,'mode','PILOT_ALLOWLIST_V1','campaign_id','PILOT-0Z1B-PG17-PHASE-B',
    'remittance_item_ids',jsonb_build_array(:'phase_b_item_id'),
    'daily_line_ids',jsonb_build_array('43000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000003','43000000-0000-4000-8000-000000000004'),
    'daily_line_hashes',jsonb_build_array(repeat('c',64),repeat('d',64),repeat('e',64),repeat('f',64)),
    'expires_at',to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SSOF'))
);
SELECT public.grant_collection_capability_v2(
  'phase-b-grant-b','00000000-0000-4000-8000-000000000006','CONFIRM_MATCH',true,'synthetic scoped grant',
  jsonb_build_object('version',1,'mode','PILOT_ALLOWLIST_V1','campaign_id','PILOT-0Z1B-PG17-PHASE-B',
    'remittance_item_ids',jsonb_build_array(:'phase_b_item_id'),
    'daily_line_ids',jsonb_build_array('43000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000003','43000000-0000-4000-8000-000000000004'),
    'daily_line_hashes',jsonb_build_array(repeat('c',64),repeat('d',64),repeat('e',64),repeat('f',64)),
    'expires_at',to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SSOF'))
);
SELECT public.grant_collection_capability_v2(
  'phase-b-grant-audit','00000000-0000-4000-8000-000000000006','AUDIT',true,'synthetic audit grant',NULL
);
RESET ROLE;

-- Least privilege and read-only guarantees.
SELECT poc_test.assert(
  NOT has_function_privilege('authenticated','public.propose_collection_match_v1(text,text,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.confirm_collection_match_v1(text,uuid,text,text)','EXECUTE'),
  'legacy matching engines must not remain directly executable');
SELECT poc_test.assert(
  NOT has_table_privilege('authenticated','public.collection_match_proposals','SELECT')
  AND NOT has_table_privilege('authenticated','public.collection_bank_line_allocations','SELECT')
  AND NOT has_table_privilege('authenticated','public.collection_exception_status_v','SELECT'),
  'direct Core matching projections must be closed');
SELECT poc_test.assert(
  NOT has_function_privilege('service_role','public.list_collection_match_candidates_v1(uuid,date,date,integer)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.propose_collection_match_v2(text,text,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.confirm_collection_match_v2(text,uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.list_collection_match_reviews_v1(integer)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.grant_collection_capability_v2(text,uuid,text,boolean,text,jsonb)','EXECUTE'),
  'service_role must not execute Phase B RPCs');
SELECT poc_test.assert((SELECT prosecdef AND provolatile='s' FROM pg_proc
  WHERE oid='public.list_collection_match_candidates_v1(uuid,date,date,integer)'::regprocedure),
  'candidate discovery must be SECURITY DEFINER and STABLE');
SELECT poc_test.assert(public.collection_reference_signal('000123','CREDIT CHECK 000123')='REFERENCE_TOKEN_EXACT',
  'leading-zero reference must match as a complete token');
SELECT poc_test.assert(public.collection_reference_signal('123','CREDIT CHECK 000123')='REFERENCE_TOO_SHORT',
  'short numeric reference must never become a positive signal');
SELECT poc_test.assert(NOT public.collection_phase_b_scope_is_valid(jsonb_build_object(
  'version',1,'mode','PILOT_ALLOWLIST_V1','campaign_id','PILOT-0Z1B-EXPIRED',
  'remittance_item_ids',jsonb_build_array('43000000-0000-4000-8000-000000000001'),
  'daily_line_ids',jsonb_build_array('43000000-0000-4000-8000-000000000001'),
  'daily_line_hashes',jsonb_build_array(repeat('c',64)),
  'expires_at','2020-01-01T00:00:00Z')),
  'expired Phase B scope must be invalid');

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $$
DECLARE v_item_id uuid;
BEGIN
  SELECT i.id INTO v_item_id FROM public.collection_bank_remittance_items i
  JOIN public.collection_receipts r ON r.id=i.receipt_id
  WHERE r.client_name='PILOT-0Z1B-PG17-PHASE-B CLIENT';
  BEGIN
    PERFORM public.list_collection_match_candidates_v1(v_item_id,'2026-08-01','2026-08-31',50);
    RAISE EXCEPTION 'TEST_FAILED: actor without Phase B capability read candidates';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_SCOPED_CAPABILITY_REQUIRED%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
SET ROLE authenticated;
DO $$
DECLARE v_item_id uuid;
BEGIN
  SELECT i.id INTO v_item_id FROM public.collection_bank_remittance_items i
  JOIN public.collection_receipts r ON r.id=i.receipt_id
  WHERE r.client_name='PILOT-0Z1B-PG17-PHASE-B CLIENT';
  BEGIN
    PERFORM public.list_collection_match_candidates_v1(v_item_id,'2026-08-01','2026-08-31',50);
    RAISE EXCEPTION 'TEST_FAILED: historical unscoped PROPOSE_MATCH read candidates';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_SCOPED_CAPABILITY_REQUIRED%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000005';
SET ROLE authenticated;
DO $$
DECLARE v_item_id uuid;
BEGIN
  SELECT i.id INTO v_item_id FROM public.collection_bank_remittance_items i
  JOIN public.collection_receipts r ON r.id=i.receipt_id
  WHERE r.client_name='PILOT-0Z1B-PG17-PHASE-B CLIENT';
  BEGIN
    PERFORM public.list_collection_match_candidates_v1(v_item_id,'2026-08-31','2026-08-01',50);
    RAISE EXCEPTION 'TEST_FAILED: inverted date window accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_MATCH_DATE_WINDOW_INVALID%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.list_collection_match_candidates_v1(v_item_id,'2026-08-01','2026-08-31',101);
    RAISE EXCEPTION 'TEST_FAILED: excessive candidate limit accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_MATCH_LIMIT_INVALID%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SELECT count(*) AS phase_b_events_before FROM public.collection_events \gset
SELECT count(*) AS phase_b_proposals_before FROM public.collection_match_proposals \gset
SELECT count(*) AS phase_b_allocations_before FROM public.collection_bank_line_allocations \gset

SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000005';
SET ROLE authenticated;
SELECT poc_test.assert((SELECT count(*)=0 FROM public.daily_statement_lines_canonical),
  'manager must not gain direct Daily v2 visibility');
SELECT poc_test.assert((SELECT count(*)=1 FROM public.list_collection_match_candidates_v1(
  :'phase_b_item_id','2026-08-01','2026-08-31',50)),
  'candidate RPC must return only the exact Bank A allowlisted credit');
SELECT poc_test.assert((SELECT daily_line_id='43000000-0000-4000-8000-000000000001'::uuid
  AND reference_signal='REFERENCE_TOKEN_EXACT' AND reason_codes @> ARRAY['EXACT_AMOUNT','EXACT_ACCOUNT']::text[]
  FROM public.list_collection_match_candidates_v1(:'phase_b_item_id','2026-08-01','2026-08-31',50)),
  'candidate must expose the expected evidence and explainable signals');
SELECT poc_test.assert((SELECT count(*)=0 FROM public.list_collection_match_candidates_v1(
  '99999999-9999-4999-8999-999999999999','2026-08-01','2026-08-31',50)),
  'an out-of-scope item must reveal no candidate');
RESET ROLE;

SELECT poc_test.assert((SELECT count(*)=:'phase_b_events_before' FROM public.collection_events)
  AND (SELECT count(*)=:'phase_b_proposals_before' FROM public.collection_match_proposals)
  AND (SELECT count(*)=:'phase_b_allocations_before' FROM public.collection_bank_line_allocations),
  'candidate discovery must perform no business or audit write');

SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000005';
SET ROLE authenticated;
DO $$
DECLARE v_item_id uuid;
BEGIN
  SELECT i.id INTO v_item_id
  FROM public.collection_bank_remittance_items i
  JOIN public.collection_receipts r ON r.id=i.receipt_id
  WHERE r.client_name='PILOT-0Z1B-PG17-PHASE-B CLIENT';
  BEGIN
    PERFORM public.propose_collection_match_v2('phase-b-fees-separate','CREATE',NULL,jsonb_build_object(
      'credit_daily_line_id','43000000-0000-4000-8000-000000000001',
      'expected_daily_line_hash',repeat('c',64),'proposed_credit_consumed_amount',1000,
      'proposed_fee_consumed_amount',10,'evidence_basis','FEES_SEPARATE','allocation_mode','SINGLE_ITEM',
      'reason','forbidden separate fees','fee_evidence_plan',jsonb_build_array(jsonb_build_object(
        'daily_line_id','43000000-0000-4000-8000-000000000004','fee_line_consumed_amount',10)),
      'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',v_item_id,
        'credit_line_consumed_amount',1000,'settled_gross_amount',1000,'observed_fee_amount',10))));
    RAISE EXCEPTION 'TEST_FAILED: FEES_SEPARATE accepted by Phase B';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_PHASE_B_PROPOSAL_SHAPE_INVALID%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.propose_collection_match_v2('phase-b-bad-snapshot','CREATE',NULL,jsonb_build_object(
      'credit_daily_line_id','43000000-0000-4000-8000-000000000001',
      'expected_canonical_unit_id','42000000-0000-4000-8000-000000000001',
      'expected_daily_line_hash',repeat('c',64),'expected_account_registry_id','10000000-0000-0000-0000-000000000001',
      'expected_accounting_date','2026-08-05','expected_credit_amount',999,'expected_currency','XOF',
      'expected_source_attempt_id','40000000-0000-4000-8000-000000000001','expected_source_raw_text_hash',repeat('a',64),
      'proposed_credit_consumed_amount',1000,'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT',
      'allocation_mode','SINGLE_ITEM','reason','synthetic mismatch','fee_evidence_plan','[]'::jsonb,
      'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',v_item_id,
        'credit_line_consumed_amount',1000,'settled_gross_amount',1000,'observed_fee_amount',0))));
    RAISE EXCEPTION 'TEST_FAILED: divergent evidence snapshot accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_PHASE_B_EVIDENCE_SNAPSHOT_MISMATCH%' THEN RAISE; END IF;
  END;
END $$;
SELECT (public.propose_collection_match_v2('phase-b-propose','CREATE',NULL,jsonb_build_object(
  'credit_daily_line_id','43000000-0000-4000-8000-000000000001',
  'expected_canonical_unit_id','42000000-0000-4000-8000-000000000001',
  'expected_daily_line_hash',repeat('c',64),'expected_account_registry_id','10000000-0000-0000-0000-000000000001',
  'expected_accounting_date','2026-08-05','expected_credit_amount',1000,'expected_currency','XOF',
  'expected_source_attempt_id','40000000-0000-4000-8000-000000000001','expected_source_raw_text_hash',repeat('a',64),
  'proposed_credit_consumed_amount',1000,'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT',
  'allocation_mode','SINGLE_ITEM','reason','synthetic exact match','fee_evidence_plan','[]'::jsonb,
  'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',:'phase_b_item_id',
    'credit_line_consumed_amount',1000,'settled_gross_amount',1000,'observed_fee_amount',0))))->>'proposal_id') proposal_id \gset phase_b_proposal_
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000006';
SET ROLE authenticated;
SELECT poc_test.assert((SELECT count(*)=1 AND bool_and(evidence_available)
  FROM public.list_collection_match_reviews_v1(50)),
  'confirmer must receive the one scoped effective proposal');
SELECT public.confirm_collection_match_v2(
  'phase-b-confirm',:'phase_b_proposal_proposal_id','CONFIRM','synthetic second-actor confirmation'
);
SELECT public.confirm_collection_match_v2(
  'phase-b-confirm',:'phase_b_proposal_proposal_id','CONFIRM','synthetic second-actor confirmation'
);
SELECT poc_test.assert((SELECT count(*)=1 FROM public.export_collection_register_v1()
  WHERE remittance_item_id=:'phase_b_item_id'),
  'AUDIT export must remain available while its internal exception view is closed');
RESET ROLE;

SELECT poc_test.assert((SELECT count(*)=1 FROM public.collection_bank_line_allocations
  WHERE remittance_item_id=:'phase_b_item_id'),
  'idempotent v2 confirmation replay must not duplicate an allocation');
SELECT poc_test.assert((SELECT reference_signal='REFERENCE_TOKEN_EXACT'
  AND candidate_reason_codes @> ARRAY['EXACT_AMOUNT','REFERENCE_TOKEN_EXACT']::text[]
  FROM public.collection_match_proposals WHERE id=:'phase_b_proposal_proposal_id'),
  'server-computed reference and reason evidence must be persisted');

SELECT 'PHASE_B_SAFE_READ_PASS' AS result;
