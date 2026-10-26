-- Session A (Daily v2 simulé) : remet en revue l'unité de la ligne remplaçante et
-- garde le verrou de ligne de l'unité 4 secondes.
BEGIN;
UPDATE public.daily_statement_units_canonical SET validation_status = 'needs_review' WHERE id = pc_test.id('u_race_rb_r');
SELECT pg_sleep(4);
COMMIT;
