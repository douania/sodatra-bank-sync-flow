\set ON_ERROR_STOP on

-- --------------------------------------------------------------------------
-- P1: a partially credited item cannot be withdrawn, and a historically
-- inconsistent reroute cannot reserve more than the receipt remainder.
-- --------------------------------------------------------------------------
INSERT INTO public.daily_statement_lines_canonical(id,canonical_unit_id,daily_line_hash,is_active,accounting_date,
 description_sanitized,debit_amount,credit_amount,signed_amount,direction,currency) VALUES
 ('30000000-0000-0000-0000-000000000016','20000000-0000-0000-0000-000000000001','line-historical-partial',true,current_date-1,'CREDIT CHECK HIST-001',NULL,400,400,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000017','20000000-0000-0000-0000-000000000002','line-historical-reroute',true,current_date+1,'CREDIT CHECK HIST-001 BANK B',NULL,1000,1000,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000018','20000000-0000-0000-0000-000000000001','line-after-historical-withdrawal',true,current_date+1,'LATE CREDIT CHECK HIST-001',NULL,600,600,'credit','XOF');

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (
 SELECT public.create_collection_remittance_v1('p1-partial-create',
  jsonb_build_object('client_name','P1 PARTIAL WITHDRAWAL','receipt_method','CHECK','expected_amount',1000,'currency','XOF'),
  jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF',
    'declared_total_amount',1000,'deposit_date',current_date-2,'capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset p1_
SELECT (x->>'item_id') item_id FROM (
 SELECT public.add_collection_remittance_item_v1('p1-partial-add',:'p1_remittance_id',:'p1_receipt_id',
  jsonb_build_object('item_amount',1000,'currency','XOF','instrument',jsonb_build_object(
    'instrument_type','CHECK','identity_namespace','CHECK:P1','normalized_identity_hash',repeat('9',64),
    'identity_strength','STRONG_VERIFIED','instrument_reference','HIST-001','nominal_amount',1000,'currency','XOF'))) x) s \gset p1_
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('p1-partial-validate',:'p1_remittance_id','validate partial withdrawal guard');
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT (public.propose_collection_match_v1('p1-partial-propose','CREATE',NULL,jsonb_build_object(
 'credit_daily_line_id','30000000-0000-0000-0000-000000000016','proposed_credit_consumed_amount',400,
 'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','partial evidence before withdrawal attempt',
 'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object(
   'remittance_item_id',:'p1_item_id'::uuid,'credit_line_consumed_amount',400,'settled_gross_amount',400,'observed_fee_amount',0))))->>'proposal_id') proposal_id \gset p1_
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.confirm_collection_match_v1('p1-partial-confirm',:'p1_proposal_id','CONFIRM','confirm partial evidence');
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
DO $$
DECLARE v_item_id uuid;
BEGIN
  SELECT i.id INTO v_item_id FROM public.collection_bank_remittance_items i
  JOIN public.collection_instruments x ON x.id=i.instrument_id
  WHERE x.instrument_reference='HIST-001' AND i.status='PARTIALLY_CREDITED';
  BEGIN
    PERFORM public.request_collection_remittance_withdrawal_v1('p1-partial-withdraw-blocked',v_item_id,'must be refused after partial credit');
    RAISE EXCEPTION 'TEST_FAILED: partial item withdrawal unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_WITHDRAWAL_STATE_INVALID%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- Recreate the state found by the independent reviewer as a historical bad
