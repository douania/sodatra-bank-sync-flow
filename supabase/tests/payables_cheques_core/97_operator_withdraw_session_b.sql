-- Session B : l'opérateur retire l'administrateur ; il attend la fin de son écriture en cours.
SELECT payables_private.set_module_admin(pc_test.id('dg'), NULL, 'Concurrent synthetic withdrawal of the administrator');
SELECT 'WITHDRAWN';
