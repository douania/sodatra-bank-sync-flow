-- target: 46_operational.sql
-- Mutant (R6) la couverture d'une réfutation s'étend à une autre empreinte brute.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'AND rs.raw_text_hash = d.raw_text_hash AND rs.account_registry_id = d.rid',
  'AND rs.account_registry_id = d.rid');
