\set ON_ERROR_STOP on

-- --------------------------------------------------------------------------
-- Synthetic accounts and Daily v2 evidence. No real bank data.
-- --------------------------------------------------------------------------
INSERT INTO public.daily_statement_account_registry(id,created_by,bank,currency,safe_alias,account_fingerprint,status) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','BANK_A','XOF','A-XOF','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','active'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','BANK_B','XOF','B-XOF','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','active'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','BANK_A','XOF','A2-XOF','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','active');

INSERT INTO public.daily_statement_units_canonical(id,bank,account_fingerprint,currency,accounting_date,status,account_registry_id) VALUES
 ('20000000-0000-0000-0000-000000000001','BANK_A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','XOF','2026-08-01','ingested','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','BANK_B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','XOF','2026-08-01','ingested','10000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003','BANK_A','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','XOF','2026-08-01','ingested','10000000-0000-0000-0000-000000000003');

INSERT INTO public.daily_statement_lines_canonical(id,canonical_unit_id,daily_line_hash,is_active,accounting_date,
 description_sanitized,debit_amount,credit_amount,signed_amount,direction,currency) VALUES
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','line-a-exact',true,'2026-08-01','CREDIT CHECK CK-001',NULL,1000,1000,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','line-b-wrong',true,'2026-08-01','CREDIT CHECK CK-001',NULL,1000,1000,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','line-a-net',true,'2026-08-01','NET EFFECT EF-002',NULL,950,950,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','line-a-fee50',true,'2026-08-01','DISCOUNT FEE',50,NULL,-50,'debit','XOF'),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','line-old-rebind',true,'2026-08-01','CREDIT EFFECT EF-003',NULL,500,500,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001','line-new-rebind',true,'2026-08-02','CREDIT EFFECT EF-003',NULL,500,500,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000001','line-a-separate',true,'2026-08-01','GROSS EFFECT EF-004',NULL,1000,1000,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000001','line-a-fee30',true,'2026-08-01','FEE PART 1',30,NULL,-30,'debit','XOF'),
 ('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000001','line-a-fee20',true,'2026-08-01','FEE PART 2',20,NULL,-20,'debit','XOF'),
 ('30000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001','line-concurrency',true,'2026-08-01','AGGREGATED CREDIT',NULL,1000,1000,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001','line-after-withdraw-a',true,current_date+1,'CREDIT CHECK RT-001',NULL,700,700,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000002','line-rerouted-b',true,'2026-08-01','CREDIT CHECK RT-001',NULL,700,700,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000013','20000000-0000-0000-0000-000000000001','line-a-cross-fee',true,'2026-08-01','GROSS EFFECT EF-005',NULL,1000,1000,'credit','XOF'),
 ('30000000-0000-0000-0000-000000000014','20000000-0000-0000-0000-000000000003','line-a2-fee',true,'2026-08-01','CROSS ACCOUNT FEE',50,NULL,-50,'debit','XOF'),
 ('30000000-0000-0000-0000-000000000015','20000000-0000-0000-0000-000000000001','line-proposal-invalidate',true,'2026-08-01','CREDIT TO SUPERSEDE',NULL,100,100,'credit','XOF');

-- Bootstrap nominal capabilities through the admin-only access RPC.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.grant_collection_capability_v1('cap-entry','00000000-0000-0000-0000-000000000002','ENTRY',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-withdraw-2','00000000-0000-0000-0000-000000000002','WITHDRAW_REMITTANCE',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-import-2','00000000-0000-0000-0000-000000000002','IMPORT_COLLECTIONS',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-cutover-2','00000000-0000-0000-0000-000000000002','ACTIVATE_CUTOVER',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-validate','00000000-0000-0000-0000-000000000003','VALIDATE_REMITTANCE',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-confirm','00000000-0000-0000-0000-000000000003','CONFIRM_MATCH',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-withdraw-3','00000000-0000-0000-0000-000000000003','WITHDRAW_REMITTANCE',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-cancel','00000000-0000-0000-0000-000000000003','CANCEL_REMITTANCE',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-duplicate','00000000-0000-0000-0000-000000000003','RESOLVE_DUPLICATE',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-import-3','00000000-0000-0000-0000-000000000003','IMPORT_COLLECTIONS',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-cutover-3','00000000-0000-0000-0000-000000000003','ACTIVATE_CUTOVER',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-propose','00000000-0000-0000-0000-000000000004','PROPOSE_MATCH',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-rebind','00000000-0000-0000-0000-000000000004','CORRECT_EVIDENCE',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-audit','00000000-0000-0000-0000-000000000004','AUDIT',true,'synthetic grant');
SELECT public.grant_collection_capability_v1('cap-correct','00000000-0000-0000-0000-000000000004','CORRECT_CAPTURE',true,'synthetic grant');
RESET ROLE;

-- --------------------------------------------------------------------------
-- Exact credit, Bank A/B refusal, partial then full settlement and idempotency
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (
 SELECT public.create_collection_remittance_v1('exact-create',
  jsonb_build_object('client_name','CLIENT SYNTHETIC 1','receipt_method','CHECK','expected_amount',1000,'currency','XOF','client_bank','DRAWN A'),
  jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',1000,
    'deposit_date','2026-08-01','slip_reference','SLIP-001','capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset exact_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('exact-add',:'exact_remittance_id',:'exact_receipt_id',
 jsonb_build_object('item_amount',1000,'currency','XOF','instrument',jsonb_build_object(
   'instrument_type','CHECK','identity_namespace','CHECK:BANK_A','normalized_identity_hash',repeat('1',64),
   'identity_strength','STRONG_VERIFIED','instrument_reference','CK-001','drawn_bank','DRAWN A','client_name','CLIENT SYNTHETIC 1',
   'nominal_amount',1000,'currency','XOF'))) x) s \gset exact_
SELECT poc_test.assert((public.create_collection_remittance_v1('exact-create',
  jsonb_build_object('client_name','CLIENT SYNTHETIC 1','receipt_method','CHECK','expected_amount',1000,'currency','XOF','client_bank','DRAWN A'),
  jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',1000,
    'deposit_date','2026-08-01','slip_reference','SLIP-001','capture_mode','MANUAL','remittance_kind','PHYSICAL'))->>'receipt_id')::uuid=:'exact_receipt_id'::uuid,
  'identical command replay must return the original receipt');
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('exact-validate',:'exact_remittance_id','synthetic independent validation');
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
DO $$
DECLARE v_item_id uuid;
BEGIN
  SELECT i.id INTO v_item_id FROM public.collection_bank_remittance_items i
    JOIN public.collection_instruments x ON x.id=i.instrument_id WHERE x.instrument_reference='CK-001';
  BEGIN
    PERFORM public.propose_collection_match_v1('wrong-bank','CREATE',NULL,jsonb_build_object(
      'credit_daily_line_id','30000000-0000-0000-0000-000000000002','proposed_credit_consumed_amount',400,
      'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','wrong bank test',
      'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object(
        'remittance_item_id',v_item_id,'credit_line_consumed_amount',400,'settled_gross_amount',400,'observed_fee_amount',0))));
    RAISE EXCEPTION 'TEST_FAILED: Bank B evidence accepted for Bank A remittance';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_ITEM_CREDIT_ACCOUNT_OR_STATE_INVALID%' THEN RAISE; END IF;
  END;
