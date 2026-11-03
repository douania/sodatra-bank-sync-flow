-- target: 40_balances.sql
-- Mutant : un export non entièrement accepté prouve encore ses journées.
SELECT tr_test.mutate_first('treasury_private.balances_snapshot(date, date)',
  ARRAY['AND coalesce(eu.bad_n, 0) = 0', 'AND eu.bad_n = 0'], ARRAY['AND true', 'AND true']);
