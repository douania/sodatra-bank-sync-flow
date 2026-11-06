-- target: 46_operational.sql
-- Mutant : unité retenue introuvable, refus redevenu un échec de sérialisation (40001), branche 1 seule.
SELECT tr_test.mutate('public.treasury_admin_set_verified_start_v1(text, uuid, date, uuid, text, text, text, text)',
  'IF NOT FOUND THEN',
  'IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = ''40001'', MESSAGE = ''TREASURY_VERIFIED_START_STALE''; END IF; IF false THEN');
