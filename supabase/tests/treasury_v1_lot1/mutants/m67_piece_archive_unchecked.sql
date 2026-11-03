-- target: 46_operational.sql
-- Mutant (R6, J) une pièce sans attestation d'archivage est admise.
SELECT tr_test.mutate('public.refute_daily_statement_version(text, text, text, text, jsonb, jsonb, text)',
  'IF coalesce((p_proof ->> ''archive_attested'')::boolean, false) IS NOT TRUE THEN',
  'IF false THEN');
