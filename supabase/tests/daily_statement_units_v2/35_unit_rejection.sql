-- Lot 1 opérationnel : écartement d'une livraison (R6, C4), sur les charges du
-- pipeline réel. Journée P : quatre livraisons en attente, puis une retenue.
\set ON_ERROR_STOP on

SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_pa', opx.deposit('pend_a'));
SELECT opx.put('d_psame', opx.deposit('pend_same'));
SELECT opx.put('d_pbd', opx.deposit('pend_breakdown'));
SELECT opx.put('d_pco', opx.deposit('pend_contra'));
SELECT public.promote_daily_statement_unit(opx.uid('d_pa'), 'Approbation synthetique P');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT opx.put('c_p', to_jsonb(opx.canonical(opx.day_unit(opx.uid('d_pa')))::text));
SELECT opx.put('h_p', to_jsonb((SELECT active_day_content_hash FROM public.daily_statement_units_canonical
                                 WHERE id = (opx.get('c_p') #>> '{}')::uuid)));

CREATE FUNCTION opx.reject(p_key text, p_unit uuid, p_status text, p_canonical text, p_hash text, p_reason text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.reject_daily_statement_unit(p_key, p_unit, p_status, p_canonical::uuid, p_hash, p_reason) $$;
GRANT EXECUTE ON FUNCTION opx.reject(text, uuid, text, text, text, text) TO authenticated;

SELECT tr_test.as_user('t_admin');
-- Contradiction démontrée (net 20 contre 10) : refus, livraison inchangée.
SELECT tr_test.expect_error(format('SELECT opx.reject(%L, %L::uuid, %L, %L, %L, %L)', 'opx-rej-contra', opx.uid('d_pco'),
  'staged', opx.get('c_p') #>> '{}', opx.get('h_p') #>> '{}', 'Ecartement refuse'), 'DAILY_STMT_REJECT_CONTRADICTS_RETAINED');
-- État attendu périmé : statut ou journée retenue.
SELECT tr_test.expect_error(format('SELECT opx.reject(%L, %L::uuid, %L, %L, %L, %L)', 'opx-rej-stale', opx.uid('d_pbd'),
  'needs_review', opx.get('c_p') #>> '{}', opx.get('h_p') #>> '{}', 'Statut perime'), 'DAILY_STMT_REJECT_STALE');
SELECT tr_test.expect_error(format('SELECT opx.reject(%L, %L::uuid, %L, %L, %L, %L)', 'opx-rej-stale2', opx.uid('d_pbd'),
  'staged', NULL, NULL, 'Journee retenue ignoree'), 'DAILY_STMT_REJECT_STALE');
-- Accord établi avec mouvements différents : admis (sortie de l'attente seulement).
SELECT opx.put('rej_bd', opx.reject('opx-rej-bd', opx.uid('d_pbd'), 'staged', opx.get('c_p') #>> '{}', opx.get('h_p') #>> '{}',
  'Ventilation divergente ecartee'));
SELECT opx.put('rej_bd_replay', opx.reject('opx-rej-bd', opx.uid('d_pbd'), 'staged', opx.get('c_p') #>> '{}',
  opx.get('h_p') #>> '{}', 'Ventilation divergente ecartee'));
-- Mêmes mouvements : R1 rejouée, classée doublon, jamais écartée.
SELECT opx.put('rej_same', opx.reject('opx-rej-same', opx.uid('d_psame'), 'staged', opx.get('c_p') #>> '{}',
  opx.get('h_p') #>> '{}', 'Meme contenu'));
-- Livraison en conflit : jamais écartable.
SELECT tr_test.expect_error(format('SELECT opx.reject(%L, %L::uuid, %L, %L, %L, %L)', 'opx-rej-conflict', opx.uid('d_breakdown'),
  'conflict', opx.canonical(opx.day_unit(opx.uid('d_breakdown')))::text,
  (SELECT active_day_content_hash FROM public.daily_statement_units_canonical WHERE id = opx.canonical(opx.day_unit(opx.uid('d_breakdown')))),
  'Conflit'), 'DAILY_STMT_REJECT_ORIGIN_FORBIDDEN');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

SELECT tr_test.assert_eq(opx.get('rej_bd') ->> 'outcome', 'rejected', 'écartement : accord établi admis');
SELECT tr_test.assert(opx.get('rej_bd') = opx.get('rej_bd_replay'), 'écartement : rejeu par clé');
SELECT tr_test.assert_eq(opx.get('rej_same') ->> 'outcome', 'duplicate', 'écartement : mêmes mouvements classés doublon');
SELECT tr_test.assert((SELECT status FROM public.daily_statement_units_staging WHERE id = opx.uid('d_pco')) = 'staged',
  'écartement refusé : livraison inchangée');
SELECT tr_test.assert((SELECT status FROM public.daily_statement_units_staging WHERE id = opx.uid('d_pbd')) = 'rejected'
  AND opx.lines_of(opx.uid('d_pbd')) > 0, 'écartement : statut rejected, lignes conservées');
SELECT tr_test.assert(EXISTS (SELECT 1 FROM public.daily_statement_import_events WHERE staging_unit_id = opx.uid('d_pbd')
  AND event_type = 'status_changed' AND new_status = 'rejected' AND safe_details ->> 'previous_status' = 'staged'),
  'écartement : journal status_changed avec le statut précédent');
SELECT tr_test.expect_error(format('SELECT public.promote_daily_statement_unit(%L::uuid, %L)', opx.uid('d_pbd'), 'Promotion'),
  'DAILY_STMT_AUTH_REQUIRED');

-- Une livraison écartée n'est jamais promue ni utilisée en remplacement.
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT public.promote_daily_statement_unit(%L::uuid, %L)', opx.uid('d_pbd'), 'Promotion'),
  'DAILY_STMT_PROMOTE_GATE');
SELECT tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit(%L::uuid, %L::uuid, %L)',
  opx.get('c_p') #>> '{}', opx.uid('d_pbd'), 'Remplacement'), 'DAILY_STMT_SUPERSEDE_GATE');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

SELECT 'PASS 35_unit_rejection' AS marker;
