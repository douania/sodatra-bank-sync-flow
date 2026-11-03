-- Lot 1 opérationnel : réfutation d'une version, justifiée source par source
-- (R6, P1 de la R5), sur les charges du pipeline réel. Après la correction des
-- soldes (39), la version retenue de J est la version corrigée ; la version
-- erronée garde ses livraisons. Les instants de dépôt sont repositionnés en base
-- jetable pour figurer la chronologie F1 (le 16) -> C -> F2 (le 20) -> redépôt (le 30).
\set ON_ERROR_STOP on

SET session_replication_role = replica;
UPDATE public.daily_statement_export_attempts SET created_at = '2026-10-16 08:00:00+00'
 WHERE id IN ((opx.get('d_wrong') ->> 'attempt_id')::uuid, (opx.get('d_wrong_again') ->> 'attempt_id')::uuid);
SET session_replication_role = origin;

SELECT opx.put('day_j', to_jsonb(opx.day_unit(opx.uid('d_wrong'))));
SELECT opx.put('vk_v', to_jsonb(opx.vkey(opx.uid('d_wrong'))));
SELECT opx.put('vk_r', to_jsonb(opx.vkey(opx.uid('d_right'))));
SELECT opx.put('src1', opx.sources(opx.uid('d_wrong')));
SELECT tr_test.assert_eq(jsonb_array_length(opx.get('src1'))::text, '1', 'réfutation : une source, deux livraisons de F1');

