-- target: 40_balances.sql
-- Mutant (P2-3) : une unité d'une version de parseur non prise en charge est retenue.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN u.unit_id IS NOT NULL AND NOT u.format_supported THEN ''UNIT_UNSUPPORTED''', 'WHEN false THEN ''UNIT_UNSUPPORTED''');
