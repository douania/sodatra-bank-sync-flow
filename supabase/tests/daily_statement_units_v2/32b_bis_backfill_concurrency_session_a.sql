-- Session A creates and promotes the canonical unit, then keeps the shared
-- day lock until commit so session B must wait before deciding R1.
\set ON_ERROR_STOP on

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.bis_concurrency_deposit('a','bisc_a');
SELECT poc_test.ctx_set(
  'bisc_a_canonical',
  public.promote_daily_statement_unit(
    poc_test.ctx_get('bisc_a_staging')::uuid,
    'Synthetic BIS concurrency approval'
  ) ->> 'canonical_unit_id'
);
SELECT pg_sleep(6);
SELECT poc_test.ctx_set('bisc_a_commit_at',clock_timestamp()::text);
COMMIT;
