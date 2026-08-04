\set ON_ERROR_STOP on
SELECT item_id FROM poc_test.collection_concurrency_ids WHERE slot='B' \gset
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
SET ROLE authenticated;
SELECT public.propose_collection_match_v1('conc-b-propose','CREATE',NULL,jsonb_build_object(
 'credit_daily_line_id','30000000-0000-0000-0000-000000000010','proposed_credit_consumed_amount',700,
 'proposed_fee_consumed_amount',0,'evidence_basis','EXACT_CREDIT','allocation_mode','SINGLE_ITEM','reason','concurrent B',
 'fee_evidence_plan',jsonb_build_array(),'allocation_plan',jsonb_build_array(jsonb_build_object(
  'remittance_item_id',:'item_id'::uuid,'credit_line_consumed_amount',700,'settled_gross_amount',700,'observed_fee_amount',0))));
