-- target: 40_balances.sql
-- Mutant (N4) : une ouverture différente à travers des journées sans ligne est ignorée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'THEN ''CHAIN_UNPROVEN_AFTER_DATE'' END', 'THEN NULL END');
