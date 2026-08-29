-- =============================================================================
-- BIS BACKFILL SET-BASED CORE — CONCURRENCY ASSERTIONS
-- =============================================================================
\set ON_ERROR_STOP on

SELECT poc_test.assert(
  poc_test.ctx_get('bisc_a_status')='staged'
    AND poc_test.ctx_get('bisc_b_status')='duplicate',
  'BISC1: A stages the new day and serialized B resolves as canonical duplicate'
);

SELECT poc_test.assert(
  poc_test.ctx_get('bisc_b_done_at')::timestamptz
    - poc_test.ctx_get('bisc_b_call_at')::timestamptz >= interval '3 seconds',
  'BISC2: session B waited at least three seconds on the shared day lock'
);
SELECT poc_test.assert(
  poc_test.ctx_get('bisc_b_call_at')::timestamptz
    < poc_test.ctx_get('bisc_a_commit_at')::timestamptz
  AND poc_test.ctx_get('bisc_b_done_at')::timestamptz
    > poc_test.ctx_get('bisc_a_commit_at')::timestamptz,
  'BISC2: B entered before A commit and completed after A commit'
);

SELECT 'BISC evidence: B blocked '
  || round(extract(epoch FROM
       poc_test.ctx_get('bisc_b_done_at')::timestamptz
         - poc_test.ctx_get('bisc_b_call_at')::timestamptz)::numeric,3)
  || ' s' AS evidence;

SELECT poc_test.assert(
  (SELECT count(*)=1
   FROM public.daily_statement_units_canonical
   WHERE day_unit_id=poc_test.ctx_get('bisc_a_duid') AND status='ingested'),
  'BISC3: exactly one active canonical unit exists for the raced day'
);
SELECT poc_test.assert(
  (SELECT status='promoted'
   FROM public.daily_statement_units_staging
   WHERE id=poc_test.ctx_get('bisc_a_staging')::uuid)
  AND
  (SELECT status='duplicate'
   FROM public.daily_statement_units_staging
   WHERE id=poc_test.ctx_get('bisc_b_staging')::uuid),
  'BISC3: A is promoted and B remains an auditable duplicate'
);
SELECT poc_test.assert(
  (SELECT count(*)=0
   FROM public.daily_statement_lines_staging
   WHERE staging_unit_id=poc_test.ctx_get('bisc_b_staging')::uuid),
  'BISC4: canonical duplicate B stages no financial line'
);
SELECT poc_test.assert(
  (SELECT count(*)=2 AND bool_and(status='consumed')
     AND bool_and(consumed_attempt_id IS NOT NULL)
   FROM public.daily_statement_backfill_grants
   WHERE id IN (
     '00000000-0000-4000-8000-00000000c0a1',
     '00000000-0000-4000-8000-00000000c0b1'
   )),
  'BISC5: both distinct one-use grants are consumed by their serialized attempts'
);
SELECT poc_test.assert(
  (SELECT count(*)=1
   FROM public.daily_statement_import_events
   WHERE staging_unit_id=poc_test.ctx_get('bisc_b_staging')::uuid
     AND event_type='unit_duplicate'),
  'BISC6: the serialized duplicate decision is append-only audited'
);

SELECT 'BIS set-based concurrency: PASS' AS status;
