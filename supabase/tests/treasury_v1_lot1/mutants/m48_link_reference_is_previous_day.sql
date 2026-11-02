-- target: 40_balances.sql
-- Mutant (revue 3, P3-2) : la référence du contrôle d'ouverture est la veille, pas l'unité comparée.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'THEN sv.prev_source_day', 'THEN sv.prev_day');
