\set ON_ERROR_STOP on

SELECT poc_test.assert(
  (SELECT count(*)=1 FROM public.collection_match_proposals p
   WHERE p.status='PENDING' AND p.credit_daily_line_id='30000000-0000-0000-0000-000000000010'),
  'concurrent proposals may reserve the line only once');
SELECT poc_test.assert(
  (SELECT sum((e->>'credit_line_consumed_amount')::numeric)=700
   FROM public.collection_match_proposals p,LATERAL jsonb_array_elements(p.allocation_plan)e
   WHERE p.status='PENDING' AND p.credit_daily_line_id='30000000-0000-0000-0000-000000000010'),
  'winning reservation must remain within the Daily line amount');
SELECT poc_test.assert(
  (SELECT count(*)=1 FROM public.collection_command_idempotency
   WHERE command_name='propose_collection_match_v1' AND command_key IN ('conc-a-propose','conc-b-propose')),
  'failed concurrent command must roll back its idempotency row');

SELECT 'CONCURRENCY_PASS' AS result;