END $$;
SELECT (public.propose_collection_match_v1('exact-propose-400','CREATE',NULL,jsonb_build_object(
  'credit_daily_line_id','30000000-0000-0000-0000-000000000001','proposed_credit_consumed_amount',400,
  'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','partial exact credit',
  'reference_source_daily_line_id','30000000-0000-0000-0000-000000000001','extracted_reference','CK-001',
  'normalized_reference','CK001','reference_confidence',1,'fee_evidence_plan',jsonb_build_array(),
  'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',:'exact_item_id'::uuid,
    'credit_line_consumed_amount',400,'settled_gross_amount',400,'observed_fee_amount',0))))->>'proposal_id') proposal_id \gset exact_p1_
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.confirm_collection_match_v1('exact-confirm-400',:'exact_p1_proposal_id','CONFIRM','independent confirmation');
SELECT poc_test.assert((SELECT status='PARTIALLY_CREDITED' FROM public.collection_bank_remittance_items WHERE id=:'exact_item_id'),
  'first exact allocation must leave item partial');
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT (public.propose_collection_match_v1('exact-propose-600','CREATE',NULL,jsonb_build_object(
  'credit_daily_line_id','30000000-0000-0000-0000-000000000001','proposed_credit_consumed_amount',600,
  'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','remaining exact credit',
  'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object(
    'remittance_item_id',:'exact_item_id'::uuid,'credit_line_consumed_amount',600,'settled_gross_amount',600,'observed_fee_amount',0))))->>'proposal_id') proposal_id \gset exact_p2_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.confirm_collection_match_v1('exact-confirm-600',:'exact_p2_proposal_id','CONFIRM','independent final confirmation');
