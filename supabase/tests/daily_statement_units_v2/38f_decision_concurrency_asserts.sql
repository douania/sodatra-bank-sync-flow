-- Lot 1 opérationnel, concurrence : une seule prise d'effet par course.
\set ON_ERROR_STOP on
SELECT tr_test.assert((SELECT status FROM public.daily_statement_units_staging WHERE id = opx.uid('d_race_u')) = 'promoted',
  'course 1 : la promotion de A a pris effet');
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM daily_v2_private.decision_commands WHERE command_key = 'opx-race-reject'),
  'course 1 : aucune clé enregistrée pour l''écartement refusé (annulation totale)');
SELECT tr_test.assert(NOT EXISTS (SELECT 1 FROM public.daily_statement_import_events WHERE staging_unit_id = opx.uid('d_race_u')
  AND new_status = 'rejected'), 'course 1 : jamais à la fois promue et écartée');
SELECT tr_test.assert((SELECT status FROM public.daily_statement_units_staging WHERE id = opx.uid('d_race_v')) = 'rejected',
  'course 2 : écartement appliqué une fois');
SELECT tr_test.assert((SELECT count(*) FROM public.daily_statement_import_events WHERE staging_unit_id = opx.uid('d_race_v')
  AND new_status = 'rejected') = 1, 'course 2 : un seul événement malgré le rejeu');
SELECT tr_test.assert(opx.get('race_replay') = (SELECT result FROM daily_v2_private.decision_commands WHERE command_key = 'opx-race-key'),
  'course 2 : le rejeu rend le résultat enregistré');
SELECT 'PASS 38f_decision_concurrency_asserts' AS marker;
