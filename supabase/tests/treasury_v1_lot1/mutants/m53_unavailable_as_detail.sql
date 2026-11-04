-- target: 46_operational.sql
-- Mutant (R6) deux agrégats indisponibles au même net deviennent une divergence de détail.
SELECT tr_test.mutate('public.daily_stmt_version_compare(text, text, numeric, numeric, numeric, numeric, text, text, numeric, numeric, numeric, numeric)',
  'RETURN ''INSUFFICIENT_UNAVAILABLE'';',
  'RETURN ''AGREEMENT_DETAIL'';');
