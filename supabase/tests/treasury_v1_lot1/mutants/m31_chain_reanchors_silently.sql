-- target: 40_balances.sql
-- Mutant (N3) : la chaîne ne compare que les unités retenues et se réancre en silence.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'FILTER (WHERE d.unit_id IS NOT NULL AND d.closing IS NOT NULL)', 'FILTER (WHERE d.kind = ''UNIT'')');
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHERE g.unit_id IS NOT NULL AND g.closing IS NOT NULL', 'WHERE g.kind = ''UNIT''');
