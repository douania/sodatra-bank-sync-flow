-- 0H — double promotion : SESSION B (lancée pendant que A tient le verrou).
-- Attendu : blocage sur le verrou advisory par day_unit_id, re-lecture, puis
-- issue contrôlée 'duplicate' (R1 sous verrou).
\set ON_ERROR_STOP on
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('k_b_outcome',
  (public.promote_daily_statement_unit(poc_test.ctx_get('k_b')::uuid)) ->> 'outcome');
COMMIT;
