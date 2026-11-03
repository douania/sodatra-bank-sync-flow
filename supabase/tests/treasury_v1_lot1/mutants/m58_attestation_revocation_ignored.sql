-- target: 46_operational.sql
-- Mutant (R6) la révocation d'une attestation est ignorée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'AND NOT EXISTS (SELECT 1 FROM public.daily_statement_attempt_attestations r WHERE r.revokes_id = x.id)',
  '');