CREATE FUNCTION opx.refute(p_key text, p_sources text, p_proof jsonb, p_reason text DEFAULT 'Preuve bancaire synthetique')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.refute_daily_statement_version(p_key, opx.get('day_j') #>> '{}', opx.get('vk_v') #>> '{}',
    opx.get('vk_r') #>> '{}', opx.get(p_sources), p_proof, p_reason) $$;
GRANT EXECUTE ON FUNCTION opx.refute(text, text, jsonb, text) TO authenticated;

-- C : livraison postérieure de la version retenue (journée livrée du 18).
SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_later', opx.deposit('right_later'));
SELECT tr_test.expect_error($$SELECT opx.refute('opx-ref-stale', 'nope', jsonb_build_object('kind', 'FRESH_DELIVERY',
  'staging_unit_id', opx.uid_on('d_later', DATE '2026-10-15')))$$, 'DAILY_STMT_REFUTATION_STALE');
SELECT opx.put('ref_c', opx.refute('opx-ref-c', 'src1', jsonb_build_object('kind', 'FRESH_DELIVERY',
  'staging_unit_id', opx.uid_on('d_later', DATE '2026-10-15'))));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert((opx.get('ref_c') ->> 'sources')::integer = 1, 'réfutation C : F1 justifiée (18 > 16)');

-- F2 : autre fichier de la même version, première apparition le 20.
SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_f2', opx.deposit('wrong_f2'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SET session_replication_role = replica;
UPDATE public.daily_statement_export_attempts SET created_at = '2026-10-20 08:00:00+00'
 WHERE id = (opx.get('d_f2') ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT opx.put('src2', opx.sources(opx.uid('d_wrong')));
SELECT tr_test.assert_eq(jsonb_array_length(opx.get('src2'))::text, '2', 'réfutation : F2 est une nouvelle source');

SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error($$SELECT opx.refute('opx-ref-c2', 'src2', jsonb_build_object('kind', 'FRESH_DELIVERY',
  'staging_unit_id', opx.uid_on('d_later', DATE '2026-10-15')))$$, 'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED');
SELECT tr_test.expect_error($$SELECT opx.refute('opx-ref-same-day', 'src2', jsonb_build_object('kind', 'BANK_PIECE',
  'piece_sha256', repeat('a', 64), 'piece_reference', 'Lettre A', 'archive_reference', 'Archive A', 'issued_on', '2026-10-20',
  'archive_attested', true, 'opening', '100', 'closing', '110'))$$, 'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED');
SELECT tr_test.expect_error($$SELECT opx.refute('opx-ref-mismatch', 'src2', jsonb_build_object('kind', 'BANK_PIECE',
  'piece_sha256', repeat('b', 64), 'piece_reference', 'Lettre B', 'archive_reference', 'Archive B', 'issued_on', '2026-10-24',
  'archive_attested', true, 'opening', '101', 'closing', '110'))$$, 'DAILY_STMT_PIECE_VALUES_MISMATCH');
SELECT tr_test.expect_error($$SELECT opx.refute('opx-ref-cents', 'src2', jsonb_build_object('kind', 'BANK_PIECE',
  'piece_sha256', repeat('c', 64), 'piece_reference', 'Lettre C', 'archive_reference', 'Archive C', 'issued_on', '2026-10-24',
  'archive_attested', true, 'opening', '100.50', 'closing', '110'))$$, 'DAILY_STMT_PIECE_VALUE_NOT_WHOLE_XOF');
SELECT tr_test.expect_error($$SELECT opx.refute('opx-ref-archive', 'src2', jsonb_build_object('kind', 'BANK_PIECE',
  'piece_sha256', repeat('d', 64), 'piece_reference', 'Lettre D', 'archive_reference', 'Archive D', 'issued_on', '2026-10-24',
  'archive_attested', false, 'opening', '100', 'closing', '110'))$$, 'DAILY_STMT_PIECE_ARCHIVE_ATTESTATION_REQUIRED');
SELECT tr_test.expect_error($$SELECT opx.refute('opx-ref-date', 'src2', jsonb_build_object('kind', 'BANK_PIECE',
  'piece_sha256', repeat('e', 64), 'piece_reference', 'Lettre E', 'archive_reference', 'Archive E', 'issued_on', '24/10/2026',
  'archive_attested', true, 'opening', '100', 'closing', '110'))$$, 'DAILY_STMT_PIECE_DATE_INVALID');
SELECT tr_test.expect_error($$SELECT opx.refute('opx-ref-account', 'src2', jsonb_build_object('kind', 'BANK_PIECE',
  'piece_sha256', repeat('f', 64), 'piece_reference', 'Compte 12345678', 'archive_reference', 'Archive F', 'issued_on', '2026-10-24',
  'archive_attested', true, 'opening', '100', 'closing', '110'))$$, 'DAILY_STMT_REASON_SENSITIVE');
-- Pièce émise le 24, archivée, valeurs égales à la version retenue : F1 et F2 justifiées.
SELECT opx.put('ref_piece', opx.refute('opx-ref-piece', 'src2', jsonb_build_object('kind', 'BANK_PIECE',
  'piece_sha256', repeat('9', 64), 'piece_reference', 'Lettre corrective 9', 'archive_reference', 'Archive tresorerie 9',
  'issued_on', '2026-10-24', 'archive_attested', true, 'opening', '100', 'closing', '110')));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert((opx.get('ref_piece') ->> 'sources')::integer = 2
  AND opx.get('ref_piece') ->> 'replaced_refutation_id' = opx.get('ref_c') ->> 'refutation_id',
  'réfutation par pièce : deux sources, réfutation précédente remplacée');
SELECT tr_test.assert((SELECT count(*) FROM public.daily_statement_version_refutations r
                        WHERE r.day_unit_id = opx.get('day_j') #>> '{}' AND r.action = 'REFUTE'
                          AND NOT EXISTS (SELECT 1 FROM public.daily_statement_version_refutations x WHERE x.revokes_id = r.id)) = 1,
  'réfutation : une seule active');
SELECT tr_test.assert((SELECT nature = 'ARCHIVED_PIECE_ATTESTATION' AND archive_attested FROM public.daily_statement_correction_pieces
                        WHERE piece_sha256 = repeat('9', 64)), 'pièce : attestation sur pièce archivée, aucun fichier stocké');
-- Même pièce présentée avec une autre référence d'archivage : refusée, jamais ignorée.
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error($$SELECT opx.refute('opx-ref-piece-archive', 'src2', jsonb_build_object('kind', 'BANK_PIECE',
  'piece_sha256', repeat('9', 64), 'piece_reference', 'Lettre corrective 9', 'archive_reference', 'Autre archive 9',
  'issued_on', '2026-10-24', 'archive_attested', true, 'opening', '100', 'closing', '110'))$$, 'DAILY_STMT_PIECE_MISMATCH');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- Redépôt identique de F2 le 30 : même source, première apparition inchangée.
SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_f2b', opx.deposit('wrong_f2'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SET session_replication_role = replica;
UPDATE public.daily_statement_export_attempts SET created_at = '2026-10-30 08:00:00+00'
 WHERE id = (opx.get('d_f2b') ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT tr_test.assert((SELECT count(*) = 2 AND max(first_seen_at) = '2026-10-20 08:00:00+00'
                         FROM public.daily_stmt_version_sources(opx.get('day_j') #>> '{}', opx.get('vk_v') #>> '{}')),
  'redépôt identique : première apparition du 20 conservée');

-- Refus : version en accord établi, version retenue, version inconnue.
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  'opx-ref-agree', opx.get('day_j') #>> '{}', opx.get('vk_breakdown') #>> '{}', opx.get('vk_r') #>> '{}', '[]',
  jsonb_build_object('kind', 'FRESH_DELIVERY', 'staging_unit_id', opx.uid_on('d_later', DATE '2026-10-15')), 'Accord etabli'),
  'DAILY_STMT_REFUTATION_NOT_APPLICABLE');
SELECT tr_test.expect_error(format('SELECT public.refute_daily_statement_version(%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L)',
  'opx-ref-retained', opx.get('day_j') #>> '{}', opx.get('vk_r') #>> '{}', opx.get('vk_r') #>> '{}', '[]',
  jsonb_build_object('kind', 'FRESH_DELIVERY', 'staging_unit_id', opx.uid_on('d_later', DATE '2026-10-15')), 'Version retenue'),
  'DAILY_STMT_REFUTATION_TARGET_RETAINED');
-- Révocation, puis seconde révocation refusée.
SELECT public.revoke_daily_statement_version_refutation('opx-ref-revoke', (opx.get('ref_piece') ->> 'refutation_id')::uuid,
  'Revocation synthetique');
SELECT tr_test.expect_error(format('SELECT public.revoke_daily_statement_version_refutation(%L, %L::uuid, %L)',
  'opx-ref-revoke-2', opx.get('ref_piece') ->> 'refutation_id', 'Seconde revocation'), 'DAILY_STMT_ALREADY_REVOKED');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- Unicité structurelle : deux réfutations actives de la même version impossibles,
-- même par insertion directe (la garde d'ajout seul n'est pas en cause).
SELECT tr_test.expect_error(format($f$INSERT INTO public.daily_statement_version_refutations (action, day_unit_id,
  account_registry_id, accounting_date, refuted_version_key, retained_canonical_unit_id, retained_version_key, comparison,
  proof_kind, proof_staging_unit_id, proof_bound_day, reason, actor_id)
  SELECT 'REFUTE', %L, '00000000-0000-4000-8000-0000000000f1', DATE '2026-10-15', %L, opx.canonical(%L), %L,
         'CONTRADICTION', 'FRESH_DELIVERY', %L::uuid, DATE '2026-10-18', 'Insertion directe', %L::uuid$f$,
  opx.get('day_j') #>> '{}', opx.get('vk_v') #>> '{}', opx.get('day_j') #>> '{}', opx.get('vk_r') #>> '{}',
  opx.uid_on('d_later', DATE '2026-10-15'), tr_test.id('t_admin')), 'uq_version_refutations_first');
SELECT tr_test.expect_error($$INSERT INTO public.daily_statement_correction_pieces (account_registry_id, piece_sha256,
  piece_reference, archive_reference, issued_on, archive_attested, actor_id)
  VALUES ('00000000-0000-4000-8000-0000000000f2', repeat('9', 64), 'Autre compte', 'Archive', DATE '2026-10-24', true,
          '71000000-0000-4000-8000-000000000001')$$, 'daily_statement_correction_pieces_piece_sha256_key');

SELECT 'PASS 36_version_refutation' AS marker;
