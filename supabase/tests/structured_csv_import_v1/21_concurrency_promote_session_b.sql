-- 0U — T16 double promotion : SESSION B (lancée pendant que A tient le verrou).
-- Attendu : blocage sur le verrou advisory puis issue contrôlée 'duplicate'.
\set ON_ERROR_STOP on
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('c1_b_outcome',
  (public.promote_structured_bank_statement_import(poc_test.ctx_get('c1_b')::uuid)) ->> 'outcome');
COMMIT;
