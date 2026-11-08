-- D1, courses C5 et C2, session B : redépose le fichier tardif de C5 pendant que
-- A tient le verrou ; bloquée, elle voit ensuite le canonical actif et se retire
-- au dépôt sans nouvelle copie des lignes ; puis dépose le fichier tardif de C2,
-- qui se retire au dépôt.
\set ON_ERROR_STOP on
SELECT d1.dep('c5:bis3', d1.race_file('c5', 'bis', '2026-10-08'), d1.at('2026-10-20 17:03')) -> 'units' -> 0 ->> 'unit_status' AS unit_status;
SELECT d1.dep('c2:old', d1.race_file('c2', 'old', '2026-10-08'), d1.at('2026-10-10 17:00')) -> 'units' -> 0 ->> 'unit_status' AS unit_status;
SELECT 'D1_RACE_B_DONE' AS marker;
