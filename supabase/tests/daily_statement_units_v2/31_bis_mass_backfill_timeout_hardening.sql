-- =============================================================================
-- BIS MASS BACKFILL — ATOMICITÉ ET BORNE DE TIMEOUT (SYNTHÉTIQUE)
-- =============================================================================
\set ON_ERROR_STOP on

SELECT poc_test.assert(
  NOT has_function_privilege('anon',
    'public.daily_stmt_pre_ingest_bis_backfill_core_0v(jsonb,jsonb,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.daily_stmt_pre_ingest_bis_backfill_core_0v(jsonb,jsonb,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('service_role',
    'public.daily_stmt_pre_ingest_bis_backfill_core_0v(jsonb,jsonb,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.daily_stmt_append_audit_events_0v(jsonb)','EXECUTE'),
  'BIS-857 ACL: optimized core and batch audit writer remain internal'
);

BEGIN;

INSERT INTO public.daily_statement_account_registry (
  id, created_by, bank, currency, safe_alias, account_fingerprint,
  account_number_masked
) VALUES (
  '00000000-0000-4000-8000-0000000000f1', poc_test.uid_admin(),
  'BIS', 'XOF', 'SYNTHETIC BIS MASS', repeat('f',64), NULL
);

INSERT INTO public.daily_statement_backfill_grants (
  id, account_registry_id, created_by, period_start, period_end, max_units,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000f857',
  '00000000-0000-4000-8000-0000000000f1', poc_test.uid_admin(),
  DATE '2016-08-01', DATE '2026-08-25', 857,
  TIMESTAMPTZ '2099-01-01 00:00:00+00'
);

SELECT poc_test.as_user(poc_test.uid_admin());

-- Erreur tardive : le cœur a fini ses écritures, puis le wrapper détecte que
-- des motifs de revue portent un status "valid". La sous-transaction de
-- expect_error doit rendre absolument toutes les écritures et le verrou grant.
SELECT poc_test.expect_error($atomic$
  SELECT public.pre_ingest_daily_statement_units(
    p_attempt,
    jsonb_set(p_units, '{0,validation_status}', '"valid"'::jsonb),
    p_lines,
    p_guard
  )
  FROM poc_test.bis_mass_payload
$atomic$, '%DAILY_STMT_REVIEW_STATUS_MISMATCH%',
  'BIS-857 atomic: late wrapper rejection rolls back the whole core ingest');

SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_export_attempts
   WHERE account_registry_id='00000000-0000-4000-8000-0000000000f1') = 0
  AND
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE account_registry_id='00000000-0000-4000-8000-0000000000f1') = 0
  AND
  (SELECT status FROM public.daily_statement_backfill_grants
   WHERE id='00000000-0000-4000-8000-00000000f857') = 'active',
  'BIS-857 atomic: no attempt, unit or grant consumption survives rejection'
);

SELECT poc_test.ctx_set('bis_mass_started_at', clock_timestamp()::text);
SET LOCAL statement_timeout = '15s';
CREATE TEMP TABLE bis_mass_result AS
SELECT public.pre_ingest_daily_statement_units(p_attempt,p_units,p_lines,p_guard) AS result
FROM poc_test.bis_mass_payload;
SET LOCAL statement_timeout = '0';

SELECT poc_test.assert(
  clock_timestamp() - poc_test.ctx_get('bis_mass_started_at')::timestamptz < interval '15 seconds',
  'BIS-857 bounded: atomic ingest completes inside the 15 second request budget'
);
SELECT poc_test.assert(
  (SELECT jsonb_array_length(result -> 'units') FROM bis_mass_result) = 857,
  'BIS-857 result: all 857 unit decisions returned'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE account_registry_id='00000000-0000-4000-8000-0000000000f1') = 857,
  'BIS-857 persistence: exactly 857 units staged'
);
SELECT poc_test.assert(
  (SELECT count(*)
   FROM public.daily_statement_lines_staging l
   JOIN public.daily_statement_units_staging u ON u.id=l.staging_unit_id
   WHERE u.account_registry_id='00000000-0000-4000-8000-0000000000f1') = 4798,
  'BIS-857 persistence: exactly 4798 lines staged'
);
SELECT poc_test.assert(
  (SELECT bool_and(cardinality(review_reason_codes)=4)
   FROM public.daily_statement_units_staging
   WHERE account_registry_id='00000000-0000-4000-8000-0000000000f1'),
  'BIS-857 review: every unit retains four reason codes'
);
SELECT poc_test.assert(
  (SELECT count(*)
   FROM public.daily_statement_import_events e
   JOIN public.daily_statement_export_attempts a ON a.id=e.attempt_id
   WHERE a.account_registry_id='00000000-0000-4000-8000-0000000000f1'
     AND e.safe_message='review reason recorded') = 857 * 4,
  'BIS-857 audit: one append-only event per review reason'
);
SELECT poc_test.assert(
  (SELECT status='consumed' AND consumed_attempt_id IS NOT NULL
   FROM public.daily_statement_backfill_grants
   WHERE id='00000000-0000-4000-8000-00000000f857'),
  'BIS-857 grant: consumed exactly with the successful atomic attempt'
);

ROLLBACK;

SELECT poc_test.assert(
  NOT EXISTS (SELECT 1 FROM public.daily_statement_account_registry
              WHERE id='00000000-0000-4000-8000-0000000000f1'),
  'BIS-857 cleanup: outer rollback removes the complete synthetic campaign'
);

\echo 'ALL_BIS_MASS_BACKFILL_TIMEOUT_HARDENING_PASS'
