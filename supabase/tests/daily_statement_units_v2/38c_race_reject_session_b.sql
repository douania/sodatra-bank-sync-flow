-- Course 1, session B : écarte U en croyant la voir en attente ; bloquée par le
-- verrou de A, elle relit sous verrou et doit refuser (état périmé), sans écrire.
\set ON_ERROR_STOP on
SELECT tr_test.as_user('t_admin');
SELECT tr_test.expect_error(format('SELECT public.reject_daily_statement_unit(%L, %L::uuid, %L, NULL, NULL, %L)',
  'opx-race-reject', opx.uid('d_race_u'), 'staged', 'Ecartement concurrent'), 'DAILY_STMT_REJECT_STALE');
RESET ROLE;
SELECT 'RACE_B_REFUSED' AS marker;
