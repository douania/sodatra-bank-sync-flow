-- target: 46_operational.sql
-- Mutant (P1 de la contre-revue CTO de la PR #156) : protection retirée en entier,
-- seule l'équation ouverture + crédits - débits = clôture subsiste.
SELECT tr_test.mutate('treasury_private.balances_snapshot(date, date)',
  'cardinality(a.residual) = 0 AND lo.lines_ok', 'cardinality(a.residual) = 0 AND true');
SELECT tr_test.mutate_first('treasury_private.balances_snapshot(date, date)',
  ARRAY['          AND coalesce(cc.conform, false)) AS coherent,
         coalesce(cc.conform, false) AS lines_conform,',
        '          AND public.daily_stmt_canonical_lines_conform(u.id)) AS coherent,
         public.daily_stmt_canonical_lines_conform(u.id) AS lines_conform,'],
  ARRAY['          AND true) AS coherent,
         true AS lines_conform,',
        '          AND true) AS coherent,
         true AS lines_conform,']);
