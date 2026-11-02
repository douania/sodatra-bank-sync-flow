-- target: 40_balances.sql
-- Mutant (P1-1, N1) : une ouverture postérieure qui contredit le solde de D est ignorée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'THEN ''CHAIN_BROKEN_AFTER_DATE'' END', 'THEN NULL END');
