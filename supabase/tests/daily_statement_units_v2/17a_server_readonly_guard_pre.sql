-- ============================================================================
-- DAILY-V2 — GARDE SERVEUR LECTURE SEULE : STRUCTURE + FAIL-CLOSED INITIAL
-- ============================================================================
-- À exécuter immédiatement après la migration
-- 20260730170000_daily_v2_server_readonly_guard.sql, avant les scénarios E2E
-- mutateurs. Le fichier vérifie l'état false initial puis active explicitement
-- la base locale jetable afin que toutes les suites existantes s'exécutent
-- derrière la garde.
-- ============================================================================
\set ON_ERROR_STOP on

-- Schéma privé : aucun rôle applicatif ne peut même résoudre ses objets.
SELECT poc_test.assert(
  NOT has_schema_privilege('anon', 'daily_v2_private', 'USAGE')
  AND NOT has_schema_privilege('authenticated', 'daily_v2_private', 'USAGE')
  AND NOT has_schema_privilege('service_role', 'daily_v2_private', 'USAGE'),
  'server-readonly: schema prive inaccessible aux roles applicatifs'
);

SELECT poc_test.assert(
  (
    SELECT count(*) = 2
       AND bool_and(relrowsecurity)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'daily_v2_private'
      AND c.relname IN ('runtime_control', 'runtime_control_events')
      AND c.relkind = 'r'
  ),
  'server-readonly: tables de controle internes avec RLS active'
);

SELECT poc_test.assert(
  (
    WITH app_roles(role_name) AS (
      VALUES ('anon'), ('authenticated'), ('service_role')
    )
    SELECT count(*) = 6
       AND bool_and(NOT has_table_privilege(r.role_name, c.oid, 'SELECT'))
       AND bool_and(NOT has_table_privilege(r.role_name, c.oid, 'INSERT'))
       AND bool_and(NOT has_table_privilege(r.role_name, c.oid, 'UPDATE'))
       AND bool_and(NOT has_table_privilege(r.role_name, c.oid, 'DELETE'))
       AND bool_and(NOT has_table_privilege(r.role_name, c.oid, 'TRUNCATE'))
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN app_roles r
    WHERE n.nspname = 'daily_v2_private'
      AND c.relname IN ('runtime_control', 'runtime_control_events')
      AND c.relkind = 'r'
  ),
  'server-readonly: aucun privilege applicatif sur controle et journal'
);

-- Les trois fonctions qui lisent/écrivent les objets privés sont
-- SECURITY DEFINER. Le trigger de préparation reste SECURITY INVOKER afin que
-- current_user capture réellement le rôle opérateur. Toutes ont un search_path
-- épinglé et restent inexécutables par les rôles de l'API.
SELECT poc_test.assert(
  (
    SELECT count(*) = 4
       AND count(*) FILTER (
         WHERE p.prosecdef
           AND p.proname IN (
             'append_runtime_control_event',
             'block_runtime_control_event_mutation',
             'enforce_daily_statement_mutation_guard'
           )
       ) = 3
       AND count(*) FILTER (
         WHERE NOT p.prosecdef
           AND p.proname = 'prepare_runtime_control_change'
       ) = 1
       AND bool_and(
         p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]
       )
       AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
       AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       AND bool_and(NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'daily_v2_private'
      AND p.proname IN (
        'prepare_runtime_control_change',
        'append_runtime_control_event',
        'block_runtime_control_event_mutation',
        'enforce_daily_statement_mutation_guard'
      )
  ),
  'server-readonly: fonctions privees verrouillees et search_path epingle'
);

-- Exactement les neuf tables Daily v2 sont couvertes. tgtype=62 signifie :
-- BEFORE + INSERT + DELETE + UPDATE + TRUNCATE, FOR EACH STATEMENT (bit ROW
-- absent).
SELECT poc_test.assert(
  (
    SELECT count(*) = 9
       AND bool_and(t.tgtype::integer = 62)
       AND bool_and(t.tgenabled = 'O')
       AND array_agg(c.relname::text ORDER BY c.relname::text) = ARRAY[
         'daily_statement_account_events',
         'daily_statement_account_registry',
         'daily_statement_backfill_grants',
         'daily_statement_export_attempts',
         'daily_statement_import_events',
         'daily_statement_lines_canonical',
         'daily_statement_lines_staging',
         'daily_statement_units_canonical',
         'daily_statement_units_staging'
       ]::text[]
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND t.tgname = 'daily_v2_server_readonly_guard'
      AND NOT t.tgisinternal
      AND pn.nspname = 'daily_v2_private'
      AND p.proname = 'enforce_daily_statement_mutation_guard'
  ),
  'server-readonly: neuf tables et quatre operations couvertes'
);

