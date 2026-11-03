-- Course 2, session A : écarte V avec la clé K, puis tarde à valider.
\set ON_ERROR_STOP on
BEGIN;
SELECT tr_test.as_user('t_admin');
SELECT public.reject_daily_statement_unit('opx-race-key', opx.uid('d_race_v'), 'staged', NULL, NULL, 'Ecartement avant reponse perdue');
RESET ROLE;
SELECT pg_sleep(3);
COMMIT;
SELECT 'REPLAY_A_COMMITTED' AS marker;
