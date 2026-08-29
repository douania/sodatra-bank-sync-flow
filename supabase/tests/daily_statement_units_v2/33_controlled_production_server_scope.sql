-- ============================================================================
-- DAILY-V2 — SCOPES SERVEUR DU PILOTE PRODUCTION : STRUCTURE + E2E NEGATIF
-- ============================================================================
-- Base PostgreSQL jetable uniquement. La migration est appliquée alors que le
-- kill switch maître est true afin de prouver la préservation de l'état, puis
-- une transaction rollbackée simule daily=true/admin=false/backfill=false.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT poc_test.assert(
  (
    SELECT count(*) = 3
       AND bool_and(is_nullable = 'NO')
       AND bool_and(column_default = 'false')
    FROM information_schema.columns
    WHERE table_schema = 'daily_v2_private'
      AND table_name = 'runtime_control'
      AND column_name IN (
        'daily_scope_enabled',
        'admin_scope_enabled',
        'backfill_scope_enabled'
      )
  ),
  'server-scope: trois scopes prives NOT NULL et fermes par defaut'
);

SELECT poc_test.assert(
  (
    SELECT count(*) = 6
    FROM information_schema.columns
    WHERE table_schema = 'daily_v2_private'
      AND table_name = 'runtime_control_events'
      AND column_name IN (
        'previous_daily_scope_enabled', 'new_daily_scope_enabled',
        'previous_admin_scope_enabled', 'new_admin_scope_enabled',
        'previous_backfill_scope_enabled', 'new_backfill_scope_enabled'
      )
  ),
  'server-scope: transitions des trois scopes auditables'
);

SELECT poc_test.assert(
  (
    SELECT count(*) = 1
       AND bool_and(p.prosecdef)
       AND bool_and(
         p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]
       )
       AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
       AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       AND bool_and(NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
       AND bool_and(
         NOT EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         )
       )
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'daily_v2_private'
      AND p.proname = 'assert_runtime_scope'
      AND p.pronargs = 1
  ),
  'server-scope: assertion privee definer, search_path epingle et ACL fermee'
);

SELECT poc_test.assert(
  (
    WITH core_names(name) AS (
      VALUES
        ('daily_stmt_pre_ingest_scoped_core_0w'),
        ('daily_stmt_promote_scoped_core_0w'),
        ('daily_stmt_supersede_scoped_core_0w'),
        ('daily_stmt_provision_account_scoped_core_0w'),
        ('daily_stmt_deactivate_account_scoped_core_0w'),
        ('daily_stmt_adopt_historical_scoped_core_0w'),
        ('daily_stmt_issue_backfill_grant_scoped_core_0w'),
        ('daily_stmt_revoke_backfill_grant_scoped_core_0w')
    )
    SELECT count(*) = 8
       AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
       AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       AND bool_and(NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
       AND bool_and(
         NOT EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         )
       )
    FROM core_names expected
    JOIN pg_catalog.pg_proc p ON p.proname = expected.name
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ),
  'server-scope: huit coeurs mutatifs inaccessibles aux roles API et PUBLIC'
);

SELECT poc_test.assert(
  (
    WITH wrapper_names(name) AS (
      VALUES
        ('pre_ingest_daily_statement_units'),
        ('promote_daily_statement_unit'),
        ('supersede_daily_statement_unit'),
        ('provision_daily_statement_account'),
        ('deactivate_daily_statement_account'),
        ('adopt_daily_statement_historical_account'),
        ('issue_daily_statement_backfill_grant'),
        ('revoke_daily_statement_backfill_grant')
    )
    SELECT count(*) = 8
       AND bool_and(p.prosecdef)
       AND bool_and(
         p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
       )
       AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
       AND bool_and(NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
       AND bool_and(
         NOT EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         )
       )
    FROM wrapper_names expected
    JOIN pg_catalog.pg_proc p ON p.proname = expected.name
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ),
  'server-scope: huit wrappers definer exposes au seul role authenticated'
);

-- La migration reprend l'état true du kill switch local : aucune régression
-- du staging ouvert, et l'initialisation est auditée sans réécrire l'historique.
SELECT poc_test.assert(
  (
    SELECT mutations_enabled
       AND daily_scope_enabled
       AND admin_scope_enabled
       AND backfill_scope_enabled
    FROM daily_v2_private.runtime_control
    WHERE singleton = true
  ),
  'server-scope: etat existant preserve lors de la migration'
);

SELECT poc_test.assert(
  public.daily_stmt_mutations_enabled() IS TRUE,
  'server-scope: API read-only expose master AND daily'
);

SELECT poc_test.assert(
  (
    SELECT (SELECT count(*) FROM daily_v2_private.runtime_control_events) = 3
       AND previous_daily_scope_enabled IS NULL
       AND new_daily_scope_enabled
       AND previous_admin_scope_enabled IS NULL
       AND new_admin_scope_enabled
       AND previous_backfill_scope_enabled IS NULL
       AND new_backfill_scope_enabled
       AND safe_reason = 'Initialize scoped runtime control from existing master lock'
    FROM daily_v2_private.runtime_control_events
    ORDER BY event_id DESC
    LIMIT 1
  ),
  'server-scope: initialisation state-preserving auditee'
);

