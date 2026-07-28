-- ============================================================================
-- 0Z_J1 — CONCURRENCE PROVISIONAL : SESSION A (gagnante, verrou tenu ~6 s)
-- ============================================================================
-- Redépôt de la journée non close 22/09/2026 avec un CONTENU MODIFIÉ (zc_l1)
-- par rapport à la provisional initiale zc0 (zc_l0). Attendu sous 0Z :
-- zc0 basculée superseded, nouvelle provisional vivante. Le pg_sleep(6)
-- APRÈS le dépôt maintient le verrou advisory par day_unit_id (libéré au
-- COMMIT) : la session B, lancée ~2 s plus tard par le runner, doit bloquer.
-- Prérequis : 27_provisional_concurrency_setup_0z.sql. Runner : étape [4c].
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.zc_deposit('zc_a', '22/09/2026',
  ARRAY[poc_test.hex64('zc_l1')], 'provisional', '22/09/2026');
SELECT pg_sleep(6);
SELECT poc_test.ctx_set('zc_a_commit_at', clock_timestamp()::text);
COMMIT;
