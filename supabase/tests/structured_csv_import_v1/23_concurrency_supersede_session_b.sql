-- 0U — T16 double supersede : SESSION B (même cible périmée pendant A).
-- Attendu : blocage sur le verrou, puis STRUCTURED_CSV_STALE_CANONICAL
-- (re-lecture sous verrou 7.7.c) et ROLLBACK interne complet.
\set ON_ERROR_STOP on
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
DO $$
BEGIN
  PERFORM public.supersede_structured_bank_statement_import(
    poc_test.ctx_get('c2_canonical')::uuid,
    poc_test.ctx_get('c2_y')::uuid,
    'SYNTH supersede concurrent B');
  PERFORM poc_test.ctx_set('c2_b_result', 'UNEXPECTED_SUCCESS');
EXCEPTION WHEN OTHERS THEN
  PERFORM poc_test.ctx_set('c2_b_result', SQLERRM);
END
$$;
COMMIT;
