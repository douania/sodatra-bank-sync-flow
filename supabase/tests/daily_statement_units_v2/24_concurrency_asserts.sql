-- ============================================================================
-- 0H — ASSERTS CONCURRENCE — après la fin des deux sessions
-- ============================================================================
\set ON_ERROR_STOP on

SELECT poc_test.assert(
  poc_test.ctx_get('k_a_outcome') = 'promoted',
  'concurrence: session A promoted');
SELECT poc_test.assert(
  poc_test.ctx_get('k_b_outcome') = 'duplicate',
  'concurrence: session B duplicate (serialisee par le verrou journee)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_canonical
   WHERE day_unit_id = poc_test.day_unit_id('BKTEST','11/06/2026')
     AND status = 'ingested') = 1,
  'concurrence: UN SEUL canonical actif pour la journee');
SELECT poc_test.assert(
  (SELECT status FROM public.daily_statement_units_staging
   WHERE id = poc_test.ctx_get('k_b')::uuid) = 'duplicate',
  'concurrence: le staging perdant est duplicate, aucun etat partiel');

-- Invariant Option A après concurrence.
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1
    FROM public.daily_statement_lines_canonical l
    JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
    WHERE (l.is_active AND u.status <> 'ingested')
       OR (NOT l.is_active AND u.status = 'ingested')),
  'concurrence: invariant is_active preserve');

SELECT 'concurrence v2: PASS' AS status;
