-- target: 40_balances.sql
-- Mutant (CTO P1) : une continuité appuyée sur une journée non résolue est admise.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN c.last_unresolved_before >= coalesce(c.prev_unit_day, c.last_unresolved_before) THEN ''UNPROVEN''',
  'WHEN false THEN ''UNPROVEN''');
