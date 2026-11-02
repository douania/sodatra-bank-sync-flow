-- target: 12_access.sql
-- Mutant : la lecture n'exige plus READ/AUDIT + BANK_READ.
SELECT tr_test.mutate('public.treasury_balances_at_v1(date)', 'PERFORM payables_private.require_bank_read(v_actor);', 'NULL;');
