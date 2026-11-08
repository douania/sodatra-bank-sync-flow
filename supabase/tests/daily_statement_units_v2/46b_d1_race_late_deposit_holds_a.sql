-- D1, courses C4 et C1, session A : redépose deux fois le fichier tardif de C4
-- (doublons R1-provisional de la provisoire déposée en amorçage), dépose le
-- fichier tardif de C1 (provisoire, aucun canonical encore), puis garde les
-- verrous de journée du 08 avant de valider.
\set ON_ERROR_STOP on
BEGIN;
SELECT d1.dep('c4:bis2', d1.race_file('c4', 'bis', '2026-10-08'), d1.at('2026-10-20 17:02')) -> 'units' -> 0 ->> 'unit_status' AS unit_status;
SELECT d1.dep('c4:bis3', d1.race_file('c4', 'bis', '2026-10-08'), d1.at('2026-10-20 17:03')) -> 'units' -> 0 ->> 'unit_status' AS unit_status;
SELECT d1.dep('c1:old', d1.race_file('c1', 'old', '2026-10-08'), d1.at('2026-10-10 17:00'));
SELECT pg_sleep(4);
COMMIT;
SELECT 'D1_RACE_A_COMMITTED' AS marker;
