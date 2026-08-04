\set ON_ERROR_STOP on
SELECT item_id FROM poc_test.collection_concurrency_ids WHERE slot='A' \gset
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
SET ROLE authenticated;
SELECT poc_test.propose_collection_match_with_hold(:'item_id'::uuid);
