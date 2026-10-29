-- Session A : écriture financière en cours d'un comptable, gardée 4 secondes.
SELECT pc_test.as_user('cpt_a');
BEGIN;
SELECT public.payables_create_supplier_v1(pc_test.key('race-revoke-a'), 'Fournisseur course révocation', 'Écriture en cours');
SELECT pg_sleep(4);
COMMIT;
