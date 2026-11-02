-- target: 40_balances.sql
-- Mutant (P1-2b) : une journée disputée par une version en attente est retenue.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN u.unit_id IS NOT NULL AND sd.has_pending THEN ''CONTESTED''', 'WHEN false THEN ''CONTESTED''');
