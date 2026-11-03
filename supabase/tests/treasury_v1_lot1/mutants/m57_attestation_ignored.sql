-- target: 46_operational.sql
-- Mutant (R6) une attestation active ne résout plus son motif.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'coalesce(ar.resolved, ARRAY[]::text[]) AS resolved',
  'ARRAY[]::text[] AS resolved');
