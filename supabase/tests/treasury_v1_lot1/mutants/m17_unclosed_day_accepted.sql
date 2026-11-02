-- target: 40_balances.sql
-- Mutant (P1-2a) : une journée sans preuve de clôture est retenue.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)', 'ELSE ''NOT_CLOSED''', 'ELSE ''UNIT''');
