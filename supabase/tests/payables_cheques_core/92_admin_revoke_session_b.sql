-- Session B : l'administrateur retire la capacité ; il attend la fin de l'écriture en cours.
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('race-revoke-b'), pc_test.id('cpt_a'), 'SUPPLIER_MANAGE', false,
  'Révocation concurrente') ->> 'action';
