-- 0U — T16 double supersede : SESSION A (gagnante, tient le verrou ~6 s).
\set ON_ERROR_STOP on
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('c2_a_outcome',
  (public.supersede_structured_bank_statement_import(
     poc_test.ctx_get('c2_canonical')::uuid,
     poc_test.ctx_get('c2_x')::uuid,
     'SYNTH supersede concurrent A')) ->> 'outcome');
SELECT pg_sleep(6);
COMMIT;
