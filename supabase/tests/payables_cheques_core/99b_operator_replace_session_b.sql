-- Session B : l'opérateur remplace l'administrateur ; il attend la fin de la décision en cours.
SELECT payables_private.set_module_admin(pc_test.id('dg'), pc_test.id('dg_next'), 'Concurrent synthetic replacement of the administrator');
SELECT 'REPLACED';
