-- D1, courses C4 et C1, session B : promeut le 08 de C4 pendant que A tient le
-- verrou ; bloquée, elle relit sous verrou, active la version et retire la
-- provisoire et les deux doublons validés par A ; puis promeut le 08 de C1 et
-- retire la provisoire identique déposée par A.
\set ON_ERROR_STOP on
SELECT d1.promote('c4:close', '08/10/2026') ->> 'outcome' AS outcome;
SELECT d1.promote('c1:close', '08/10/2026') ->> 'outcome' AS outcome;
SELECT 'D1_RACE_B_DONE' AS marker;
