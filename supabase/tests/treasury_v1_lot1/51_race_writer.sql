-- Course réelle, session B : pendant la lecture de A, remplacement de la
-- journée ORA du 07 (nouveau solde) ET suspension de la qualification ORA CSV,
-- dans une seule transaction validée. Aucun verrou n'est attendu par B.
\set ON_ERROR_STOP on
-- La lecture de A doit être en cours (instantané déjà pris) : attente active,
-- pas de délai fixe.
DO $$
BEGIN
  FOR i IN 1..200 LOOP
    IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid()
               AND query LIKE '%pg_sleep(3)%') THEN
      RETURN;
    END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION 'RACE_READER_NOT_STARTED';
END $$;
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.daily_statement_units_canonical
   SET status = 'superseded', superseded_by = id, superseded_at = now()
 WHERE id = tr_test.id('u_ora_main_07');
SELECT tr_test.seed_export('e_ora_race', 'ora_main', 'structured_bank_statement_csv', 'structured-csv-0b',
  '2026-10-07', '2026-10-08', '2026-10-08');
SELECT tr_test.put('u_ora_main_07_new', tr_test.seed_unit('e_ora_race', '2026-10-07', 1150, 9999));
-- Ligne (provisoire) du 08 dans le même fichier : le 07 remplacé est clos.
SELECT tr_test.put('s_ora_race_08', tr_test.seed_unit('e_ora_race', '2026-10-08', 9999, 10000,
  p_staging_status => 'provisional', p_canonical => false));
UPDATE public.daily_statement_units_canonical SET superseded_by = tr_test.id('u_ora_main_07_new')
 WHERE id = tr_test.id('u_ora_main_07');
SELECT treasury_private.set_bank_format_qualification('ORA', 'structured_bank_statement_csv', 'SUSPENDED',
  'tr-test:course', 'Suspension synthétique pendant une lecture', 'operateur-test');
COMMIT;
-- Validation faite PENDANT la lecture de A : sinon la course ne prouve rien.
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid()
                         AND query LIKE '%pg_sleep(3)%')
            THEN 'WRITER_COMMITTED' ELSE 'WRITER_AFTER_READER' END;
