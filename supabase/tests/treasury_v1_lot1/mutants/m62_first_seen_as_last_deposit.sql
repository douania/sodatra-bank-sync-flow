-- target: 46_operational.sql
-- Mutant (R6) la première apparition d'une source suit son dernier dépôt.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'min(d.export_ingested_at) AS first_seen_at',
  'max(d.export_ingested_at) AS first_seen_at');
