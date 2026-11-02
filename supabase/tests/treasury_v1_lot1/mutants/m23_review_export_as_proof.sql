-- target: 40_balances.sql
-- Mutant (P2-4) : un export à revoir (identité non corroborée) prouve ses journées.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  E'AND cardinality(a.review_reason_codes) = 0\n    AND eu.bad_n = 0', E'AND true\n    AND eu.bad_n = 0');
