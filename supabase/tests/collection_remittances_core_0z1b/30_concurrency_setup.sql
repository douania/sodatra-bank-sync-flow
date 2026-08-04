\set ON_ERROR_STOP on

CREATE TABLE poc_test.collection_concurrency_ids(slot text PRIMARY KEY,item_id uuid NOT NULL);

CREATE OR REPLACE FUNCTION poc_test.propose_collection_match_with_hold(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,poc_test,pg_temp
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM 1 FROM public.daily_statement_lines_canonical
   WHERE id='30000000-0000-0000-0000-000000000010' FOR UPDATE;
  v_result:=public.propose_collection_match_v1('conc-a-propose','CREATE',NULL,jsonb_build_object(
    'credit_daily_line_id','30000000-0000-0000-0000-000000000010','proposed_credit_consumed_amount',700,
    'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','concurrent A',
    'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object(
      'remittance_item_id',p_item_id,'credit_line_consumed_amount',700,'settled_gross_amount',700,'observed_fee_amount',0))));
  PERFORM pg_sleep(5);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION poc_test.propose_collection_match_with_hold(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION poc_test.propose_collection_match_with_hold(uuid) TO authenticated;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('conc-a-create',
 jsonb_build_object('client_name','CONCURRENCY A','receipt_method','CASH','expected_amount',700,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',700,
  'deposit_date','2026-08-03','capture_mode','MANUAL','remittance_kind','LOGICAL_CASH')) x) s \gset ca_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('conc-a-add',:'ca_remittance_id',:'ca_receipt_id',
 jsonb_build_object('item_amount',700,'currency','XOF')) x) s \gset ca_
SELECT (x->>'receipt_id') receipt_id,(x->>'remittance_id') remittance_id FROM (SELECT public.create_collection_remittance_v1('conc-b-create',
 jsonb_build_object('client_name','CONCURRENCY B','receipt_method','CASH','expected_amount',700,'currency','XOF'),
 jsonb_build_object('deposit_account_id','10000000-0000-0000-0000-000000000001','deposit_currency','XOF','declared_total_amount',700,
  'deposit_date','2026-08-03','capture_mode','MANUAL','remittance_kind','LOGICAL_CASH')) x) s \gset cb_
SELECT (x->>'item_id') item_id FROM (SELECT public.add_collection_remittance_item_v1('conc-b-add',:'cb_remittance_id',:'cb_receipt_id',
 jsonb_build_object('item_amount',700,'currency','XOF')) x) s \gset cb_
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT public.validate_collection_remittance_v1('conc-a-validate',:'ca_remittance_id','validate concurrency A');
SELECT public.validate_collection_remittance_v1('conc-b-validate',:'cb_remittance_id','validate concurrency B');
RESET ROLE;

INSERT INTO poc_test.collection_concurrency_ids VALUES('A',:'ca_item_id'),('B',:'cb_item_id');
