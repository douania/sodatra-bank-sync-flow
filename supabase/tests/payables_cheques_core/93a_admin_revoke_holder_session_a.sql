-- Session A : révocation administrative en cours, gardée 4 secondes.
SELECT pc_test.as_user('dg');
BEGIN;
SELECT public.payables_admin_set_capability_v1(pc_test.key('race-revoke-first-a'), pc_test.id('cpt_a'), 'INVOICE_MANAGE', false,
  'Révocation en cours');
SELECT pg_sleep(4);
COMMIT;
