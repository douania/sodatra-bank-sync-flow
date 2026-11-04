-- target: 46_operational.sql
-- Mutant (R6, C5) un point de départ coupe une contradiction datée à l'horizon.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'AND (c.first_day IS NULL OR c.first_day > v.horizon)',
  '');
