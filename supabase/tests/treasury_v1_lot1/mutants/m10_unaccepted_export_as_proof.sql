-- target: 40_balances.sql
-- Mutant : un export non entièrement accepté prouve encore ses journées.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)', 'AND eu.bad_n = 0', 'AND true');
