-- Après la course : l'état postérieur est bien visible pour une NOUVELLE
-- lecture (preuve que B a validé), puis l'état initial est rétabli.
\set ON_ERROR_STOP on
-- Lot 1 opérationnel (R6, point F) : la version remplacée du 07 (net différent)
-- reste une contradiction, faute d'une livraison adoptée postérieure à chacune
-- de ses sources ; le nouveau canonique validé par B est bien celui comparé.
SELECT tr_test.check('2026-10-07', 'ora_main', 'BLOCKED', NULL, 'DAY_CONFLICT,FORMAT_SUSPENDED', 'après la course : état validé par B');
SELECT tr_test.assert((SELECT count(*) FROM jsonb_array_elements(
    tr_test.account(tr_test.read_as('t_reader', '2026-10-07'), 'ora_main') -> 'findings') f
  WHERE f ->> 'kind' = 'VERSION_CONTRADICTION' AND f ->> 'day' = '2026-10-07') = 1,
  'après la course : la journée remplacée par B est comparée à l''ancienne version');

-- Rétablissement de l'état initial : la livraison de la course est retirée de
-- cette base jetable (mode réplica), sinon elle contredirait l'état rétabli.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.daily_statement_lines_canonical WHERE canonical_unit_id = tr_test.id('u_ora_main_07_new');
DELETE FROM public.daily_statement_units_canonical WHERE id = tr_test.id('u_ora_main_07_new');
UPDATE public.daily_statement_units_canonical SET status = 'ingested', superseded_by = NULL, superseded_at = NULL
 WHERE id = tr_test.id('u_ora_main_07');
DELETE FROM public.daily_statement_units_staging WHERE attempt_id = tr_test.id('e_ora_race');
DELETE FROM public.daily_statement_export_attempts WHERE id = tr_test.id('e_ora_race');
SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_csv', 'QUALIFIED',
  'tr-test:retablissement', 'Rétablissement synthétique après la course', 'operateur-test');
COMMIT;
SELECT tr_test.assert_seed_consistent();
SELECT tr_test.check('2026-10-07', 'ora_main', 'AVAILABLE', '1300.00', '', 'état initial rétabli');
SELECT 'PASS 52_race_restore' AS marker;
