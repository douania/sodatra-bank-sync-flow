-- ============================================================================
-- 0Z_J1 — CONCURRENCE PROVISIONAL : SESSION B (lancée pendant le verrou de A)
-- ============================================================================
-- Redépôt SIMULTANÉ de la même journée non close, contenu IDENTIQUE à la
-- session A (zc_l1). Attendu : blocage sur daily_stmt_acquire_day_lock tant
-- que A n'a pas commité (~4 s mesurées entre zc_b_call_at et zc_b_done_at),
-- puis re-lecture post-verrou => duplicate R1-provisional SANS lignes, la
-- provisional de A restant l'unique version vivante.
-- Prérequis : 27 + 28a en cours. Runner : étape [4c].
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.zc_deposit('zc_b', '22/09/2026',
  ARRAY[poc_test.hex64('zc_l1')], 'provisional', '22/09/2026');
SELECT poc_test.ctx_set('zc_b_commit_at', clock_timestamp()::text);
COMMIT;
