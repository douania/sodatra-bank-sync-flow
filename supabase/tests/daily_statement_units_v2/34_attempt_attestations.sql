-- Lot 1 opérationnel : attestations d'identité et de devise par fichier (R6,
-- C2, C3), sur les charges du pipeline réel (exports Excel sans libellé).
\set ON_ERROR_STOP on

SELECT opx.put('a_batch', to_jsonb((SELECT a.id FROM public.daily_statement_export_attempts a
  WHERE a.account_registry_id = '00000000-0000-4000-8000-0000000000f1' ORDER BY a.created_at LIMIT 1)));
SELECT opx.put('raw_a', to_jsonb((SELECT raw_text_hash FROM public.daily_statement_export_attempts
  WHERE id = (opx.get('a_batch') #>> '{}')::uuid)));

CREATE FUNCTION opx.attest(p_key text, p_type text, p_raw text, p_account uuid, p_currency text, p_reason text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.attest_daily_statement_attempt(p_key, (opx.get('a_batch') #>> '{}')::uuid, p_type, p_raw, p_account,
    p_currency, 'Piece de rattachement synthetique', p_reason) $$;
GRANT EXECUTE ON FUNCTION opx.attest(text, text, text, uuid, text, text) TO authenticated;

SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT opx.attest(%L, %L, %L, %L::uuid, %L, %L)', 'opx-att-file', 'ACCOUNT_IDENTITY',
  repeat('0', 64), '00000000-0000-4000-8000-0000000000f1', 'XOF', 'Mauvais fichier'), 'DAILY_STMT_ATTESTATION_FILE_MISMATCH');
SELECT tr_test.expect_error(format('SELECT opx.attest(%L, %L, %L, %L::uuid, %L, %L)', 'opx-att-account', 'ACCOUNT_IDENTITY',
  opx.get('raw_a') #>> '{}', '00000000-0000-4000-8000-0000000000f2', 'XOF', 'Mauvais compte'), 'DAILY_STMT_ATTESTATION_ACCOUNT_MISMATCH');
SELECT tr_test.expect_error(format('SELECT opx.attest(%L, %L, %L, %L::uuid, %L, %L)', 'opx-att-currency', 'TRUSTED_CURRENCY',
  opx.get('raw_a') #>> '{}', '00000000-0000-4000-8000-0000000000f1', 'XOF', 'Devise non requise'), 'DAILY_STMT_ATTESTATION_NOT_NEEDED');
SELECT tr_test.expect_error(format('SELECT opx.attest(%L, %L, %L, %L::uuid, %L, %L)', 'opx-att-sensitive', 'ACCOUNT_IDENTITY',
  opx.get('raw_a') #>> '{}', '00000000-0000-4000-8000-0000000000f1', 'XOF', 'Compte 12345678'), 'DAILY_STMT_REASON_SENSITIVE');
SELECT opx.put('att1', opx.attest('opx-att-1', 'ACCOUNT_IDENTITY', opx.get('raw_a') #>> '{}',
  '00000000-0000-4000-8000-0000000000f1', 'XOF', 'Rattachement synthetique'));
SELECT tr_test.expect_error(format('SELECT opx.attest(%L, %L, %L, %L::uuid, %L, %L)', 'opx-att-2', 'ACCOUNT_IDENTITY',
  opx.get('raw_a') #>> '{}', '00000000-0000-4000-8000-0000000000f1', 'XOF', 'Seconde'), 'DAILY_STMT_ALREADY_ATTESTED');
SELECT public.revoke_daily_statement_attempt_attestation('opx-att-revoke-1', (opx.get('att1') ->> 'attestation_id')::uuid,
  'Revocation synthetique');
SELECT tr_test.expect_error(format('SELECT public.revoke_daily_statement_attempt_attestation(%L, %L::uuid, %L)',
  'opx-att-revoke-2', opx.get('att1') ->> 'attestation_id', 'Deja revoquee'), 'DAILY_STMT_ALREADY_REVOKED');
SELECT opx.put('att3', opx.attest('opx-att-3', 'ACCOUNT_IDENTITY', opx.get('raw_a') #>> '{}',
  '00000000-0000-4000-8000-0000000000f1', 'XOF', 'Nouveau rattachement'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert((SELECT after_revocation_id IS NOT NULL FROM public.daily_statement_attempt_attestations
                        WHERE id = (opx.get('att3') ->> 'attestation_id')::uuid), 'attestation suivante : révocation consommée');
SELECT tr_test.assert_eq(public.daily_stmt_attempt_resolved_codes((opx.get('a_batch') #>> '{}')::uuid)::text,
  '{ACCOUNT_IDENTITY_NOT_CORROBORATED}', 'attestation : seul le motif d''identité est résolu');

-- Autorité : rôle admin Daily v2 ET administrateur unique.
SELECT tr_test.as_user('t_reader');
SELECT tr_test.expect_error(format('SELECT opx.attest(%L, %L, %L, %L::uuid, %L, %L)', 'opx-att-reader', 'ACCOUNT_IDENTITY',
  opx.get('raw_a') #>> '{}', '00000000-0000-4000-8000-0000000000f1', 'XOF', 'Lecteur'), 'DAILY_STMT_ROLE_DENIED');
RESET ROLE;
INSERT INTO public.user_roles (user_id, role) VALUES (tr_test.id('t_reader'), 'admin') ON CONFLICT DO NOTHING;
SELECT tr_test.as_user('t_reader');
SELECT tr_test.expect_error(format('SELECT opx.attest(%L, %L, %L, %L::uuid, %L, %L)', 'opx-att-not-single', 'ACCOUNT_IDENTITY',
  opx.get('raw_a') #>> '{}', '00000000-0000-4000-8000-0000000000f1', 'XOF', 'Admin non unique'), 'PAYABLES_ADMIN_REQUIRED');
RESET ROLE;
DELETE FROM public.user_roles WHERE user_id = tr_test.id('t_reader') AND role = 'admin';
SELECT set_config('request.jwt.claim.sub', '', false);

-- Unicité structurelle et ajout seul, même hors commande.
SELECT tr_test.expect_error(format($f$INSERT INTO public.daily_statement_attempt_attestations (attempt_id, attestation_type,
  action, raw_text_hash, account_registry_id, currency, evidence_ref, reason, actor_id)
  VALUES (%L::uuid, 'ACCOUNT_IDENTITY', 'ATTEST', %L, '00000000-0000-4000-8000-0000000000f1', 'XOF', 'Piece', 'Directe', %L::uuid)$f$,
  opx.get('a_batch') #>> '{}', opx.get('raw_a') #>> '{}', tr_test.id('t_admin')), 'uq_attempt_attestations_first');
SELECT tr_test.expect_error($$UPDATE public.daily_statement_attempt_attestations SET reason = 'x'$$, 'DAILY_STMT_APPEND_ONLY');

SELECT 'PASS 34_attempt_attestations' AS marker;
