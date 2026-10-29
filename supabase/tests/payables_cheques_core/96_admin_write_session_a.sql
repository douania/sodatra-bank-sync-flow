-- Session A : écriture financière de l'administrateur au titre de ses droits implicites, gardée 4 secondes.
SELECT pc_test.as_user('dg');
BEGIN;
SELECT public.payables_create_supplier_v1(pc_test.key('race-authority-a'), 'Fournisseur course autorité', 'Écriture administrateur');
SELECT pg_sleep(4);
COMMIT;
