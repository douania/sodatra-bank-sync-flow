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

-- Sous-payload réel d'une journée, dérivé de la campagne navigateur, pour
-- exercer chaque garde du nouveau cœur sans confondre volume et invariant.
CREATE TEMP TABLE bis_invariant_payload ON COMMIT DROP AS
SELECT
  p.p_attempt,
  jsonb_build_array(p.p_units -> 0) AS p_units,
  (
    SELECT jsonb_agg(l.value ORDER BY l.ord)
    FROM jsonb_array_elements(p.p_lines) WITH ORDINALITY l(value,ord)
    WHERE l.value ->> 'day_unit_id'=p.p_units -> 0 ->> 'day_unit_id'
  ) AS p_lines,
  p.p_guard
FROM poc_test.bis_mass_payload p;

SELECT poc_test.expect_error($date_below$
  SELECT public.pre_ingest_daily_statement_units(
    p_attempt,
    jsonb_set(p_units,'{0,accounting_date}','"31/07/2016"'::jsonb),
    p_lines,p_guard
  ) FROM bis_invariant_payload
$date_below$, '%DAILY_STMT_UNIT_DATE_OUT_OF_PERIOD%',
  'BIS invariant: backfill date below the declared period is rejected');

SELECT poc_test.expect_error($date_above$
  SELECT public.pre_ingest_daily_statement_units(
    p_attempt,
    jsonb_set(p_units,'{0,accounting_date}','"26/08/2026"'::jsonb),
    p_lines,p_guard
  ) FROM bis_invariant_payload
$date_above$, '%DAILY_STMT_UNIT_DATE_OUT_OF_PERIOD%',
  'BIS invariant: backfill date above the declared period is rejected');

SELECT poc_test.expect_error($missing_line$
  SELECT public.pre_ingest_daily_statement_units(
    p_attempt,p_units,p_lines - 0,p_guard
  ) FROM bis_invariant_payload
$missing_line$, '%DAILY_STMT_BIS_BACKFILL_CONTENT_MISMATCH%',
  'BIS invariant: missing line is rejected');

SELECT poc_test.expect_error($excess_line$
  SELECT public.pre_ingest_daily_statement_units(
    p_attempt,p_units,
    p_lines || jsonb_build_array(
      jsonb_set(p_lines -> 0,'{daily_line_hash}',to_jsonb(repeat('e',64)))
    ),p_guard
  ) FROM bis_invariant_payload
$excess_line$, '%DAILY_STMT_BIS_BACKFILL_CONTENT_MISMATCH%',
  'BIS invariant: excess line is rejected');

SELECT poc_test.expect_error($orphan_line$
  SELECT public.pre_ingest_daily_statement_units(
    p_attempt,p_units,
    jsonb_set(p_lines,'{0,day_unit_id}',to_jsonb(repeat('0',64))),p_guard
  ) FROM bis_invariant_payload
$orphan_line$, '%DAILY_STMT_BIS_BACKFILL_LINE_INVALID%',
  'BIS invariant: orphan line is rejected');

SELECT poc_test.expect_error($duplicate_hash$
  SELECT public.pre_ingest_daily_statement_units(
    p_attempt,p_units,p_lines || jsonb_build_array(p_lines -> 0),p_guard
  ) FROM bis_invariant_payload
$duplicate_hash$, '%DAILY_STMT_BIS_BACKFILL_LINE_INVALID%',
  'BIS invariant: duplicate line hash is rejected');

SELECT poc_test.expect_error($dishonest_count$
  SELECT public.pre_ingest_daily_statement_units(
    p_attempt,
    jsonb_set(
      p_units,'{0,line_count}',
      to_jsonb(((p_units -> 0 ->> 'line_count')::integer)+1)
    ),
    p_lines,p_guard
  ) FROM bis_invariant_payload
$dishonest_count$, '%DAILY_STMT_BIS_BACKFILL_CONTENT_MISMATCH%',
  'BIS invariant: dishonest line_count is rejected');

SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_export_attempts
   WHERE account_registry_id='00000000-0000-4000-8000-0000000000f1') = 0
  AND
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE account_registry_id='00000000-0000-4000-8000-0000000000f1') = 0
  AND
  (SELECT count(*)
   FROM public.daily_statement_lines_staging l
   JOIN public.daily_statement_units_staging u ON u.id=l.staging_unit_id
   WHERE u.account_registry_id='00000000-0000-4000-8000-0000000000f1') = 0
  AND
  (SELECT count(*)
   FROM public.daily_statement_import_events e
   JOIN public.daily_statement_export_attempts a ON a.id=e.attempt_id
   WHERE a.account_registry_id='00000000-0000-4000-8000-0000000000f1') = 0
  AND
  (SELECT status='active' AND consumed_attempt_id IS NULL
   FROM public.daily_statement_backfill_grants
   WHERE id='00000000-0000-4000-8000-00000000f857'),
  'BIS invariant: every rejection leaves zero attempt, unit, line, audit and an active grant'
);

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

-- Preuve à la borne structurelle officielle : 4 000 journées distinctes.
-- Cette campagne ferme le finding O(n²) de la contre-review ; une régression
-- vers un rescan corrélé du tableau JSON dépasse la borne de requête.
BEGIN;

INSERT INTO public.daily_statement_account_registry (
  id, created_by, bank, currency, safe_alias, account_fingerprint,
  account_number_masked
) VALUES (
  '00000000-0000-4000-8000-0000000000f1', poc_test.uid_admin(),
  'BIS', 'XOF', 'SYNTHETIC BIS CAP', repeat('f',64), NULL
);

INSERT INTO public.daily_statement_backfill_grants (
  id, account_registry_id, created_by, period_start, period_end, max_units,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000004000',
  '00000000-0000-4000-8000-0000000000f1', poc_test.uid_admin(),
  DATE '2015-09-13', DATE '2026-08-25', 4000,
  TIMESTAMPTZ '2099-01-01 00:00:00+00'
);

SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.ctx_set('bis_cap_started_at', clock_timestamp()::text);
SET LOCAL statement_timeout = '15s';
CREATE TEMP TABLE bis_cap_result AS
SELECT public.pre_ingest_daily_statement_units(p_attempt,p_units,p_lines,p_guard) AS result
FROM poc_test.bis_cap_payload;
SET LOCAL statement_timeout = '0';

SELECT poc_test.assert(
  clock_timestamp() - poc_test.ctx_get('bis_cap_started_at')::timestamptz < interval '15 seconds',
  'BIS-4000 bounded: official structural cap completes inside the 15 second request budget'
);
SELECT poc_test.assert(
  (SELECT jsonb_array_length(result -> 'units') FROM bis_cap_result) = 4000,
  'BIS-4000 result: all 4000 unit decisions returned'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_units_staging
   WHERE account_registry_id='00000000-0000-4000-8000-0000000000f1') = 4000,
  'BIS-4000 persistence: exactly 4000 units staged'
);
SELECT poc_test.assert(
  (SELECT count(*)
   FROM public.daily_statement_lines_staging l
   JOIN public.daily_statement_units_staging u ON u.id=l.staging_unit_id
   WHERE u.account_registry_id='00000000-0000-4000-8000-0000000000f1') = 4000,
  'BIS-4000 persistence: exactly 4000 lines staged'
);
SELECT poc_test.assert(
  (SELECT status='consumed' AND consumed_attempt_id IS NOT NULL
   FROM public.daily_statement_backfill_grants
   WHERE id='00000000-0000-4000-8000-000000004000'),
  'BIS-4000 grant: consumed exactly with the cap attempt'
);

ROLLBACK;

SELECT poc_test.assert(
  NOT EXISTS (SELECT 1 FROM public.daily_statement_account_registry
              WHERE id='00000000-0000-4000-8000-0000000000f1'),
  'BIS-4000 cleanup: outer rollback removes the cap campaign'
);

\echo 'ALL_BIS_MASS_BACKFILL_TIMEOUT_HARDENING_PASS'