SELECT public.confirm_collection_match_v1('exact-confirm-600',:'exact_p2_proposal_id','CONFIRM','independent final confirmation');
SELECT poc_test.assert((SELECT status='CREDITED' FROM public.collection_bank_remittance_items WHERE id=:'exact_item_id'),
  'second exact allocation must fully credit item');
SELECT poc_test.assert((SELECT status='MATCHED' FROM public.collection_receipts WHERE id=:'exact_receipt_id'),
  'receipt must be matched by gross settled amount');
SELECT poc_test.assert((SELECT count(*)=2 FROM public.collection_bank_line_allocations WHERE remittance_item_id=:'exact_item_id'),
  'idempotent confirmation replay must not duplicate allocations');
RESET ROLE;

-- --------------------------------------------------------------------------
-- Net discount: gross matched, net liquidity and observed fees remain distinct
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('net-create',
 jsonb_build_object('client_name','CLIENT SYNTHETIC 2','receipt_method','EFFECT','expected_amount',1000,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',1000,
  'deposit_date','2026-08-01','capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset net_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('net-add',:'net_remittance_id',:'net_receipt_id',
 jsonb_build_object('item_amount',1000,'currency','XOF','instrument',jsonb_build_object('instrument_type','EFFECT',
  'identity_namespace','EFFECT:BANK_A','normalized_identity_hash',repeat('2',64),'identity_strength','STRONG_VERIFIED',
  'instrument_reference','EF-002','nominal_amount',1000,'currency','XOF','maturity_date','2026-09-01'))) x) s \gset net_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('net-validate',:'net_remittance_id','validate discount item'); RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT (public.propose_collection_match_v1('net-propose','CREATE',NULL,jsonb_build_object(
 'credit_daily_line_id','30000000-0000-0000-0000-000000000003','proposed_credit_consumed_amount',950,
 'proposed_fee_consumed_amount',0,'evidence_basis','NET_OF_DISCOUNT','allocation_mode','SINGLE_ITEM','reason','net discount evidence',
 'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',:'net_item_id'::uuid,
  'credit_line_consumed_amount',950,'settled_gross_amount',1000,'observed_fee_amount',50))))->>'proposal_id') proposal_id \gset net_p_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.confirm_collection_match_v1('net-confirm',:'net_p_proposal_id','CONFIRM','confirm net discount');
SELECT poc_test.assert((SELECT settled_gross_amount=1000 AND credit_line_consumed_amount=950 AND observed_fee_amount=50
  AND net_liquidity_amount=950 FROM public.collection_bank_line_allocations WHERE remittance_item_id=:'net_item_id'),
  'net discount measures must remain separate');
SELECT poc_test.assert((SELECT status='MATCHED' FROM public.collection_receipts WHERE id=:'net_receipt_id'),
  'net discount can match the receipt by gross amount');
RESET ROLE;

-- --------------------------------------------------------------------------
-- Fees separate: two debit lines materialize two relational fee evidences
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('sep-create',
 jsonb_build_object('client_name','CLIENT SYNTHETIC 3','receipt_method','EFFECT','expected_amount',1000,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',1000,
  'deposit_date','2026-08-01','capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset sep_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('sep-add',:'sep_remittance_id',:'sep_receipt_id',
 jsonb_build_object('item_amount',1000,'currency','XOF','instrument',jsonb_build_object('instrument_type','EFFECT',
  'identity_namespace','EFFECT:BANK_A','normalized_identity_hash',repeat('3',64),'identity_strength','STRONG_VERIFIED',
  'instrument_reference','EF-004','nominal_amount',1000,'currency','XOF'))) x) s \gset sep_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('sep-validate',:'sep_remittance_id','validate separate fee'); RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT (public.propose_collection_match_v1('sep-propose','CREATE',NULL,jsonb_build_object(
 'credit_daily_line_id','30000000-0000-0000-0000-000000000007','proposed_credit_consumed_amount',1000,
 'proposed_fee_consumed_amount',50,'evidence_basis','FEES_SEPARATE','allocation_mode','SINGLE_ITEM','reason','two fee lines',
 'fee_evidence_plan',jsonb_build_array(
  jsonb_build_object('daily_line_id','30000000-0000-0000-0000-000000000008','fee_line_consumed_amount',30),
  jsonb_build_object('daily_line_id','30000000-0000-0000-0000-000000000009','fee_line_consumed_amount',20)),
 'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',:'sep_item_id'::uuid,
  'credit_line_consumed_amount',1000,'settled_gross_amount',1000,'observed_fee_amount',50))))->>'proposal_id') proposal_id \gset sep_p_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.confirm_collection_match_v1('sep-confirm',:'sep_p_proposal_id','CONFIRM','confirm separate fees');
