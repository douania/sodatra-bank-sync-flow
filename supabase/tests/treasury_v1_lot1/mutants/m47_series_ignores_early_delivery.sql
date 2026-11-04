-- target: 40_balances.sql
-- Mutant (revue 3, P1-1) : une livraison antérieure au premier relevé retenu sort de l'historique.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'least(b.first_unit, b.first_proof, b.first_live),', 'least(b.first_unit, b.first_proof),');
