-- 0U — T16 double promotion : SESSION A (gagnante, tient le verrou ~6 s).
\set ON_ERROR_STOP on
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('c1_a_outcome',
  (public.promote_structured_bank_statement_import(poc_test.ctx_get('c1_a')::uuid)) ->> 'outcome');
SELECT pg_sleep(6);
COMMIT;
