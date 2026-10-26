-- Session A : réserve tout le restant puis garde le verrou de facture 4 secondes.
SELECT pc_test.as_user('acc1');
BEGIN;
SELECT public.payables_create_cheque_request_v1(pc_test.key('race-a'), pc_test.id('inv_conc'), pc_test.id('acct_ora'),
  'ALL_PAYMENTS', NULL, false, 'Bénéficiaire course', 'Course A');
SELECT pg_sleep(4);
COMMIT;
