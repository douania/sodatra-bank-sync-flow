-- target: 40_balances.sql
-- Mutant (P2-4, R6) les motifs non résolus d'un export (identité non corroborée) sont ignorés.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'ARRAY(SELECT c FROM unnest(x.codes) c WHERE NOT (c = ANY (x.resolved))) AS residual',
  'ARRAY[]::text[] AS residual');
