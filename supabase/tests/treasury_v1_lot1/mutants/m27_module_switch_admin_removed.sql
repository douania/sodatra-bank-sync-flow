-- target: 12_access.sql
-- Mutant (P2-1) : les commandes d'administration ne vérifient plus l'interrupteur serveur.
SELECT tr_test.mutate('treasury_private.require_admin()', 'PERFORM treasury_private.require_module_open();', 'NULL;');
