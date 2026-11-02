-- target: 40_balances.sql
-- Mutant (CTO P2) : la couverture ne vérifie plus la qualification du format.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'AND vq.status = ''QUALIFIED''', '');
