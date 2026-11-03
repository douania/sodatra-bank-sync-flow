-- Lot 1 opérationnel, exception H1 (R6, § 6) : un doublon R1 de l'unité
-- canonique active dont la version financière diffère, dérivée et cohérente,
-- conserve ses lignes ; un seul doublon conforme par version ; jamais pour une
-- version indisponible, ni pour une version identique. Cœur quotidien et cœur de
-- backfill. Classification, empreintes et réponse inchangées. Charges du
-- pipeline réel uniquement (opx.payloads).
\set ON_ERROR_STOP on

-- Journée J : version erronée retenue (ouverture 90).
SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_wrong', opx.deposit('wrong'));
SELECT opx.put('p_wrong', public.promote_daily_statement_unit(opx.uid('d_wrong'), 'Approbation synthetique J'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert_eq(opx.get('p_wrong') ->> 'outcome', 'promoted', 'H1 : version erronée retenue');

-- Version corrigée, mêmes mouvements : doublon R1, lignes conservées.
SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_right', opx.deposit('right'));
SELECT opx.put('d_right_again', opx.deposit('right'));
SELECT opx.put('d_unavailable', opx.deposit('unavailable'));
SELECT opx.put('d_wrong_again', opx.deposit('wrong'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert_eq(opx.get('d_right') -> 'units' -> 0 ->> 'unit_status', 'duplicate', 'H1 : classification R1 inchangée');
SELECT tr_test.assert(
  (SELECT s.day_content_hash FROM public.daily_statement_units_staging s WHERE s.id = opx.uid('d_right'))
  = (SELECT p.units -> 0 ->> 'day_content_hash' FROM opx.payloads p WHERE p.key = 'right'),
  'H1 : empreinte journalière inchangée');
SELECT tr_test.assert_eq(opx.lines_of(opx.uid('d_right'))::text,
  (SELECT line_count::text FROM public.daily_statement_units_staging WHERE id = opx.uid('d_right')),
  'H1 : toutes les lignes du doublon à version différente conservées');
SELECT tr_test.assert(public.daily_stmt_staging_lines_conform(opx.uid('d_right')), 'H1 : copie conforme à ses faits');
SELECT tr_test.assert_eq((SELECT safe_details ->> 'reason_code' FROM public.daily_statement_import_events
                            WHERE staging_unit_id = opx.uid('d_right') AND event_type = 'unit_duplicate'),
  'duplicate_financial_version_differs', 'H1 : motif journalisé avec une clé déjà admise');
SELECT tr_test.assert_eq(opx.lines_of(opx.uid('d_right_again'))::text, '0', 'H1 : redépôt identique sans nouvelle copie');
SELECT tr_test.assert_eq(opx.get('d_unavailable') -> 'units' -> 0 ->> 'unit_status', 'duplicate', 'H1 : indisponible classé doublon');
SELECT tr_test.assert_eq(opx.lines_of(opx.uid('d_unavailable'))::text, '0', 'H1 : version indisponible sans lignes');
SELECT tr_test.assert_eq(opx.lines_of(opx.uid('d_wrong_again'))::text, '0', 'H1 : même version financière sans lignes');
SELECT tr_test.assert((SELECT safe_details ->> 'reason_code' IS NULL FROM public.daily_statement_import_events
                         WHERE staging_unit_id = opx.uid('d_wrong_again') AND event_type = 'unit_duplicate'),
  'H1 : doublon ordinaire journalisé comme avant');

-- Réserve CTO 4.2, journée J2 : une première copie non conforme (solde courant
-- altéré, faits de l'unité intacts) ne dispense pas une copie valide.
SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_wrong2', opx.deposit('wrong2'));
SELECT public.promote_daily_statement_unit(opx.uid('d_wrong2'), 'Approbation synthetique J2');
SELECT opx.put('d_right2_bad', (SELECT public.pre_ingest_daily_statement_units(p.attempt,
  p.units, jsonb_set(p.lines, '{0,running_balance}', to_jsonb('219'::text)), p.guard) FROM opx.payloads p WHERE p.key = 'right2'));
SELECT opx.put('d_right2', opx.deposit('right2'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert(opx.lines_of(opx.uid('d_right2_bad')) = 1 AND NOT public.daily_stmt_staging_lines_conform(opx.uid('d_right2_bad')),
  'Réserve 4.2 : première copie conservée mais non conforme');
SELECT tr_test.assert(opx.lines_of(opx.uid('d_right2')) = 1 AND public.daily_stmt_staging_lines_conform(opx.uid('d_right2')),
  'Réserve 4.2 : une copie valide est conservée malgré la première, inutilisable');

-- Cœur de backfill : X déposé en quotidien et retenu, puis relivré par un
-- backfill aux soldes différents (mêmes mouvements) ; Y nouvelle journée.
SELECT tr_test.as_user('t_admin');
SELECT opx.put('d_bis_daily', opx.deposit('bis_daily'));
SELECT public.promote_daily_statement_unit(opx.uid('d_bis_daily'), 'Approbation synthetique X');
SELECT opx.put('d_bis_backfill', opx.deposit('bis_backfill'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tr_test.assert_eq((SELECT string_agg(u ->> 'unit_status', ',' ORDER BY u ->> 'unit_status')
                            FROM jsonb_array_elements(opx.get('d_bis_backfill') -> 'units') u),
  'duplicate,staged', 'H1 backfill : classification inchangée');
SELECT tr_test.assert(opx.lines_of(opx.uid_on('d_bis_backfill', DATE '2026-02-20')) =
  (SELECT line_count FROM public.daily_statement_units_staging WHERE id = opx.uid_on('d_bis_backfill', DATE '2026-02-20')),
  'H1 backfill : lignes du doublon à version différente conservées');
SELECT tr_test.assert_eq((SELECT safe_details ->> 'reason_code' FROM public.daily_statement_import_events
                            WHERE staging_unit_id = opx.uid_on('d_bis_backfill', DATE '2026-02-20') AND event_type = 'unit_duplicate'),
  'duplicate_financial_version_differs', 'H1 backfill : motif journalisé');
SELECT tr_test.assert(opx.lines_of(opx.uid_on('d_bis_backfill', DATE '2026-01-01')) > 0, 'H1 backfill : journée nouvelle stagée');

SELECT 'PASS 40_duplicate_financial_version_lines' AS marker;