SELECT poc_test.assert((SELECT count(*)=2 AND sum(fee_line_consumed_amount)=50 FROM public.collection_bank_line_allocations
  WHERE proposal_id=:'sep_p_proposal_id' AND allocation_type='FEE_EVIDENCE'),
  'multiple fee debit lines must be materialized relationally');
SELECT poc_test.assert((SELECT net_liquidity_amount=950 FROM public.collection_bank_line_allocations
  WHERE proposal_id=:'sep_p_proposal_id' AND allocation_type='CREDIT_ALLOCATION'),
  'separate fees must reduce net liquidity without reducing gross settlement');
RESET ROLE;

-- Cross-account fee is allowed only inside the same legal bank/currency and is
-- explicitly visible to the second actor.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('cross-create',
 jsonb_build_object('client_name','CLIENT SYNTHETIC 4','receipt_method','EFFECT','expected_amount',1000,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',1000,
  'deposit_date','2026-08-01','capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset cross_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('cross-add',:'cross_remittance_id',:'cross_receipt_id',
 jsonb_build_object('item_amount',1000,'currency','XOF','instrument',jsonb_build_object('instrument_type','EFFECT',
  'identity_namespace','EFFECT:BANK_A','normalized_identity_hash',repeat('4',64),'identity_strength','STRONG_VERIFIED',
  'instrument_reference','EF-005','nominal_amount',1000,'currency','XOF'))) x) s \gset cross_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('cross-validate',:'cross_remittance_id','validate cross-account fee'); RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT (public.propose_collection_match_v1('cross-propose','CREATE',NULL,jsonb_build_object(
 'credit_daily_line_id','30000000-0000-0000-0000-000000000013','proposed_credit_consumed_amount',1000,
 'proposed_fee_consumed_amount',50,'evidence_basis','FEES_SEPARATE','allocation_mode','SINGLE_ITEM','reason','same-bank fee account',
 'cross_account_fee',true,'cross_account_fee_reason','fee debit appears on second synthetic account of same bank',
 'fee_evidence_plan',jsonb_build_array(jsonb_build_object('daily_line_id','30000000-0000-0000-0000-000000000014','fee_line_consumed_amount',50)),
 'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',:'cross_item_id'::uuid,
  'credit_line_consumed_amount',1000,'settled_gross_amount',1000,'observed_fee_amount',50))))->>'proposal_id') proposal_id \gset cross_p_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.confirm_collection_match_v1('cross-confirm',:'cross_p_proposal_id','CONFIRM','second actor sees cross-account reason');
SELECT poc_test.assert((SELECT cross_account_fee AND cross_account_fee_reason IS NOT NULL FROM public.collection_match_proposals
  WHERE id=:'cross_p_proposal_id'),'cross-account fee exception must be explicit and retained');
RESET ROLE;

