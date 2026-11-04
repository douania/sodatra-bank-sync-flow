-- target: 46_operational.sql
-- Mutant (R6) des données insuffisantes sont traitées comme un accord.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'bool_or(c.outcome LIKE ''INSUFFICIENT%'' AND NOT c.covered) AS insufficient',
  'false AS insufficient');