-- state, then prove the new proposal-time receipt cap fails closed.
UPDATE public.collection_bank_remittance_items SET status='WITHDRAWN' WHERE id=:'p1_item_id';
INSERT INTO public.collection_events(actor_id,command_name,event_type,aggregate_type,aggregate_id,correlation_id,reason,amount,currency)
VALUES('00000000-0000-0000-0000-000000000003','synthetic_historical_state','WITHDRAWAL_CONFIRMED',
  'REMITTANCE_ITEM',:'p1_item_id',:'p1_remittance_id','synthetic independent-review reproduction',1000,'XOF');

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'remittance_id') remittance_id,(x->>'item_id') item_id FROM (
 SELECT public.resubmit_collection_remittance_item_v1('p1-historical-resubmit',:'p1_item_id',
  '10000000-0000-0000-0000-000000000002',current_date,'P1-HISTORICAL-REROUTE','synthetic historical reroute') x) s \gset p1_new_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('p1-historical-validate',:'p1_new_remittance_id','validate synthetic historical reroute');
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
DO $$
DECLARE v_item_id uuid;
BEGIN
  SELECT i.id INTO v_item_id FROM public.collection_bank_remittance_items i
  JOIN public.collection_instruments x ON x.id=i.instrument_id
  WHERE x.instrument_reference='HIST-001' AND i.status='SUBMITTED';
  BEGIN
    PERFORM public.propose_collection_match_v1('p1-receipt-cap-blocked','CREATE',NULL,jsonb_build_object(
      'credit_daily_line_id','30000000-0000-0000-0000-000000000017','proposed_credit_consumed_amount',1000,
      'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','must fail at proposal time',
      'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object(
        'remittance_item_id',v_item_id,'credit_line_consumed_amount',1000,'settled_gross_amount',1000,'observed_fee_amount',0))));
    RAISE EXCEPTION 'TEST_FAILED: receipt-level over-allocation proposal unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_RECEIPT_PLAN_OVERALLOCATION%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- --------------------------------------------------------------------------