-- --------------------------------------------------------------------------
-- Withdrawal from Bank A, rerouting to Bank B, and preservation of both tries
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('route-create',
 jsonb_build_object('client_name','CLIENT SYNTHETIC ROUTE','receipt_method','CHECK','expected_amount',700,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',700,
  'deposit_date','2026-08-01','capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset route_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('route-add',:'route_remittance_id',:'route_receipt_id',
 jsonb_build_object('item_amount',700,'currency','XOF','instrument',jsonb_build_object('instrument_type','CHECK',
  'identity_namespace','CHECK:ROUTE','normalized_identity_hash',repeat('5',64),'identity_strength','STRONG_VERIFIED',
  'instrument_reference','RT-001','nominal_amount',700,'currency','XOF'))) x) s \gset route_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('route-validate',:'route_remittance_id','validate first bank'); RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT public.request_collection_remittance_withdrawal_v1('route-request',:'route_item_id','withdraw from Bank A'); RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.confirm_collection_remittance_withdrawal_v1('route-accept',:'route_item_id','ACCEPT','SYNTHETIC-WITHDRAWAL-PROOF','bank confirms withdrawal');
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'remittance_id') remittance_id,(x->>'item_id') item_id FROM (SELECT public.resubmit_collection_remittance_item_v1(
 'route-resubmit',:'route_item_id','10000000-0000-0000-0000-000000000002','2026-08-02','SLIP-B-ROUTE','reroute to Bank B') x) s \gset route_new_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('route-new-validate',:'route_new_remittance_id','validate Bank B independently'); RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT (public.propose_collection_match_v1('route-b-propose','CREATE',NULL,jsonb_build_object(
 'credit_daily_line_id','30000000-0000-0000-0000-000000000012','proposed_credit_consumed_amount',700,
 'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','Bank B evidence after rerouting',
 'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',:'route_new_item_id'::uuid,
  'credit_line_consumed_amount',700,'settled_gross_amount',700,'observed_fee_amount',0))))->>'proposal_id') proposal_id \gset route_p_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.confirm_collection_match_v1('route-b-confirm',:'route_p_proposal_id','CONFIRM','confirm rerouted evidence');
SELECT poc_test.assert((SELECT count(*)=2 FROM public.collection_bank_remittance_items WHERE receipt_id=:'route_receipt_id'),
  'rerouting must preserve both item attempts');
SELECT poc_test.assert((SELECT status='WITHDRAWN' FROM public.collection_bank_remittance_items WHERE id=:'route_item_id'),
  'old Bank A item must stay withdrawn');
SELECT poc_test.assert((SELECT status='CREDITED' FROM public.collection_bank_remittance_items WHERE id=:'route_new_item_id'),
  'new Bank B item must carry the credit');
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
SELECT poc_test.assert(EXISTS(SELECT 1 FROM public.collection_exception_status_v
  WHERE subject_id=:'route_item_id' AND exception_code='UNEXPECTED_CREDIT_AFTER_WITHDRAWAL'),
  'Bank A credit after withdrawal must be projected as an exception');

-- --------------------------------------------------------------------------
-- Probabilistic duplicate review blocks validation until a motivated decision
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('dup1-create',
 jsonb_build_object('client_name','CLIENT DUP 1','receipt_method','CHECK','expected_amount',10,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',10,
  'deposit_date','2026-08-01','capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset dup1_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('dup1-add',:'dup1_remittance_id',:'dup1_receipt_id',
 jsonb_build_object('item_amount',10,'currency','XOF','instrument',jsonb_build_object('instrument_type','CHECK',
  'identity_namespace','CHECK:PROB','normalized_identity_hash',repeat('6',64),'identity_strength','PROBABILISTIC',
  'instrument_reference','PROB-1','nominal_amount',10,'currency','XOF'))) x) s \gset dup1_
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('dup2-create',
 jsonb_build_object('client_name','CLIENT DUP 2','receipt_method','CHECK','expected_amount',10,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',10,
  'deposit_date','2026-08-01','capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset dup2_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('dup2-add',:'dup2_remittance_id',:'dup2_receipt_id',
 jsonb_build_object('item_amount',10,'currency','XOF','instrument',jsonb_build_object('instrument_type','CHECK',
  'identity_namespace','CHECK:PROB','normalized_identity_hash',repeat('6',64),'identity_strength','PROBABILISTIC',
  'instrument_reference','PROB-2','nominal_amount',10,'currency','XOF'))) x) s \gset dup2_
RESET ROLE;
SELECT poc_test.assert((SELECT duplicate_review_status='OPEN' FROM public.collection_receipts WHERE id=:'dup2_receipt_id'),
  'second probabilistic identity must open duplicate review');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.resolve_collection_duplicate_v1('dup2-resolve',:'dup2_receipt_id','DISTINCT_KEEP',NULL,'synthetic evidence shows distinct instruments');
