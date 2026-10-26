-- Session A : réserve la facture du futur fournisseur absorbé et garde son
-- verrou de facture 4 secondes.
SELECT pc_test.as_user('acc1');
BEGIN;
SELECT public.payables_create_cheque_request_v1(pc_test.key('race-merge-a'), pc_test.id('inv_race_merge'), pc_test.id('acct_ora'),
  'ALL_PAYMENTS', NULL, false, 'Bénéficiaire course fusion', 'Course fusion A');
SELECT pg_sleep(4);
COMMIT;
