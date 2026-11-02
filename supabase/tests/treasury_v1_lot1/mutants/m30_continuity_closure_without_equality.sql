-- target: 40_balances.sql
-- Mutant (N2) : toute unité suivante retenue « confirme » la clôture, quelle que soit son ouverture.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'AND n.next_opening = b.closing THEN ''UNIT''', 'THEN ''UNIT''');
