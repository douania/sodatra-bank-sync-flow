-- target: 40_balances.sql
-- Mutant (CTO P1) : une continuité qui enjambe une journée non résolue est admise.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'WHEN c.last_unresolved_before >= coalesce(', 'WHEN c.last_unresolved_before = coalesce(');
