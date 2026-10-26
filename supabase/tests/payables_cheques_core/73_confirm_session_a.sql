-- Session A : confirme l'émission et garde le verrou de formule 4 secondes.
SELECT pc_test.as_user('acc2');
BEGIN;
SELECT public.payables_confirm_issuance_v1(pc_test.key('race-confirm-a'), pc_test.id('form_pay_race'),
  (SELECT value FROM pc_test.race_state WHERE name = 'form_version'), DATE '2026-10-26', false);
SELECT pg_sleep(4);
COMMIT;
