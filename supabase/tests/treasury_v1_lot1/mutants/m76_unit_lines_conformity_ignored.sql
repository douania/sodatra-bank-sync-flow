-- target: 46_operational.sql
-- Mutant (P1 de la contre-revue CTO de la PR #156) : l'unité retenue n'exige plus
-- des lignes stockées conformes à ses faits déclarés ; la cause rendue change.
SELECT tr_test.mutate_first('treasury_private.balances_snapshot(date, date)',
  ARRAY['          AND coalesce(cc.conform, false)) AS coherent,
         coalesce(cc.conform, false) AS lines_conform,',
        '          AND public.daily_stmt_canonical_lines_conform(u.id)) AS coherent,
         public.daily_stmt_canonical_lines_conform(u.id) AS lines_conform,'],
  ARRAY['          AND true) AS coherent,
         true AS lines_conform,',
        '          AND true) AS coherent,
         true AS lines_conform,']);
