-- target: 12_access.sql
-- Mutant (P2-1) : la lecture ne vérifie plus l'interrupteur serveur.
SELECT tr_test.mutate('public.treasury_balances_at_v1(date)', 'PERFORM treasury_private.require_module_open();', 'NULL;');
