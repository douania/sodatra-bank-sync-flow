-- ============================================================================
-- 0U — ASSERTS CONCURRENCE (T16) — après la fin des deux paires de sessions
-- ============================================================================
\set ON_ERROR_STOP on

-- Double promotion : une seule gagne, l'autre sort en duplicate contrôlé.
SELECT poc_test.assert(
  poc_test.ctx_get('c1_a_outcome') = 'promoted',
  'T16 promote concurrent: session A promoted');
SELECT poc_test.assert(
  poc_test.ctx_get('c1_b_outcome') = 'duplicate',
  'T16 promote concurrent: session B duplicate (serialisee par le verrou 7.9)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_canonical
   WHERE import_id = 'poc:v1:C1' AND status = 'ingested') = 1,
  'T16 promote concurrent: un seul canonical actif C1');

-- Double supersede : un seul gagne, l'autre STALE + rollback interne total.
SELECT poc_test.assert(
  poc_test.ctx_get('c2_a_outcome') = 'superseded',
  'T16 supersede concurrent: session A superseded');
SELECT poc_test.assert(
  poc_test.ctx_get('c2_b_result') ILIKE '%STRUCTURED_CSV_STALE_CANONICAL%',
  'T16 supersede concurrent: session B rejetee (cible perimee re-lue sous verrou)');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_canonical
   WHERE import_id = 'poc:v1:C2' AND status = 'ingested') = 1,
  'T16 supersede concurrent: un seul canonical actif C2');
SELECT poc_test.assert(
  (SELECT active_raw_text_hash FROM public.bank_statement_canonical
   WHERE import_id = 'poc:v1:C2' AND status = 'ingested') = 'rth_c2_x',
  'T16 le contenu actif C2 est celui de la session gagnante');
SELECT poc_test.assert(
  (SELECT status FROM public.bank_statement_import_attempts
   WHERE id = poc_test.ctx_get('c2_y')::uuid) = 'conflict',
  'T16 session B: aucun etat partiel persiste (attempt toujours conflict)');

-- Invariant Option A après concurrence.
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1
    FROM public.bank_statement_lines_canonical l
    JOIN public.bank_statement_canonical c ON c.id = l.canonical_statement_id
    WHERE (l.is_active AND c.status <> 'ingested')
       OR (NOT l.is_active AND c.status = 'ingested')),
  'T16/T13bis invariant is_active preserve apres concurrence');

SELECT 'concurrence: PASS' AS status;
