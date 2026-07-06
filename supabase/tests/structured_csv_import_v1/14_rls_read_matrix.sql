-- ============================================================================
-- 0U — MATRICE RLS DE LECTURE (T2) — exécuté APRÈS les scénarios pipeline
-- ============================================================================
-- Attendu (0T §5 + décisions CTO 3/4) :
--   admin   : attempts, staging, lines_staging, canonical, lines_canonical, events
--   manager : attempts, staging (headers) — RIEN d'autre
--   auditor : attempts, canonical, lines_canonical, events — pas de staging
--   user    : RIEN (fail-closed)
--   anon    : permission denied partout
-- ============================================================================
\set ON_ERROR_STOP on

-- admin : tout visible.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_attempts) > 0
  AND (SELECT count(*) FROM public.bank_statement_staging) > 0
  AND (SELECT count(*) FROM public.bank_statement_lines_staging) > 0
  AND (SELECT count(*) FROM public.bank_statement_canonical) > 0
  AND (SELECT count(*) FROM public.bank_statement_lines_canonical) > 0
  AND (SELECT count(*) FROM public.bank_statement_import_events) > 0,
  'T2 admin voit les 6 tables');
COMMIT;

-- manager : attempts + staging headers uniquement.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_manager());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_attempts) > 0
  AND (SELECT count(*) FROM public.bank_statement_staging) > 0,
  'T2 manager voit attempts + staging headers');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_lines_staging) = 0
  AND (SELECT count(*) FROM public.bank_statement_canonical) = 0
  AND (SELECT count(*) FROM public.bank_statement_lines_canonical) = 0
  AND (SELECT count(*) FROM public.bank_statement_import_events) = 0,
  'T2 manager ne voit NI lignes NI canonical NI events');
COMMIT;

-- auditor : attempts + canonical (headers + lignes) + events, pas de staging.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_auditor());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_attempts) > 0
  AND (SELECT count(*) FROM public.bank_statement_canonical) > 0
  AND (SELECT count(*) FROM public.bank_statement_lines_canonical) > 0
  AND (SELECT count(*) FROM public.bank_statement_import_events) > 0,
  'T2 auditor voit attempts + canonical + lignes + events');
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_staging) = 0
  AND (SELECT count(*) FROM public.bank_statement_lines_staging) = 0,
  'T2 auditor ne voit pas le staging');
COMMIT;

-- user : zéro accès (CTO-4), y compris après attribution auto du rôle user.
BEGIN;
SELECT poc_test.as_user(poc_test.uid_user());
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_attempts) = 0
  AND (SELECT count(*) FROM public.bank_statement_staging) = 0
  AND (SELECT count(*) FROM public.bank_statement_lines_staging) = 0
  AND (SELECT count(*) FROM public.bank_statement_canonical) = 0
  AND (SELECT count(*) FROM public.bank_statement_lines_canonical) = 0
  AND (SELECT count(*) FROM public.bank_statement_import_events) = 0,
  'T2/CTO-4 user ne voit RIEN sur les 6 tables');
COMMIT;

-- anon : permission denied partout (pas seulement 0 ligne).
BEGIN;
SELECT poc_test.as_anon();
SELECT poc_test.expect_error(
  $neg$ SELECT count(*) FROM public.bank_statement_import_attempts $neg$,
  '%permission denied%', 'T2 anon: attempts refuse');
SELECT poc_test.expect_error(
  $neg$ SELECT count(*) FROM public.bank_statement_canonical $neg$,
  '%permission denied%', 'T2 anon: canonical refuse');
SELECT poc_test.expect_error(
  $neg$ SELECT count(*) FROM public.bank_statement_import_events $neg$,
  '%permission denied%', 'T2 anon: events refuse');
ROLLBACK;

-- Un utilisateur authentifié SANS ligne user_roles ne voit rien.
BEGIN;
SELECT poc_test.as_user('99999999-9999-4999-8999-999999999999'::uuid);
SELECT poc_test.assert(
  (SELECT count(*) FROM public.bank_statement_import_attempts) = 0,
  'T2 authentifie sans role applicatif: aucun acces (SECURITY_CONTRACT §2)');
COMMIT;

SELECT 'matrice RLS lecture: PASS' AS status;
