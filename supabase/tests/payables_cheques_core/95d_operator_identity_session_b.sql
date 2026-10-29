-- Session B : l'opérateur retire l'identité de l'administrateur ; il attend la
-- préparation en cours, la voit, et refuse : l'identité d'un préparateur ne change plus.
SELECT payables_private.set_module_admin_identity(pc_test.id('dg'), pc_test.id('p_dirigeant'), false,
  'Concurrent synthetic withdrawal of the administrator identity');
