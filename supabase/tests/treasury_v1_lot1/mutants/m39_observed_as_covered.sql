-- target: 40_balances.sql
-- Mutant (CTO P2) : toute journée au solde dérivé est déclarée couverte.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'AND NOT v.has_break AND NOT v.has_unproven', '');
