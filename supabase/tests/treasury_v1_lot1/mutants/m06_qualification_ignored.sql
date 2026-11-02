-- target: 40_balances.sql
-- Mutant : un format non qualifié est traité comme qualifié.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)', 'ELSE ''FORMAT_NOT_QUALIFIED''', 'ELSE NULL');
