-- D1, course C3, session B : redépose le même fichier pendant que A tient le
-- verrou ; bloquée, elle trouve ensuite la copie conforme validée par A.
\set ON_ERROR_STOP on
SELECT d1.dep('c3:twin_b', d1.race_file('c3', 'twin', '2026-10-08'), d1.at('2026-10-11 17:05')) -> 'units' -> 0 ->> 'unit_status' AS unit_status;
SELECT 'D1_RACE_B_DONE' AS marker;
