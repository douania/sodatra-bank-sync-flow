-- ============================================================================
-- 0H — MATRICE RLS LECTURE PAR RÔLE (données synthétiques déjà déposées)
-- ============================================================================
\set ON_ERROR_STOP on

-- Admin : voit tout.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_export_attempts) > 0
  AND (SELECT count(*) FROM public.daily_statement_units_staging) > 0
  AND (SELECT count(*) FROM public.daily_statement_lines_staging) > 0
  AND (SELECT count(*) FROM public.daily_statement_units_canonical) > 0
  AND (SELECT count(*) FROM public.daily_statement_lines_canonical) > 0
  AND (SELECT count(*) FROM public.daily_statement_import_events) > 0,
  'RLS admin: acces lecture aux 6 tables'
);
ROLLBACK;

-- Manager : attempts + units_staging ; JAMAIS les libellés staging ni le canonical.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_export_attempts) > 0
  AND (SELECT count(*) FROM public.daily_statement_units_staging) > 0
  AND (SELECT count(*) FROM public.daily_statement_lines_staging) = 0
  AND (SELECT count(*) FROM public.daily_statement_units_canonical) = 0
  AND (SELECT count(*) FROM public.daily_statement_lines_canonical) = 0
  AND (SELECT count(*) FROM public.daily_statement_import_events) = 0,
  'RLS manager: attempts + units_staging seulement'
);
ROLLBACK;

-- Auditor : attempts + canonical + events ; jamais le staging.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_auditor());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_export_attempts) > 0
  AND (SELECT count(*) FROM public.daily_statement_units_staging) = 0
  AND (SELECT count(*) FROM public.daily_statement_lines_staging) = 0
  AND (SELECT count(*) FROM public.daily_statement_units_canonical) > 0
  AND (SELECT count(*) FROM public.daily_statement_lines_canonical) > 0
  AND (SELECT count(*) FROM public.daily_statement_import_events) > 0,
  'RLS auditor: attempts + canonical + events seulement'
);
ROLLBACK;

-- Rôle user : aucune policy => zéro ligne partout (fail-closed).
BEGIN;
SELECT poc_test.as_user(poc_test.uid_user());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.daily_statement_export_attempts) = 0
  AND (SELECT count(*) FROM public.daily_statement_units_staging) = 0
  AND (SELECT count(*) FROM public.daily_statement_lines_staging) = 0
  AND (SELECT count(*) FROM public.daily_statement_units_canonical) = 0
  AND (SELECT count(*) FROM public.daily_statement_lines_canonical) = 0
  AND (SELECT count(*) FROM public.daily_statement_import_events) = 0,
  'RLS user: aucun acces au pipeline v2'
);
ROLLBACK;

-- Anon : pas meme le SELECT (privilege table revoque).
BEGIN;
SELECT poc_test.as_anon();
SELECT poc_test.expect_error(
  $$ SELECT count(*) FROM public.daily_statement_export_attempts $$,
  '%permission denied%', 'RLS anon: SELECT refuse par privilege');
ROLLBACK;

SELECT 'RLS read matrix v2: PASS' AS status;
