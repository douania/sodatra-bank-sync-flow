-- target: 40_balances.sql
-- Mutant (CTO P1) : un report arrière sert de référence au contrôle de l'ouverture qui le fournit.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'lag(b.fwd_balance) OVER', 'lag(b.balance_end) OVER');
