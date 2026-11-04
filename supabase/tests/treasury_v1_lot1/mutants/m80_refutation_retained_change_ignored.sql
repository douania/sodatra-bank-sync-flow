-- target: 46_operational.sql
-- Mutant (P2 de la contre-revue CTO de la PR #156, cas reproduit) : un changement
-- de la version retenue ne suspend plus la réfutation.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'EXISTS (SELECT 1 FROM units2 u WHERE u.unit_id = r.retained_canonical_unit_id AND u.coherent) AS retained_ok',
  'true AS retained_ok');
