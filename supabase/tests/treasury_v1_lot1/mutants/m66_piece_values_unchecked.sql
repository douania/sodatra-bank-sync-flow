-- target: 46_operational.sql
-- Mutant (R6, G3) une pièce aux valeurs différentes de la version retenue est admise.
SELECT tr_test.mutate('public.refute_daily_statement_version(text, text, text, text, jsonb, jsonb, text)',
  'IF (v_need_bal AND (v_open <> v_active.opening_balance_derived',
  'IF false AND (v_need_bal AND (v_open <> v_active.opening_balance_derived');