SELECT poc_test.assert(
  (
    WITH expected(table_name, trigger_name, trigger_type) AS (
      VALUES
        ('runtime_control', 'daily_v2_runtime_control_prepare', 27),
        ('runtime_control', 'daily_v2_runtime_control_no_truncate', 34),
        ('runtime_control', 'daily_v2_runtime_control_audit', 17),
        ('runtime_control_events', 'daily_v2_runtime_control_events_append_only', 58)
    )
    SELECT count(*) = 4
       AND bool_and(t.tgenabled = 'O')
       AND bool_and(t.tgtype::integer = e.trigger_type)
    FROM expected e
    JOIN pg_catalog.pg_namespace n ON n.nspname = 'daily_v2_private'
    JOIN pg_catalog.pg_class c
      ON c.relnamespace = n.oid
     AND c.relname = e.table_name
    JOIN pg_catalog.pg_trigger t
      ON t.tgrelid = c.oid
     AND t.tgname = e.trigger_name
     AND NOT t.tgisinternal
  ),
  'server-readonly: triggers controle et journal actifs'
);

SELECT poc_test.assert(
  (
    SELECT singleton
       AND NOT mutations_enabled
       AND change_reason = 'Initial fail-closed state installed by migration'
    FROM daily_v2_private.runtime_control
  ),
  'server-readonly: singleton initial false'
);

SELECT poc_test.assert(
  (
    SELECT count(*) = 1
       AND bool_and(previous_enabled IS NULL)
       AND bool_and(NOT new_enabled)
    FROM daily_v2_private.runtime_control_events
  ),
  'server-readonly: etat initial journalise'
);

-- Même une commande sans ligne cible doit être refusée : preuve que la garde
-- est statement-level et ne dépend pas d'un payload valide.
SELECT poc_test.expect_error(
  $$UPDATE public.daily_statement_units_staging SET status = status WHERE false$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'server-readonly: UPDATE zero-row refuse'
);

SELECT poc_test.expect_error(
  $$DELETE FROM public.daily_statement_units_staging WHERE false$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'server-readonly: DELETE zero-row refuse'
);

SELECT poc_test.expect_error(
  $$TRUNCATE public.daily_statement_lines_staging$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'server-readonly: TRUNCATE refuse'
);

CREATE TEMP TABLE runtime_guard_pre_counts AS
SELECT
  (SELECT count(*) FROM public.daily_statement_account_registry) AS registry_count,
  (SELECT count(*) FROM public.daily_statement_account_events) AS account_events_count;

BEGIN;
SELECT poc_test.as_user(poc_test.uid_admin());
SELECT poc_test.expect_error(
  $$SELECT public.provision_daily_statement_account('BDK','XOF','SERVER READONLY PROBE','****0000')$$,
  '%DAILY_V2_SERVER_READ_ONLY%',
  'server-readonly: RPC admin refusee quand false'
);
COMMIT;

SELECT poc_test.assert(
  (
    SELECT
      (SELECT count(*) FROM public.daily_statement_account_registry) = registry_count
      AND
      (SELECT count(*) FROM public.daily_statement_account_events) = account_events_count
    FROM runtime_guard_pre_counts
  ),
  'server-readonly: refus RPC sans ecriture partielle'
);

-- Activation UNIQUEMENT pour cette base Docker jetable. Un rôle opérateur
-- synthétique distinct du propriétaire prouve que l'acteur effectif journalisé
-- n'est pas écrasé par la frontière SECURITY DEFINER du trigger d'audit. En
-- environnement Supabase, cette bascule exige un GO exact et ne fait pas partie
-- de la migration partagée.
CREATE ROLE poc_test_runtime_operator NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA daily_v2_private TO poc_test_runtime_operator;
GRANT SELECT, UPDATE ON TABLE daily_v2_private.runtime_control
  TO poc_test_runtime_operator;

SET ROLE poc_test_runtime_operator;
UPDATE daily_v2_private.runtime_control
SET
  mutations_enabled = true,
  change_reason = 'Enable synthetic disposable PostgreSQL test suite'
WHERE singleton = true;
RESET ROLE;

SELECT poc_test.assert(
  (
    SELECT mutations_enabled
    FROM daily_v2_private.runtime_control
    WHERE singleton = true
  ),
  'server-readonly: activation operateur locale effective'
);

SELECT poc_test.assert(
  (
    SELECT count(*) = 2
       AND bool_and(safe_reason <> '')
       AND bool_and(session_actor IS NOT NULL)
       AND bool_and(effective_actor IS NOT NULL)
       AND (
         SELECT effective_actor = 'poc_test_runtime_operator'::name
         FROM daily_v2_private.runtime_control_events
         ORDER BY event_id DESC
         LIMIT 1
       )
    FROM daily_v2_private.runtime_control_events
  ),
  'server-readonly: activation locale auditee avec acteur effectif exact'
);

REVOKE ALL ON TABLE daily_v2_private.runtime_control
  FROM poc_test_runtime_operator;
REVOKE ALL ON SCHEMA daily_v2_private
  FROM poc_test_runtime_operator;
DROP ROLE poc_test_runtime_operator;

\echo 'ALL_SERVER_READONLY_GUARD_PRE_PASS'
