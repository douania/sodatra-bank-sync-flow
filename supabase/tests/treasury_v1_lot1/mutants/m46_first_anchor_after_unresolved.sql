-- target: 40_balances.sql
-- Mutant (revue 3, P1-1) : le premier ancrage est admis malgré une journée non résolue antérieure.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'coalesce(c.prev_unit_day, c.last_unresolved_before)', 'c.prev_unit_day');