SELECT public.validate_collection_remittance_v1('dup2-validate',:'dup2_remittance_id','validate after duplicate decision');
SELECT poc_test.assert((SELECT duplicate_review_status='RESOLVED' FROM public.collection_receipts WHERE id=:'dup2_receipt_id'),
  'motivated duplicate decision must close review');
RESET ROLE;

-- --------------------------------------------------------------------------
-- Scan stays unvalidated until correction records explicit human confirmation
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('scan-create',
 jsonb_build_object('client_name','CLIENT SCAN','receipt_method','CASH','expected_amount',20,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',20,
  'deposit_date','2026-08-01','capture_mode','SCAN','remittance_kind','LOGICAL_CASH','source_document_ref','DOC-SYNTHETIC')) x) s \gset scan_
SELECT public.add_collection_remittance_item_v1('scan-add',:'scan_remittance_id',:'scan_receipt_id',
 jsonb_build_object('item_amount',20,'currency','XOF'));
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT public.correct_collection_capture_v1('scan-human','REMITTANCE',:'scan_remittance_id',
 jsonb_build_object('capture_control_status','HUMAN_CONFIRMED'),'human checked synthetic scan'); RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('scan-validate',:'scan_remittance_id','validate checked scan'); RESET ROLE;

-- Draft cancellation produces the explicit all-cancelled header projection.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('cancel-create',
 jsonb_build_object('client_name','CLIENT CANCEL','receipt_method','CASH','expected_amount',30,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',30,
  'deposit_date','2026-08-01','capture_mode','MANUAL','remittance_kind','LOGICAL_CASH')) x) s \gset cancel_
SELECT public.add_collection_remittance_item_v1('cancel-add',:'cancel_remittance_id',:'cancel_receipt_id',jsonb_build_object('item_amount',30,'currency','XOF'));
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.cancel_collection_remittance_v1('cancel-draft',:'cancel_remittance_id','DRAFT_CANCEL',NULL,'cancel synthetic draft');
SELECT poc_test.assert((SELECT status='CANCELLED' FROM public.collection_bank_remittances WHERE id=:'cancel_remittance_id'),
  'all-cancelled header must project CANCELLED'); RESET ROLE;

-- --------------------------------------------------------------------------
-- Daily v2 supersession: old proof stays consuming until explicit rebind
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('rebind-create',
 jsonb_build_object('client_name','CLIENT REBIND','receipt_method','EFFECT','expected_amount',500,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',500,
  'deposit_date','2026-08-01','capture_mode','MANUAL','remittance_kind','PHYSICAL')) x) s \gset rebind_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('rebind-add',:'rebind_remittance_id',:'rebind_receipt_id',
 jsonb_build_object('item_amount',500,'currency','XOF','instrument',jsonb_build_object('instrument_type','EFFECT',
  'identity_namespace','EFFECT:REBIND','normalized_identity_hash',repeat('7',64),'identity_strength','STRONG_VERIFIED',
  'instrument_reference','EF-003','nominal_amount',500,'currency','XOF'))) x) s \gset rebind_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('rebind-validate',:'rebind_remittance_id','validate rebind case'); RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT (public.propose_collection_match_v1('rebind-propose','CREATE',NULL,jsonb_build_object(
 'credit_daily_line_id','30000000-0000-0000-0000-000000000005','proposed_credit_consumed_amount',500,
 'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','old Daily proof',
 'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object('remittance_item_id',:'rebind_item_id'::uuid,
  'credit_line_consumed_amount',500,'settled_gross_amount',500,'observed_fee_amount',0))))->>'proposal_id') proposal_id \gset rebind_p_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.confirm_collection_match_v1('rebind-confirm',:'rebind_p_proposal_id','CONFIRM','confirm old proof');
SELECT id allocation_id FROM public.collection_bank_line_allocations WHERE proposal_id=:'rebind_p_proposal_id' AND allocation_type='CREDIT_ALLOCATION' \gset rebind_
RESET ROLE;

