-- target: 46_operational.sql
-- Mutant (R6) une ouverture absente est remplacée par zéro.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  's.opening_balance_derived AS opening, s.closing_balance_derived AS closing,',
  'coalesce(s.opening_balance_derived, 0) AS opening, coalesce(s.closing_balance_derived, 0) AS closing,');
