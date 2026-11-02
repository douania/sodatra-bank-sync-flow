-- target: 40_balances.sql
-- Mutant (P2-4) : un export dont une journée livrée est à revoir prouve ses journées.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'OR s.validation_status <> ''valid'' OR cardinality(s.review_reason_codes) > 0) AS bad_n', ') AS bad_n');
