-- target: 46_operational.sql
-- Mutant (R6, réserve 4.1) la relation clôture = ouverture + net n'est pas vérifiée.
SELECT tr_test.mutate('public.daily_stmt_version_coherent(text, numeric, numeric, numeric, numeric)',
  'AND p_closing = p_opening + p_credits - p_debits',
  '');
