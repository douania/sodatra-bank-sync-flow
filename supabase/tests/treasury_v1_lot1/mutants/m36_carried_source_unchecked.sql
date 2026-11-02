-- target: 40_balances.sql
-- Mutant (CTO P1) : le contrôle de l'unité qui fournit un report arrière est ignoré.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  's.day = greatest(a.day, coalesce(a.source_day, a.day))', 's.day = a.day');