UPDATE public.daily_statement_lines_canonical SET is_active=false WHERE id='30000000-0000-0000-0000-000000000005';
UPDATE public.collection_bank_line_allocations SET allocation_status='EXCEPTION'
 WHERE id=:'rebind_allocation_id' AND EXISTS(SELECT 1 FROM public.daily_statement_lines_canonical WHERE id=daily_line_id AND NOT is_active);
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
SELECT poc_test.assert(EXISTS(SELECT 1 FROM public.collection_exception_status_v
  WHERE subject_id=:'rebind_allocation_id' AND exception_code='CONFIRMED_EVIDENCE_INACTIVE'),
  'superseded Daily proof must be visible as exception');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT (public.rebind_collection_superseded_evidence_v1('rebind-evidence',:'rebind_allocation_id',
 '30000000-0000-0000-0000-000000000006','explicit synthetic rebind')->>'allocation_id') allocation_id \gset rebind_new_
SELECT poc_test.assert((SELECT allocation_status='SUPERSEDED' FROM public.collection_bank_line_allocations WHERE id=:'rebind_allocation_id'),
  'old allocation must be superseded, not rewritten');
SELECT poc_test.assert((SELECT allocation_status='CONFIRMED' AND supersedes_allocation_id=:'rebind_allocation_id'
  FROM public.collection_bank_line_allocations WHERE id=:'rebind_new_allocation_id'),
  'new evidence allocation must reference its predecessor');
RESET ROLE;

-- --------------------------------------------------------------------------
-- Import idempotency, request/cancel, replacement request and final cutover
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'load_id') load_id FROM (SELECT public.import_collection_receipts_v1('load-1','LOAD',jsonb_build_object(
 'file_sha256',repeat('a',64),'rows',jsonb_build_array(jsonb_build_object(
  'excel_filename','SYNTHETIC_COLLECTION.xlsx','excel_source_row',1,'source_row_hash',repeat('b',64),
  'unique_excel_traceability',NULL,'client_name','CLIENT IMPORT 1','receipt_method','CASH','expected_amount',100,'currency','XOF',
  'source_report_date','2026-07-01','deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_date','2026-07-01')))) x) s \gset load1_
SELECT (x->>'load_id') load_id,(x->>'accepted_count')::int accepted_count,(x->>'idempotent_count')::int idempotent_count
FROM (SELECT public.import_collection_receipts_v1('load-1-repeat-new-key','LOAD',jsonb_build_object(
 'file_sha256',repeat('a',64),'rows',jsonb_build_array(jsonb_build_object(
  'excel_filename','SYNTHETIC_COLLECTION.xlsx','excel_source_row',1,'source_row_hash',repeat('b',64),
  'unique_excel_traceability',NULL,'client_name','CLIENT IMPORT 1','receipt_method','CASH','expected_amount',100,'currency','XOF',
  'source_report_date','2026-07-01','deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_date','2026-07-01')))) x) s \gset load1b_
SELECT poc_test.assert(:'load1b_accepted_count'::int=0 AND :'load1b_idempotent_count'::int=1,
  'same source pair and hash must not add a second receipt');
SELECT (public.import_collection_receipts_v1('cutover-request-1','REQUEST_CUTOVER',jsonb_build_object(
 'report_validated',true,'cutover_business_date','2026-08-01','final_file_sha256',repeat('a',64),
 'last_load_id',:'load1b_load_id'::uuid,'report_reference','SYNTHETIC-REPORT-1'))->>'request_id') request_id \gset cut1_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.import_collection_receipts_v1('cutover-cancel-1','CANCEL_CUTOVER_REQUEST',jsonb_build_object(
 'request_id',:'cut1_request_id'::uuid,'reason','replace final synthetic file'));
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'load_id') load_id FROM (SELECT public.import_collection_receipts_v1('load-2','LOAD',jsonb_build_object(
 'file_sha256',repeat('c',64),'rows',jsonb_build_array(jsonb_build_object(
  'excel_filename','SYNTHETIC_COLLECTION.xlsx','excel_source_row',2,'source_row_hash',repeat('d',64),
  'unique_excel_traceability','SYNTHETIC-TRACE-2','client_name','CLIENT IMPORT 2','receipt_method','TRANSFER','expected_amount',200,'currency','XOF',
  'source_report_date','2026-07-02','deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_date','2026-07-02')))) x) s \gset load2_
