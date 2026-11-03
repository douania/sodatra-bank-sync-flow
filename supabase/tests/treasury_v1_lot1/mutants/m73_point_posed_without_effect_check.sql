-- target: 46_operational.sql
-- Mutant (R6, C5) un point non effectif pour sa journée est posé.
SELECT tr_test.mutate('public.treasury_admin_set_verified_start_v1(text, uuid, date, uuid, text, text, text, text)',
  'IF v_point IS NULL OR v_point ->> ''for_date'' <> ''EFFECTIVE'' THEN',
  'IF false THEN');
