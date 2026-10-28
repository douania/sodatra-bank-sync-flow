-- Session A : préparation en cours (demande de chèque) d'un comptable rattaché, gardée 4 secondes.
SELECT pc_test.as_user('cpt_b');
BEGIN;
SELECT public.payables_create_cheque_request_v1(pc_test.key('race-link-a'), pc_test.id('sa_inv_race'), pc_test.id('acct_ora_pilot'),
  'PILOT_ADMIN', NULL, false, 'Bénéficiaire course rattachement', 'Préparation en cours');
SELECT pg_sleep(4);
COMMIT;
