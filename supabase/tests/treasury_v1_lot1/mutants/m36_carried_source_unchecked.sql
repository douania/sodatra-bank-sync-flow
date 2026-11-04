-- target: 40_balances.sql
-- Mutant (CTO P1) : le contrôle de l'unité qui fournit un report arrière est ignoré.
-- Version optimisée : les indicateurs cumulés sont lus à X au lieu de l'horizon.
SELECT tr_test.mutate_first('treasury_private.balances_snapshot(date, date)',
  ARRAY['WHEN h.horizon <= a.series_end THEN', 's.day = greatest(a.day, coalesce(a.source_day, a.day))'],
  ARRAY['WHEN false THEN', 's.day = a.day']);
