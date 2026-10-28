-- Session B : même décision depuis un second onglet ; elle attend puis constate l'état.
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('race-grant-b'), pc_test.id('cpt_b'), 'EXIT_REQUEST', true,
  'Attribution concurrente B');
