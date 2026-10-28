-- Session B : l'administrateur détache ce comptable ; il attend la préparation
-- en cours, la voit, et refuse : l'identité du préparateur ne change plus.
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_person_link_v1(pc_test.key('race-link-b'), pc_test.id('p_cpt_b'), pc_test.id('cpt_b'), false,
  'Détacher pendant une préparation');
