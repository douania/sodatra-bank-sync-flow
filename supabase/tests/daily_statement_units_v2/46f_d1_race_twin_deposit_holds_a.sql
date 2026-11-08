-- D1, course C3, session A : dépose le fichier tardif identique (première
-- réception) et garde le verrou de journée avant de valider.
\set ON_ERROR_STOP on
BEGIN;
SELECT d1.dep('c3:twin_a', d1.race_file('c3', 'twin', '2026-10-08'), d1.at('2026-10-11 17:00'));
SELECT pg_sleep(4);
COMMIT;
SELECT 'D1_RACE_A_COMMITTED' AS marker;
