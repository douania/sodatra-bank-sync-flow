\set ON_ERROR_STOP on

-- Native manual work remains allowed after cutover; only the legacy LOAD path closes.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('invalidate-create',
 jsonb_build_object('client_name','PROPOSAL INVALIDATION','receipt_method','CASH','expected_amount',100,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',100,
  'deposit_date','2026-08-03','capture_mode','MANUAL','remittance_kind','LOGICAL_CASH')) x) s \gset inv_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('invalidate-add',:'inv_remittance_id',:'inv_receipt_id',
 jsonb_build_object('item_amount',100,'currency','XOF')) x) s \gset inv_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('invalidate-validate',:'inv_remittance_id','validate invalidation case'); RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT (public.propose_collection_match_v1('invalidate-propose','CREATE',NULL,jsonb_build_object(
 'credit_daily_line_id','30000000-0000-0000-0000-000000000015','proposed_credit_consumed_amount',100,
 'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','proposal before Daily supersession',
 'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',:'inv_item_id'::uuid,
  'credit_line_consumed_amount',100,'settled_gross_amount',100,'observed_fee_amount',0))))->>'proposal_id') proposal_id \gset inv_
RESET ROLE;

UPDATE public.daily_statement_lines_canonical SET is_active=false WHERE id='30000000-0000-0000-0000-000000000015';
SELECT poc_test.assert(EXISTS(SELECT 1 FROM public.collection_exception_status_v
 WHERE subject_id=:'inv_proposal_id' AND exception_code='PROPOSAL_EVIDENCE_INACTIVE'),
 'inactive Daily line must invalidate a proposal effectively before persistence');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT poc_test.assert((public.confirm_collection_match_v1('invalidate-confirm',:'inv_proposal_id','CONFIRM','Daily line superseded')->>'outcome')='invalidated',
 'next proposal interaction must persist invalidation instead of confirming');
SELECT poc_test.assert((SELECT status='INVALIDATED' FROM public.collection_match_proposals WHERE id=:'inv_proposal_id'),
 'invalidated proposal status must persist');
SELECT poc_test.assert((SELECT status='SUBMITTED' FROM public.collection_bank_remittance_items WHERE id=:'inv_item_id'),
 'invalidated proposal must release the item reservation');
RESET ROLE;

-- Legacy Excel LOAD is fail-closed after SYSTEM_OF_RECORD_CUTOVER.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.import_collection_receipts_v1('load-after-cutover','LOAD',jsonb_build_object(
      'file_sha256',repeat('e',64),'rows',jsonb_build_array(jsonb_build_object(
       'excel_filename','FORBIDDEN_AFTER_CUTOVER.xlsx','excel_source_row',1,'source_row_hash',repeat('f',64),
       'client_name','FORBIDDEN','receipt_method','CASH','expected_amount',1,'currency','XOF',
       'source_report_date','2026-07-01','deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_date','2026-07-01'))));
    RAISE EXCEPTION 'TEST_FAILED: legacy LOAD succeeded after cutover';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_LEGACY_LOAD_CLOSED_AFTER_CUTOVER%' THEN RAISE; END IF;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM public.create_collection_remittance_v1('exact-create',
      jsonb_build_object('client_name','ALTERED PAYLOAD','receipt_method','CHECK','expected_amount',1000,'currency','XOF'),
      jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF',
        'declared_total_amount',1000,'deposit_date','2026-08-01','slip_reference','SLIP-001','capture_mode','MANUAL','remittance_kind','PHYSICAL'));
    RAISE EXCEPTION 'TEST_FAILED: idempotency key accepted altered payload';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_IDEMPOTENCY_PAYLOAD_MISMATCH%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- ENTRY alone never grants matching powers.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.propose_collection_match_v1('missing-capability','CREATE',NULL,'{}'::jsonb);
    RAISE EXCEPTION 'TEST_FAILED: ENTRY actor proposed a match';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_CAPABILITY_REQUIRED:PROPOSE_MATCH%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

SELECT poc_test.assert(
  NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (p.proname ILIKE '%payment%' OR p.proname ILIKE '%accounting_post%')),
  'Core must expose no payment or accounting posting function');
SELECT poc_test.assert(
  NOT EXISTS(SELECT 1 FROM information_schema.parameters
    WHERE specific_schema='public' AND specific_name LIKE 'export_collection_register_v1%'
      AND parameter_name IN ('description_sanitized','raw_label','raw_text')),
  'read-only register export must not expose raw bank labels');
SELECT poc_test.assert(
  (SELECT count(*)=15 FROM public.collection_domain_assignments WHERE is_active),
  'nominal capability matrix must remain explicit and complete in the replay');

SELECT 'POST_NEGATIVE_PASS' AS result;
