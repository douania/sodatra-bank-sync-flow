-- target: 40_balances.sql
-- Mutant (revue 3, P2-2) : la devise de l'unité qui fournit un report arrière n'est plus contrôlée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'coalesce(s.currency_through, a.currency_through)', 'a.currency_through');
