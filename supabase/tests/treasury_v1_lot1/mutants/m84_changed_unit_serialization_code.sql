-- target: 46_operational.sql
-- Mutant : unité qui n'est plus celle lue, refus redevenu un échec de sérialisation (40001), branche 2 seule.
SELECT tr_test.mutate('public.treasury_admin_set_verified_start_v1(text, uuid, date, uuid, text, text, text, text)',
  'OR v_unit.accounting_date <> p_day OR v_unit.active_day_content_hash IS DISTINCT FROM p_content_hash THEN',
  'OR v_unit.accounting_date <> p_day OR v_unit.active_day_content_hash IS DISTINCT FROM p_content_hash THEN '
  || 'RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''TREASURY_VERIFIED_START_STALE''; END IF; IF false THEN');
