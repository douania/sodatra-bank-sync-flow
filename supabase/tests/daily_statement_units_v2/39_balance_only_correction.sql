-- Lot 1 opérationnel : correction des seuls soldes (R6, C4 bis), sur les
-- charges du pipeline réel. Refus, adoption, idempotence, journal.
\set ON_ERROR_STOP on

SELECT opx.put('c_j', to_jsonb(opx.canonical(opx.day_unit(opx.uid('d_wrong')))::text));
SELECT opx.put('c_j2', to_jsonb(opx.canonical(opx.day_unit(opx.uid('d_wrong2')))::text));
SELECT opx.put('vk_right', to_jsonb(opx.vkey(opx.uid('d_right'))));
SELECT opx.put('vk_wrong', to_jsonb(opx.vkey(opx.uid('d_wrong'))));
SELECT opx.put('vk_unav', to_jsonb(opx.vkey(opx.uid('d_unavailable'))));
SELECT opx.put('vk_right2', to_jsonb(opx.vkey(opx.uid('d_right2'))));
SELECT opx.put('vk_breakdown', to_jsonb(opx.vkey(opx.uid('d_breakdown'))));

SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit_balances(%L, %L::uuid, %L::uuid, %L, %L)',
  'opx-bal-same', opx.get('c_j') #>> '{}', opx.uid('d_wrong_again'), opx.get('vk_wrong') #>> '{}', 'Meme version'),
  'DAILY_STMT_BALANCES_SAME_VERSION');
SELECT tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit_balances(%L, %L::uuid, %L::uuid, %L, %L)',
  'opx-bal-unav', opx.get('c_j') #>> '{}', opx.uid('d_unavailable'), opx.get('vk_unav') #>> '{}', 'Version indisponible'),
  'DAILY_STMT_BALANCES_VERSION_UNUSABLE');
SELECT tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit_balances(%L, %L::uuid, %L::uuid, %L, %L)',
  'opx-bal-stale', opx.get('c_j') #>> '{}', opx.uid('d_right'), opx.get('vk_wrong') #>> '{}', 'Etat attendu perime'),
  'DAILY_STMT_BALANCES_STALE');
SELECT tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit_balances(%L, %L::uuid, %L::uuid, %L, %L)',
  'opx-bal-gate', opx.get('c_j') #>> '{}', opx.uid('d_breakdown'), opx.get('vk_breakdown') #>> '{}', 'Mouvements differents'),
  'DAILY_STMT_BALANCES_GATE');
SELECT tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit_balances(%L, %L::uuid, %L::uuid, %L, %L)',
  'opx-bal-bad', opx.get('c_j2') #>> '{}', opx.uid('d_right2_bad'), opx.get('vk_right2') #>> '{}', 'Copie non conforme'),
  'DAILY_STMT_BALANCES_LINES_UNUSABLE');
SELECT tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit_balances(%L, %L::uuid, %L::uuid, %L, %L)',
  'opx-bal-reason', opx.get('c_j') #>> '{}', opx.uid('d_right'), opx.get('vk_right') #>> '{}', 'Compte 12345678 corrige'),
  'DAILY_STMT_REASON_SENSITIVE');

-- Adoption de la version corrigée de J, puis rejeu de la même clé.
SELECT opx.put('bal_j', public.supersede_daily_statement_unit_balances('opx-bal-j', (opx.get('c_j') #>> '{}')::uuid,
  opx.uid('d_right'), opx.get('vk_right') #>> '{}', 'Releve correctif de J'));
SELECT opx.put('bal_j_replay', public.supersede_daily_statement_unit_balances('opx-bal-j', (opx.get('c_j') #>> '{}')::uuid,
  opx.uid('d_right'), opx.get('vk_right') #>> '{}', 'Releve correctif de J'));
SELECT tr_test.expect_error(format('SELECT public.supersede_daily_statement_unit_balances(%L, %L::uuid, %L::uuid, %L, %L)',
  'opx-bal-j', opx.get('c_j') #>> '{}', opx.uid('d_right'), opx.get('vk_right') #>> '{}', 'Autre demande, meme cle'),
  'DAILY_STMT_COMMAND_KEY_REUSED');
-- J2 : la copie conforme est adoptée malgré la première, inutilisable.
SELECT opx.put('bal_j2', public.supersede_daily_statement_unit_balances('opx-bal-j2', (opx.get('c_j2') #>> '{}')::uuid,
  opx.uid('d_right2'), opx.get('vk_right2') #>> '{}', 'Releve correctif de J2'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

SELECT tr_test.assert(opx.get('bal_j') = opx.get('bal_j_replay'), 'correction : rejeu identique, résultat enregistré');
SELECT tr_test.assert((SELECT count(*) FROM public.daily_statement_units_canonical
                        WHERE day_unit_id = opx.day_unit(opx.uid('d_wrong'))) = 2, 'correction : une seule nouvelle unité');
SELECT tr_test.assert((SELECT opening_balance_derived = 100 AND closing_balance_derived = 110 AND status = 'ingested'
                              AND active_day_content_hash = (SELECT day_content_hash FROM public.daily_statement_units_staging
                                                              WHERE id = opx.uid('d_wrong'))
                         FROM public.daily_statement_units_canonical
                        WHERE id = (opx.get('bal_j') ->> 'new_canonical_unit_id')::uuid),
  'correction : nouvelle unité aux soldes corrigés, mêmes mouvements');
SELECT tr_test.assert((SELECT status = 'superseded' AND superseded_by = (opx.get('bal_j') ->> 'new_canonical_unit_id')::uuid
                         FROM public.daily_statement_units_canonical WHERE id = (opx.get('c_j') #>> '{}')::uuid),
  'correction : ancienne unité remplacée');
SELECT tr_test.assert((SELECT count(*) = 1 AND bool_and(running_balance = 110) FROM public.daily_statement_lines_canonical
                        WHERE day_unit_id = opx.day_unit(opx.uid('d_wrong')) AND is_active),
  'correction : lignes actives de la version corrigée, soldes courants compris');
SELECT tr_test.assert((SELECT status FROM public.daily_statement_units_staging WHERE id = opx.uid('d_right')) = 'promoted',
  'correction : livraison corrective promue');
SELECT tr_test.assert(EXISTS (SELECT 1 FROM public.daily_statement_import_events WHERE canonical_unit_id = (opx.get('c_j') #>> '{}')::uuid
                                 AND event_type = 'unit_superseded' AND safe_details ->> 'resolution' = 'balances_superseded'),
  'correction : remplacement journalisé');
SELECT tr_test.assert(EXISTS (SELECT 1 FROM public.daily_statement_import_events WHERE staging_unit_id = opx.uid('d_right')
                                 AND event_type = 'status_changed' AND safe_details ->> 'reason_code' = 'balances_correction_requeued'),
  'correction : passage en conflit journalisé');
SELECT tr_test.assert((SELECT opening_balance_derived = 200 FROM public.daily_statement_units_canonical
                        WHERE id = (opx.get('bal_j2') ->> 'new_canonical_unit_id')::uuid), 'correction J2 adoptée');

SELECT 'PASS 39_balance_only_correction' AS marker;
