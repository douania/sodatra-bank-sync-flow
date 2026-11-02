-- target: 25_inventory_rules.sql
-- Mutant : l'inventaire n'exige plus l'administrateur unique.
SELECT tr_test.mutate('treasury_private.require_admin()', 'PERFORM payables_private.require_admin(v_actor);', 'NULL;');