-- Simulation exacte du pilote production : master ouvert, daily ouvert,
-- admin/backfill fermés. Toute la transaction est rollbackée ensuite.
BEGIN;
UPDATE daily_v2_private.runtime_control
SET
  daily_scope_enabled = true,
  admin_scope_enabled = false,
  backfill_scope_enabled = false,
  change_reason = 'Simulate daily-only production pilot in disposable test'
WHERE singleton = true;

SELECT poc_test.assert(
  public.daily_stmt_mutations_enabled() IS TRUE,
  'server-scope: daily reste visible pendant le pilote selectif'
);

CREATE TEMP TABLE server_scope_pre_counts AS
SELECT
  (SELECT count(*) FROM public.daily_statement_account_registry) AS registry_count,
  (SELECT count(*) FROM public.daily_statement_backfill_grants) AS grants_count,
  (SELECT count(*) FROM public.daily_statement_export_attempts) AS attempts_count,
  (SELECT count(*) FROM public.daily_statement_import_events) AS import_events_count,
  (SELECT count(*) FROM public.daily_statement_account_events) AS account_events_count;

SELECT poc_test.as_user(poc_test.uid_admin());

-- Scope admin : trois chemins directs refusés avant toute logique métier.
SELECT poc_test.expect_error(
  $$SELECT public.provision_daily_statement_account('BDK','XOF','SCOPE PROBE','****0000')$$,
  '%DAILY_V2_RUNTIME_SCOPE_DISABLED: admin%',
  'server-scope: provisionnement direct refuse'
);
SELECT poc_test.expect_error(
  $$SELECT public.deactivate_daily_statement_account('00000000-0000-4000-8000-000000000001','synthetic reason')$$,
  '%DAILY_V2_RUNTIME_SCOPE_DISABLED: admin%',
  'server-scope: desactivation directe refusee'
);
SELECT poc_test.expect_error(
  $$SELECT public.adopt_daily_statement_historical_account('BDK','XOF','SCOPE PROBE')$$,
  '%DAILY_V2_RUNTIME_SCOPE_DISABLED: admin%',
  'server-scope: adoption historique directe refusee'
);

-- Scope backfill : grant, révocation et même RPC d'ingestion partagée sont
-- refusés d'après requested_mode, avant validation du reste du payload.
SELECT poc_test.expect_error(
  $$SELECT public.issue_daily_statement_backfill_grant('00000000-0000-4000-8000-000000000001','2026-01-01','2026-01-02',2,now()+interval '1 hour')$$,
  '%DAILY_V2_RUNTIME_SCOPE_DISABLED: backfill%',
  'server-scope: emission de grant directe refusee'
);
SELECT poc_test.expect_error(
  $$SELECT public.revoke_daily_statement_backfill_grant('00000000-0000-4000-8000-000000000001','synthetic reason')$$,
  '%DAILY_V2_RUNTIME_SCOPE_DISABLED: backfill%',
  'server-scope: revocation de grant directe refusee'
);
SELECT poc_test.expect_error(
  $$SELECT public.pre_ingest_daily_statement_units('{"requested_mode":"backfill"}'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb)$$,
  '%DAILY_V2_RUNTIME_SCOPE_DISABLED: backfill%',
  'server-scope: backfill via RPC ingestion partagee refuse'
);

-- Les trois chemins daily franchissent leur scope puis échouent sur leurs
-- invariants métier synthétiques : ils ne sont pas faussement bloqués.
SELECT poc_test.expect_error(
  $$SELECT public.pre_ingest_daily_statement_units('{"requested_mode":"daily"}'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb)$$,
  '%DAILY_STMT_ACCOUNT_REGISTRY_ID_REQUIRED%',
  'server-scope: depot daily atteint le coeur metier'
);
SELECT poc_test.expect_error(
  $$SELECT public.promote_daily_statement_unit('00000000-0000-4000-8000-000000000001',NULL)$$,
  '%DAILY_STMT_STAGING_NOT_FOUND%',
  'server-scope: promotion daily atteint le coeur metier'
);
SELECT poc_test.expect_error(
  $$SELECT public.supersede_daily_statement_unit('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','synthetic reason')$$,
  '%DAILY_STMT_STAGING_NOT_FOUND%',
  'server-scope: supersede daily atteint le coeur metier'
);

SELECT poc_test.as_super();

SELECT poc_test.assert(
  (
    SELECT
      (SELECT count(*) FROM public.daily_statement_account_registry) = registry_count
      AND (SELECT count(*) FROM public.daily_statement_backfill_grants) = grants_count
      AND (SELECT count(*) FROM public.daily_statement_export_attempts) = attempts_count
      AND (SELECT count(*) FROM public.daily_statement_import_events) = import_events_count
      AND (SELECT count(*) FROM public.daily_statement_account_events) = account_events_count
    FROM server_scope_pre_counts
  ),
  'server-scope: aucun refus ne produit une ecriture partielle'
);
ROLLBACK;

SELECT poc_test.assert(
  (
    SELECT mutations_enabled
       AND daily_scope_enabled
       AND admin_scope_enabled
       AND backfill_scope_enabled
    FROM daily_v2_private.runtime_control
    WHERE singleton = true
  ),
  'server-scope: simulation rollbackee, suite historique entierement ouverte'
);

SELECT poc_test.assert(
  (SELECT count(*) FROM daily_v2_private.runtime_control_events) = 3,
  'server-scope: simulation rollbackee sans faux evenement durable'
);

\echo 'ALL_CONTROLLED_PRODUCTION_SERVER_SCOPE_PASS'
