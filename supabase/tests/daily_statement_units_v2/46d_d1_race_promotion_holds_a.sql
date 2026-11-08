-- D1, courses C5 et C2, session A : promeut le 08 de C5 (retrait de la provisoire
-- et du doublon déposés en amorçage) et celui de C2, puis garde les verrous de
-- journée avant de valider.
\set ON_ERROR_STOP on
BEGIN;
SELECT d1.promote('c5:close', '08/10/2026') ->> 'outcome' AS outcome;
SELECT d1.promote('c2:close', '08/10/2026') ->> 'outcome' AS outcome;
SELECT pg_sleep(4);
COMMIT;
SELECT 'D1_RACE_A_COMMITTED' AS marker;
