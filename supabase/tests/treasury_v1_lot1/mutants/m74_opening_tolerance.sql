-- target: 46_operational.sql
-- Mutant (R6, C5) l'ouverture vérifiée admet une tolérance d'un franc.
SELECT tr_test.mutate('public.treasury_admin_set_verified_start_v1(text, uuid, date, uuid, text, text, text, text)',
  'IF v_unit.opening_balance_derived <> v_opening THEN',
  'IF abs(v_unit.opening_balance_derived - v_opening) > 1 THEN');
