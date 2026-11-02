-- target: 40_balances.sql
-- Mutant (revue 3, P1-1) : une livraison antérieure au premier relevé retenu sort de l'historique.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  ', coalesce(b.first_live, b.first_unit)', '');
