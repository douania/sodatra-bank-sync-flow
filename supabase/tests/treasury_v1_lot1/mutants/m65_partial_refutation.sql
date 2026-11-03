-- target: 46_operational.sql
-- Mutant (R6) une réfutation partielle est admise.
SELECT tr_test.mutate('public.refute_daily_statement_version(text, text, text, text, jsonb, jsonb, text)',
  'IF v_unjustified > 0 THEN',
  'IF false THEN');
