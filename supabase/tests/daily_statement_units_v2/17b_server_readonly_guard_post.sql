-- ============================================================================
-- DAILY-V2 — GARDE SERVEUR LECTURE SEULE : RETOUR À FALSE + NON-RÉGRESSION
-- ============================================================================
-- À exécuter après toutes les suites mutatrices Daily v2. Le test remet la
-- base locale jetable en lecture seule, vérifie l'audit, l'append-only, le
-- comportement fail-closed sans singleton et l'absence d'écriture partielle.
-- ============================================================================
\set ON_ERROR_STOP on

UPDATE daily_v2_private.runtime_control
SET
  mutations_enabled = false,
  change_reason = 'Restore fail-closed state after synthetic test suite'
WHERE singleton = true;

SELECT poc_test.assert(
  (
    SELECT NOT mutations_enabled
    FROM daily_v2_private.runtime_control
    WHERE singleton = true
  ),
  'server-readonly-post: retour a false effectif'
);

SELECT poc_test.assert(
  (
    SELECT count(*) = 3
       AND (array_agg(new_enabled ORDER BY event_id))[1] = false
       AND (array_agg(new_enabled ORDER BY event_id))[2] = true
       AND (array_agg(new_enabled ORDER BY event_id))[3] = false
       AND bool_and(char_length(btrim(safe_reason)) BETWEEN 8 AND 240)
       AND bool_and(session_actor IS NOT NULL)
       AND bool_and(effective_actor IS NOT NULL)
       AND bool_and(transaction_id > 0)
    FROM daily_v2_private.runtime_control_events
  ),
  'server-readonly-post: sequence false-true-false auditee'
);

SELECT poc_test.expect_error(
  $$UPDATE daily_v2_private.runtime_control_events SET safe_reason = safe_reason WHERE false$$,
  '%DAILY_V2_RUNTIME_CONTROL_EVENTS_APPEND_ONLY%',
  'server-readonly-post: journal UPDATE append-only'
);

SELECT poc_test.expect_error(
  $$DELETE FROM daily_v2_private.runtime_control WHERE singleton = true$$,
  '%DAILY_V2_RUNTIME_CONTROL_DELETE_FORBIDDEN%',
  'server-readonly-post: singleton non supprimable'
);

SELECT poc_test.expect_error(
  $$TRUNCATE daily_v2_private.runtime_control$$,
  '%DAILY_V2_RUNTIME_CONTROL_DELETE_FORBIDDEN%',
  'server-readonly-post: singleton non tronquable'
);

CREATE TEMP TABLE runtime_guard_post_counts AS
SELECT
  (SELECT count(*) FROM public.daily_statement_account_registry) AS registry_count,
  (SELECT count(*) FROM public.daily_statement_account_events) AS account_events_count,
  (SELECT count(*) FROM public.daily_statement_export_attempts) AS attempts_count;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  $$SELECT public.provision_daily_statement_account('BICIS','XOF','SERVER READONLY POST','****9999')$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'server-readonly-post: RPC admin refusee apres retour false'
);
COMMIT;

SELECT poc_test.assert(
  (
    SELECT
      (SELECT count(*) FROM public.daily_statement_account_registry) = registry_count
      AND
      (SELECT count(*) FROM public.daily_statement_account_events) = account_events_count
      AND
      (SELECT count(*) FROM public.daily_statement_export_attempts) = attempts_count
    FROM runtime_guard_post_counts
  ),
  'server-readonly-post: aucune ecriture partielle apres refus RPC'
);

-- Preuve fail-closed lorsque la ligne est absente. Le superuser local désactive
-- temporairement et explicitement le trigger anti-suppression dans une
-- transaction entièrement rollbackée ; aucun environnement live n'est visé.
BEGIN;
ALTER TABLE daily_v2_private.runtime_control
  DISABLE TRIGGER daily_v2_runtime_control_prepare;
DELETE FROM daily_v2_private.runtime_control WHERE singleton = true;
ALTER TABLE daily_v2_private.runtime_control
  ENABLE TRIGGER daily_v2_runtime_control_prepare;

SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1
    FROM daily_v2_private.runtime_control
    WHERE singleton = true
  ),
  'server-readonly-post: precondition singleton absent'
);

SELECT poc_test.expect_error(
  $$UPDATE public.daily_statement_import_events SET event_type = event_type WHERE false$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'server-readonly-post: singleton absent reste fail-closed'
);
ROLLBACK;

SELECT poc_test.assert(
  (
    SELECT NOT mutations_enabled
    FROM daily_v2_private.runtime_control
    WHERE singleton = true
  ),
  'server-readonly-post: rollback restaure singleton false'
);

SELECT poc_test.assert(
  (SELECT count(*) FROM daily_v2_private.runtime_control_events) = 3,
  'server-readonly-post: test absence rollbacke sans faux evenement'
);

\echo 'ALL_SERVER_READONLY_GUARD_POST_PASS'
