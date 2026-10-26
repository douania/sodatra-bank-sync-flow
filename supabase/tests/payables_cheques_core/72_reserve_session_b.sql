-- Session B : même facture, autre comptable ; doit attendre puis échouer fermé.
SELECT pc_test.as_user('acc3');
SELECT public.payables_create_cheque_request_v1(pc_test.key('race-b'), pc_test.id('inv_conc'), pc_test.id('acct_ora'),
  'ALL_PAYMENTS', NULL, false, 'Bénéficiaire course', 'Course B');
