-- Session B : rattachement à la ligne remplaçante pendant la remise en revue ;
-- doit attendre l'unité puis échouer fermé sur l'unité désormais en revue.
SELECT pc_test.as_user('acc4');
SELECT public.payables_rebind_bank_match_v1(pc_test.key('race-rebind-b'), pc_test.id('match_race_rb'), pc_test.id('l_race_rb_r1'),
  'Rattachement pendant une remise en revue');