-- P1: correcting a draft item instrument preserves method/amount/currency
-- invariants and reopens the motivated duplicate decision path.
-- --------------------------------------------------------------------------
SELECT x.id existing_check_instrument_id FROM public.collection_instruments x
 WHERE x.instrument_reference='PROB-1' \gset corr_check_

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (
 SELECT public.create_collection_remittance_v1('corr-instrument-create',
  jsonb_build_object('client_name','CORRECTION INSTRUMENT','receipt_method','CHECK','expected_amount',10,'currency','XOF'),
  jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF',
    'declared_total_amount',10,'deposit_date',current_date,'capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset corr_
SELECT (x->>'item_id') item_id FROM (
 SELECT public.add_collection_remittance_item_v1('corr-instrument-add',:'corr_remittance_id',:'corr_receipt_id',
  jsonb_build_object('item_amount',10,'currency','XOF','instrument',jsonb_build_object(
    'instrument_type','CHECK','identity_namespace','CHECK:CORRECTION','normalized_identity_hash',repeat('8',64),
    'identity_strength','STRONG_VERIFIED','instrument_reference','CORR-001','nominal_amount',10,'currency','XOF'))) x) s \gset corr_
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
DO $$
DECLARE v_item_id uuid; v_effect_id uuid;
BEGIN
  SELECT i.id INTO v_item_id FROM public.collection_bank_remittance_items i
  JOIN public.collection_instruments x ON x.id=i.instrument_id
  WHERE x.instrument_reference='CORR-001';
  SELECT id INTO v_effect_id FROM public.collection_instruments WHERE instrument_reference='EF-002';
  BEGIN
    PERFORM public.correct_collection_capture_v1('corr-instrument-null','REMITTANCE_ITEM',v_item_id,
      jsonb_build_object('instrument_id',NULL),'null instrument must be refused');
    RAISE EXCEPTION 'TEST_FAILED: CHECK item accepted a null instrument';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_INSTRUMENT_REQUIRED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.correct_collection_capture_v1('corr-instrument-type','REMITTANCE_ITEM',v_item_id,
      jsonb_build_object('instrument_id',v_effect_id),'wrong instrument type must be refused');
    RAISE EXCEPTION 'TEST_FAILED: CHECK item accepted an EFFECT instrument';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_INSTRUMENT_TYPE_MISMATCH%' THEN RAISE; END IF;
  END;
END $$;
SELECT public.correct_collection_capture_v1('corr-instrument-existing','REMITTANCE_ITEM',:'corr_item_id',
  jsonb_build_object('instrument_id',:'corr_check_existing_check_instrument_id'::uuid),
  'known instrument repeat presentation requires review');
SELECT poc_test.assert((SELECT duplicate_review_status='OPEN' AND duplicate_basis='CORRECTION_INSTRUMENT_REVIEW_REQUIRED'
  FROM public.collection_receipts WHERE id=:'corr_receipt_id'),
  'instrument identity correction must reopen duplicate review');
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
DO $$
DECLARE v_remittance_id uuid;
BEGIN
  SELECT b.id INTO v_remittance_id FROM public.collection_bank_remittances b
  JOIN public.collection_bank_remittance_items i ON i.remittance_id=b.id
  JOIN public.collection_receipts r ON r.id=i.receipt_id
  WHERE r.client_name='CORRECTION INSTRUMENT';
  BEGIN
    PERFORM public.validate_collection_remittance_v1('corr-validate-before-review',v_remittance_id,'must wait for duplicate review');
    RAISE EXCEPTION 'TEST_FAILED: validation bypassed reopened duplicate review';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_REMITTANCE_VALIDATION_INVARIANT_FAILED%' THEN RAISE; END IF;
  END;
END $$;
SELECT public.resolve_collection_duplicate_v1('corr-resolve-existing',:'corr_receipt_id','SAME_INSTRUMENT_LINK',
  :'corr_check_existing_check_instrument_id','verified repeat presentation of known cheque');
SELECT public.validate_collection_remittance_v1('corr-validate-after-review',:'corr_remittance_id','validate after motivated review');
RESET ROLE;

-- --------------------------------------------------------------------------
-- P2: audit journal and exception projection require AUDIT; capability rows
-- are visible only to their owner or an AUDIT/MANAGE_ACCESS actor.
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT poc_test.assert(NOT public.collection_current_actor_has_capability('AUDIT'),
  'ENTRY actor must not acquire AUDIT implicitly');
SELECT poc_test.assert((SELECT count(*)=0 FROM public.collection_events),
  'non-AUDIT actor must not read the audit journal');
SELECT poc_test.assert(NOT EXISTS(SELECT 1 FROM public.collection_domain_assignments WHERE user_id<>auth.uid()),
  'non-AUDIT actor must not read other actors capability assignments');
SELECT poc_test.assert((SELECT count(*)=0 FROM public.collection_exception_status_v),
  'non-AUDIT actor must not read the exception projection');
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT poc_test.assert(public.collection_current_actor_has_capability('AUDIT'),
  'AUDIT actor must retain its nominal capability');
SELECT poc_test.assert((SELECT count(*)>0 FROM public.collection_events),
  'AUDIT actor must read the audit journal');
SELECT poc_test.assert((SELECT count(*)>=15 FROM public.collection_domain_assignments),
  'AUDIT actor must read the capability register');
SELECT poc_test.assert(NOT EXISTS(SELECT 1 FROM public.collection_exception_status_v
  WHERE subject_id=:'p1_item_id' AND daily_line_id='30000000-0000-0000-0000-000000000016'
    AND exception_code='UNEXPECTED_CREDIT_AFTER_WITHDRAWAL'),
  'credit allocated before withdrawal must not become a false unexpected-credit alert');
SELECT poc_test.assert(EXISTS(SELECT 1 FROM public.collection_exception_status_v
  WHERE subject_id=:'p1_item_id' AND daily_line_id='30000000-0000-0000-0000-000000000018'
    AND exception_code='UNEXPECTED_CREDIT_AFTER_WITHDRAWAL'),
  'a genuinely later unallocated credit on the old account must remain blocking');
RESET ROLE;

SELECT 'COUNTER_REVIEW_REGRESSIONS_PASS' AS result;
