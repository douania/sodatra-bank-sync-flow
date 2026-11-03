-- Lot 1 opérationnel : structure des décisions Daily v2 juste après la migration
-- 20261103120000 (statut `rejected`, garde serveur étendue aux quatre tables de
-- décision, RLS, aucun privilège d'écriture, fonctions internes verrouillées).
\set ON_ERROR_STOP on

SELECT poc_test.assert(
  (SELECT pg_get_constraintdef(c.oid) LIKE '%''rejected''%'
     FROM pg_constraint c WHERE c.conname = 'units_staging_status_domain'),
  'operational: statut rejected admis'
);

-- Treize tables couvertes par la garde serveur de lecture seule (neuf
-- historiques, quatre de décision), quatre opérations, au niveau instruction.
SELECT poc_test.assert(
  (
    SELECT count(*) = 13
       AND bool_and(t.tgtype::integer = 62)
       AND bool_and(t.tgenabled = 'O')
       AND array_agg(c.relname::text ORDER BY c.relname::text) @> ARRAY[
         'daily_statement_attempt_attestations',
         'daily_statement_correction_pieces',
         'daily_statement_refutation_sources',
         'daily_statement_version_refutations'
       ]::text[]
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND t.tgname = 'daily_v2_server_readonly_guard' AND NOT t.tgisinternal
  ),
  'operational: treize tables couvertes par la garde serveur'
);

SELECT poc_test.assert(
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname, c.relname) IN (('public', 'daily_statement_attempt_attestations'),
      ('public', 'daily_statement_correction_pieces'), ('public', 'daily_statement_version_refutations'),
      ('public', 'daily_statement_refutation_sources'), ('daily_v2_private', 'decision_commands'))),
  'operational: RLS active sur les nouvelles tables'
);

SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM (VALUES ('public.daily_statement_attempt_attestations'), ('public.daily_statement_correction_pieces'),
                          ('public.daily_statement_version_refutations'), ('public.daily_statement_refutation_sources'),
                          ('daily_v2_private.decision_commands')) v(t),
                  (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv),
                  (VALUES ('anon'), ('authenticated'), ('service_role')) r(role)
    WHERE has_table_privilege(r.role, v.t, p.priv)),
  'operational: aucun privilège d''écriture directe'
);

SELECT poc_test.assert(
  NOT has_table_privilege('authenticated', 'daily_v2_private.decision_commands', 'SELECT'),
  'operational: clés de commande illisibles par l''API'
);

SELECT poc_test.assert(
  (SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'public' AND p.proname IN ('daily_stmt_version_coherent', 'daily_stmt_version_key',
             'daily_stmt_version_compare', 'daily_stmt_staging_lines_conform', 'daily_stmt_h1_keep_lines',
             'daily_stmt_version_facts', 'daily_stmt_version_sources', 'daily_stmt_attempt_resolved_codes',
             'daily_stmt_batch_candidates', 'daily_stmt_acquire_attempt_lock', 'daily_stmt_require_decision_actor',
             'daily_stmt_pre_ingest_legacy_core_0u', 'daily_stmt_pre_ingest_bis_backfill_core_0v'))
       OR (n.nspname = 'daily_v2_private' AND p.proname IN ('command_begin', 'command_finish'))),
  'operational: fonctions internes et cœurs du dépôt inexécutables par l''API'
);

SELECT poc_test.assert(
  (SELECT count(*) = 7 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND p.prosecdef)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('attest_daily_statement_attempt', 'revoke_daily_statement_attempt_attestation',
      'reject_daily_statement_unit', 'promote_daily_statement_attempt_units', 'supersede_daily_statement_unit_balances',
      'refute_daily_statement_version', 'revoke_daily_statement_version_refutation')),
  'operational: sept commandes exposées à authenticated seul, SECURITY DEFINER'
);

SELECT 'PASS 42_operational_guard' AS marker;
