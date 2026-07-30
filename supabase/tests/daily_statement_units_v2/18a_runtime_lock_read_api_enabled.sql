-- ============================================================================
-- DAILY V2 — API READ-ONLY DU VERROU : ÉTAT TRUE LOCAL JETABLE
-- ============================================================================
\set ON_ERROR_STOP on

SELECT poc_test.assert(
  public.daily_stmt_mutations_enabled() IS TRUE,
  'runtime-lock-read-api: activation locale jetable refletee dynamiquement'
);

\echo 'ALL_RUNTIME_LOCK_READ_API_TRUE_PASS'
