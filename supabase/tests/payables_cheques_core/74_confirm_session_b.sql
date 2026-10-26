-- Session B : autre comptable, autre clé de commande, même formule et même version lue.
SELECT pc_test.as_user('acc3');
SELECT public.payables_confirm_issuance_v1(pc_test.key('race-confirm-b'), pc_test.id('form_pay_race'),
  (SELECT value FROM pc_test.race_state WHERE name = 'form_version'), DATE '2026-10-26', false);
