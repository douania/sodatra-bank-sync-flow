-- Course 2, session B : rejoue la même clé K pendant l'exécution de A (réponse
-- perdue) ; elle attend la fin de A et reçoit le résultat enregistré.
\set ON_ERROR_STOP on
SELECT tr_test.as_user('t_admin');
SELECT opx.put('race_replay', public.reject_daily_statement_unit('opx-race-key', opx.uid('d_race_v'), 'staged', NULL, NULL,
  'Ecartement avant reponse perdue'));
RESET ROLE;
SELECT 'REPLAY_B_DONE' AS marker;
