-- Course 1, session A : tient le verrou de journée, puis promeut la livraison U.
\set ON_ERROR_STOP on
BEGIN;
SELECT public.daily_stmt_acquire_day_lock(opx.get('race_u_day') #>> '{}');
SELECT pg_sleep(3);
SELECT tr_test.as_user('t_admin');
SELECT public.promote_daily_statement_unit(opx.uid('d_race_u'), 'Promotion pendant la course');
RESET ROLE;
COMMIT;
SELECT 'RACE_A_COMMITTED' AS marker;
