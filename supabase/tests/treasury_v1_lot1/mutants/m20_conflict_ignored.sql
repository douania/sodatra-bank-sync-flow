-- target: 40_balances.sql
-- Mutant (P1-2b) : une journée en conflit avec une autre livraison est retenue.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN u.unit_id IS NOT NULL AND sd.has_conflict THEN ''CONFLICT''', 'WHEN false THEN ''CONFLICT''');