SELECT (public.import_collection_receipts_v1('cutover-request-2','REQUEST_CUTOVER',jsonb_build_object(
 'report_validated',true,'cutover_business_date','2026-08-01','final_file_sha256',repeat('c',64),
 'last_load_id',:'load2_load_id'::uuid,'report_reference','SYNTHETIC-REPORT-2'))->>'request_id') request_id \gset cut2_
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.import_collection_receipts_v1('cutover-confirm-2','CONFIRM_CUTOVER',jsonb_build_object(
 'request_id',:'cut2_request_id'::uuid,'cutover_business_date','2026-08-01','final_file_sha256',repeat('c',64),
 'reason','independent synthetic cutover confirmation'));
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT poc_test.assert((SELECT count(*)=1 FROM public.collection_events WHERE event_type='SYSTEM_OF_RECORD_CUTOVER'),
  'only one final system-of-record cutover may exist');
RESET ROLE;

-- --------------------------------------------------------------------------
-- Export contract, exception routing, event audit and header edge projections
-- --------------------------------------------------------------------------
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004'; SET ROLE authenticated;
SELECT poc_test.assert(EXISTS(SELECT 1 FROM public.export_collection_register_v1()
  WHERE remittance_item_id=:'net_item_id' AND proof_class='DISCOUNT_CREDITED'
    AND settled_gross_amount=1000 AND credit_consumed_amount=950 AND observed_fee_amount=50),
  'versioned export must preserve the net-discount evidence class and measures');
SELECT poc_test.assert(NOT EXISTS(SELECT 1 FROM public.export_collection_register_v1()
  WHERE export_contract_version<>'COLLECTION_REGISTER_V1'),'export contract version must be stable');
RESET ROLE;

SELECT poc_test.assert(NOT EXISTS(SELECT 1 FROM public.collection_exception_status_v e
  JOIN public.collection_receipts r ON r.id=e.subject_id
  WHERE e.subject_type='RECEIPT' AND r.legacy_classification='LEGACY_PENDING_0Z1C' AND e.exception_code='UNMATCHED'),
  'legacy PROROGATION rows must be excluded from daily unmatched alerts');
SELECT poc_test.assert((SELECT count(*)>0 FROM public.collection_events WHERE event_type='CAPTURE_CORRECTED' AND reason IS NOT NULL),
  'bounded corrections must leave a justified event');
SELECT poc_test.assert((SELECT count(*)>0 FROM public.collection_events WHERE event_type='DUPLICATE_RESOLVED' AND reason IS NOT NULL),
  'duplicate decisions must leave a justified event');

-- Empty header is DRAFT by construction.
INSERT INTO public.collection_bank_remittances(id,created_by,deposit_account_id,deposit_currency,declared_total_amount,
 deposit_date,remittance_kind,capture_mode,capture_control_status)
VALUES('90000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001','XOF',1,'2026-08-01','LOGICAL_CASH','MANUAL','HUMAN_CONFIRMED');
SELECT public.collection_recompute_remittance('90000000-0000-0000-0000-000000000001');
SELECT poc_test.assert((SELECT status='DRAFT' FROM public.collection_bank_remittances WHERE id='90000000-0000-0000-0000-000000000001'),
  'empty header projection must be DRAFT');

-- Mixed terminal states are intentionally an exception, never a vacuous credit.
INSERT INTO public.collection_receipts(id,created_by,client_name,receipt_method,expected_amount,currency) VALUES
 ('91000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','MIX 1','CASH',1,'XOF'),
 ('91000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','MIX 2','CASH',1,'XOF');
INSERT INTO public.collection_bank_remittances(id,created_by,deposit_account_id,deposit_currency,declared_total_amount,
 deposit_date,remittance_kind,capture_mode,capture_control_status)
VALUES('90000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001','XOF',2,'2026-08-01','LOGICAL_CASH','MANUAL','HUMAN_CONFIRMED');
INSERT INTO public.collection_bank_remittance_items(created_by,remittance_id,receipt_id,item_amount,currency,status) VALUES
 ('00000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001',1,'XOF','WITHDRAWN'),
 ('00000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000002',1,'XOF','CANCELLED');
SELECT public.collection_recompute_remittance('90000000-0000-0000-0000-000000000002');
SELECT poc_test.assert((SELECT status='EXCEPTION' FROM public.collection_bank_remittances WHERE id='90000000-0000-0000-0000-000000000002'),
  'mixed withdrawn/cancelled terminal header must project EXCEPTION');

SELECT 'CORE_SCENARIOS_PASS' AS result;
