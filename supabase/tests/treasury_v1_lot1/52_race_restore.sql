-- Après la course : l'état postérieur est bien visible pour une NOUVELLE
-- lecture (preuve que B a validé), puis l'état initial est rétabli.
\set ON_ERROR_STOP on
SELECT tr_test.check('2026-10-07', 'ora_main', 'NOT_COVERED', NULL, 'FORMAT_SUSPENDED', 'après la course : état validé par B');
SELECT tr_test.assert_eq(tr_test.account(tr_test.read_as('t_reader', '2026-10-07'), 'ora_main') -> 'observed_balance' ->> 'balance',
  '9999.00', 'après la course : nouveau solde observé');

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.daily_statement_units_canonical
   SET status = 'superseded', superseded_by = tr_test.id('u_ora_main_07'), superseded_at = now()
 WHERE id = tr_test.id('u_ora_main_07_new');
UPDATE public.daily_statement_units_canonical SET status = 'ingested', superseded_by = NULL, superseded_at = NULL
 WHERE id = tr_test.id('u_ora_main_07');
UPDATE public.daily_statement_units_staging SET status = 'superseded' WHERE id = tr_test.id('s_ora_race_08');
SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_csv', 'QUALIFIED',
  'tr-test:retablissement', 'Rétablissement synthétique après la course', 'operateur-test');
COMMIT;
SELECT tr_test.assert_seed_consistent();
SELECT tr_test.check('2026-10-07', 'ora_main', 'AVAILABLE', '1300.00', '', 'état initial rétabli');
SELECT 'PASS 52_race_restore' AS marker;
