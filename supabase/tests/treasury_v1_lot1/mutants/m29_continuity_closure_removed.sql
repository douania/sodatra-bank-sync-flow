-- target: 40_balances.sql
-- Mutant (N2) : la clôture confirmée par l'ouverture suivante n'est plus reconnue.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN n.next_kind = ''UNIT_OK'' AND n.next_opening = b.closing THEN ''UNIT''', 'WHEN false THEN ''UNIT''');
