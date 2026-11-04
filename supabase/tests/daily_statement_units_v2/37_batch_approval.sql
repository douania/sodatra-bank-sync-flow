-- Lot 1 opérationnel : approbation groupée par fichier (R6, C8), sur un export
-- Excel synthétique de trois journées passé par le pipeline réel.
\set ON_ERROR_STOP on

SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_batch', opx.deposit('batch'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT opx.put('batch_attempt', to_jsonb(opx.get('d_batch') ->> 'attempt_id'));
SELECT opx.put('batch_raw', to_jsonb((SELECT raw_text_hash FROM public.daily_statement_export_attempts
  WHERE id = (opx.get('batch_attempt') #>> '{}')::uuid)));
SELECT tr_test.assert_eq(jsonb_array_length(public.daily_stmt_batch_candidates((opx.get('batch_attempt') #>> '{}')::uuid) -> 'days')::text,
  '0', 'groupée : aucune journée admissible sans attestation');

CREATE FUNCTION opx.batch(p_key text, p_expected jsonb, p_reason text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.promote_daily_statement_attempt_units(p_key, (opx.get('batch_attempt') #>> '{}')::uuid, p_expected, p_reason) $$;
GRANT EXECUTE ON FUNCTION opx.batch(text, jsonb, text) TO authenticated;

SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT opx.batch(%L, %L::jsonb, %L)', 'opx-batch-empty', '{"days":[],"attestation_ids":[]}',
  'Approbation groupee'), 'DAILY_STMT_BATCH_EMPTY');
SELECT public.attest_daily_statement_attempt('opx-batch-attest', (opx.get('batch_attempt') #>> '{}')::uuid, 'ACCOUNT_IDENTITY',
  opx.get('batch_raw') #>> '{}', '00000000-0000-4000-8000-0000000000f3', 'XOF', 'Piece de rattachement', 'Rattachement du lot');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT opx.put('cand', public.daily_stmt_batch_candidates((opx.get('batch_attempt') #>> '{}')::uuid));
SELECT tr_test.assert_eq(jsonb_array_length(opx.get('cand') -> 'days')::text, '3', 'groupée : trois journées admissibles');

SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT opx.batch(%L, %L::jsonb, %L)', 'opx-batch-stale',
  jsonb_set(opx.get('cand'), '{days}', (opx.get('cand') -> 'days') - 0)::text, 'Liste perimee'), 'DAILY_STMT_BATCH_LIST_STALE');
SELECT tr_test.expect_error(format('SELECT opx.batch(%L, %L::jsonb, %L)', 'opx-batch-sensitive', opx.get('cand')::text,
  'Compte 12345678'), 'DAILY_STMT_REASON_SENSITIVE');
SELECT opx.put('batch_result', opx.batch('opx-batch', opx.get('cand'), 'Approbation groupee du fichier'));
SELECT opx.put('batch_replay', opx.batch('opx-batch', opx.get('cand'), 'Approbation groupee du fichier'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

SELECT tr_test.assert((SELECT count(*) FROM jsonb_array_elements(opx.get('batch_result') -> 'days') d
                        WHERE d ->> 'outcome' = 'promoted' AND d ->> 'approval_event_id' IS NOT NULL) = 3,
  'groupée : trois journées promues, chacune liée à son événement');
SELECT tr_test.assert(opx.get('batch_result') = opx.get('batch_replay'), 'groupée : rejeu par clé');
SELECT tr_test.assert((SELECT count(*) FROM public.daily_statement_import_events e
                        JOIN public.daily_statement_units_staging s ON s.id = e.staging_unit_id
                        WHERE s.attempt_id = (opx.get('batch_attempt') #>> '{}')::uuid AND e.event_type = 'unit_promotion_approved'
                          AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e.safe_details) k)
                              = ARRAY['aggregates_status', 'approval_reason', 'validation_status']) = 3,
  'groupée : audit individuel aux détails de la promotion unitaire');

SELECT 'PASS 37_batch_approval' AS marker;
