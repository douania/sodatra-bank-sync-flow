-- target: 46_operational.sql
-- Mutant (R6) une divergence en accord établi est traitée comme une contradiction.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'bool_or(c.outcome = ''CONTRADICTION'' AND NOT c.covered) AS conflict',
  'bool_or(c.outcome IN (''CONTRADICTION'', ''AGREEMENT_BREAKDOWN'', ''AGREEMENT_DETAIL'') AND NOT c.covered) AS conflict');
