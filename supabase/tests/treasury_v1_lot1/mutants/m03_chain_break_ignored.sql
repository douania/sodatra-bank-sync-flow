-- target: 40_balances.sql
-- Mutant : une rupture de chaîne entre journées consécutives est ignorée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'THEN CASE WHEN c.opening = c.prev_balance THEN ''OK'' ELSE ''BREAK'' END', 'THEN ''OK''');
