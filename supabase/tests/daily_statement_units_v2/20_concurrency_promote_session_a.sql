-- 0H — double promotion : SESSION A (gagnante, tient le verrou ~6 s).
\set ON_ERROR_STOP on
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('k_a_outcome',
  (public.promote_daily_statement_unit(poc_test.ctx_get('k_a')::uuid)) ->> 'outcome');
SELECT pg_sleep(6);
COMMIT;
