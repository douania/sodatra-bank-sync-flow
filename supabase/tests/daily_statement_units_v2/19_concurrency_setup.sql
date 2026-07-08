-- ============================================================================
-- 0H — SETUP CONCURRENCE — préparé AVANT le lancement des deux sessions
-- ============================================================================
-- Deux dépôts identiques de la MÊME journée (aucun canonical encore) : les
-- deux unités sortent 'staged'. Les sessions 20/21 tentent ensuite la double
-- promotion : le verrou advisory par day_unit_id + la re-lecture sous verrou
-- + l'index unique partiel garantissent UN SEUL canonical actif.
-- ============================================================================
\set ON_ERROR_STOP on
SET datestyle TO 'ISO, MDY';

BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.ctx_set('k_a', (public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BKTEST','11/06/2026','11/06/2026',NULL),
  jsonb_build_array(poc_test.mk_unit('BKTEST','11/06/2026', ARRAY[poc_test.hex64('k_l2')], 'staged')),
  jsonb_build_array(poc_test.mk_line('BKTEST','11/06/2026', poc_test.hex64('k_l2'), 1, 0)),
  poc_test.mk_guard(true, 1)) -> 'units' -> 0 ->> 'staging_unit_id'));
SELECT poc_test.ctx_set('k_b', (public.pre_ingest_daily_statement_units(
  poc_test.mk_attempt('daily','BKTEST','11/06/2026','11/06/2026',NULL),
  jsonb_build_array(poc_test.mk_unit('BKTEST','11/06/2026', ARRAY[poc_test.hex64('k_l2')], 'staged')),
  jsonb_build_array(poc_test.mk_line('BKTEST','11/06/2026', poc_test.hex64('k_l2'), 1, 0)),
  poc_test.mk_guard(true, 1)) -> 'units' -> 0 ->> 'staging_unit_id'));
COMMIT;

SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('k_a')::uuid) = 'staged'
  AND (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('k_b')::uuid) = 'staged',
  'setup concurrence: deux depots staged de la meme journee'
);

SELECT 'setup concurrence v2: PASS' AS status;
