-- ============================================================================
-- DAILY V2 — API READ-ONLY DU VERROU : STRUCTURE + ÉTAT FALSE
-- ============================================================================
\set ON_ERROR_STOP on

SELECT poc_test.assert(
  (
    SELECT count(*) = 1
       AND bool_and(p.prosecdef)
       AND bool_and(p.provolatile = 's')
       AND bool_and(
         p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::text[]
       )
       AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
       AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       AND bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
       AND bool_and(
         NOT EXISTS (
           SELECT 1
           FROM aclexplode(
             COALESCE(p.proacl, acldefault('f', p.proowner))
           ) AS acl
           WHERE acl.grantee = 0
             AND acl.privilege_type = 'EXECUTE'
         )
       )
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'daily_stmt_mutations_enabled'
      AND p.pronargs = 0
  ),
  'runtime-lock-read-api: fonction stable, definer, ACL minimale et search_path epingle'
);

SELECT poc_test.assert(
  public.daily_stmt_mutations_enabled() IS FALSE,
  'runtime-lock-read-api: etat false expose sans acces au schema prive'
);

SELECT poc_test.assert(
  NOT has_schema_privilege('authenticated', 'daily_v2_private', 'USAGE')
  AND NOT has_table_privilege(
    'authenticated',
    'daily_v2_private.runtime_control',
    'SELECT'
  ),
  'runtime-lock-read-api: aucun acces direct au controle prive'
);

\echo 'ALL_RUNTIME_LOCK_READ_API_FALSE_PASS'
