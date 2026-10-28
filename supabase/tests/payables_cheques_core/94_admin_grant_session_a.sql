-- Session A : décision administrative gardée 4 secondes.
SELECT pc_test.as_user('dg');
BEGIN;
SELECT public.payables_admin_set_capability_v1(pc_test.key('race-grant-a'), pc_test.id('cpt_b'), 'EXIT_REQUEST', true,
  'Attribution concurrente A');
SELECT pg_sleep(4);
COMMIT;
