-- Session A : préparation en cours de l'administrateur (demande de chèque sur un
-- compte où un autre signataire reste admissible), gardée 4 secondes.
SELECT pc_test.as_user('dg');
BEGIN;
SELECT public.payables_create_cheque_request_v1(pc_test.key('race-identity-a'), pc_test.id('sa_inv_dg'), pc_test.id('acct_ora'),
  'ALL_PAYMENTS', NULL, false, 'Bénéficiaire course identité', 'Préparation en cours');
SELECT pg_sleep(4);
COMMIT;
