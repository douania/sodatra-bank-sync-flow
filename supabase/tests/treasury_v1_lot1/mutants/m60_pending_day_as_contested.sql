-- target: 46_operational.sql
-- Mutant (R6, A6) une journée seulement en attente est rendue disputée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN sd.has_pending THEN ''PENDING''',
  'WHEN false THEN ''PENDING''');
