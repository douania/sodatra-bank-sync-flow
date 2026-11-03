-- target: 40_balances.sql
-- Mutant (revue 3, P2-2) : la devise de l'unité qui fournit un report arrière n'est plus contrôlée.
SELECT tr_test.mutate_first('treasury_private.balances_snapshot(date, date)',
  ARRAY['CASE WHEN h.horizon <= a.series_end THEN coalesce(a.first_currency_day <= h.horizon, false)',
        'coalesce(s.currency_through, a.currency_through)'],
  ARRAY['CASE WHEN false THEN NULL', 'a.currency_through']);
