-- ============================================================================
-- 0U — TESTS STRUCTURE & PRIVILÈGES (T8, no-enum, index, RLS, EXECUTE)
-- ============================================================================
\set ON_ERROR_STOP on

-- T8 : aucune colonne raw/compte complet sur les 6 tables du pipeline.
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'bank_statement_import_attempts', 'bank_statement_staging',
        'bank_statement_lines_staging', 'bank_statement_canonical',
        'bank_statement_lines_canonical', 'bank_statement_import_events')
      AND column_name IN (
        'raw_csv', 'raw_text', 'raw_bytes', 'raw_content', 'file_content',
        'account_number', 'iban')
  ),
  'T8 aucune colonne raw/account_number/iban'
);

-- Décision CTO 5 : aucun enum Postgres créé par la migration.
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
      AND t.typname IN (
        'structured_import_attempt_status', 'structured_parser_validation_status',
        'structured_import_event_type', 'structured_promotion_status',
        'structured_conflict_status')
  ),
  'CTO-5 aucun enum structured_* cree'
);

-- Les 6 tables existent et RLS est active.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bank_statement_import_attempts', 'bank_statement_staging',
    'bank_statement_lines_staging', 'bank_statement_canonical',
    'bank_statement_lines_canonical', 'bank_statement_import_events'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'TEST_FAILED: RLS non active sur %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: RLS active sur les 6 tables';
END $$;

-- Index attendus (dont les 2 uniques partiels critiques Option A / actif).
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uq_canonical_active_import_id';
  IF v_def IS NULL OR v_def NOT ILIKE '%UNIQUE%' OR v_def NOT ILIKE '%WHERE%ingested%' THEN
    RAISE EXCEPTION 'TEST_FAILED: uq_canonical_active_import_id absent ou non partiel';
  END IF;

  SELECT indexdef INTO v_def FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uq_lines_canonical_line_hash_active';
  IF v_def IS NULL OR v_def NOT ILIKE '%UNIQUE%' OR v_def NOT ILIKE '%WHERE%is_active%' THEN
    RAISE EXCEPTION 'TEST_FAILED: uq_lines_canonical_line_hash_active absent ou non partiel';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                 AND indexname = 'uq_lines_canonical_line_hash_per_statement') THEN
    RAISE EXCEPTION 'TEST_FAILED: uq_lines_canonical_line_hash_per_statement absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                 AND indexname = 'idx_events_attempt_id') THEN
    RAISE EXCEPTION 'TEST_FAILED: idx_events_attempt_id absent';
  END IF;
  RAISE NOTICE 'OK: index critiques presents (Option A incluse)';
END $$;

-- Trigger anti-promote présent sur canonical.
SELECT poc_test.assert(
  EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE c.relname = 'bank_statement_canonical'
      AND tg.tgname = 'trg_canonical_anti_promote'),
  'trigger anti-promote present'
);

-- Policies : exactement 6 SELECT, zéro policy d'écriture (décision CTO 7).
SELECT poc_test.assert(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'bank_statement_%'
     AND cmd <> 'SELECT') = 0,
  'CTO-7 aucune policy INSERT/UPDATE/DELETE sur le pipeline'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'bank_statement_%'
     AND cmd = 'SELECT') = 6,
  'exactement 6 policies SELECT'
);
-- Interdits SECURITY_CONTRACT §4 : pas de USING(true).
SELECT poc_test.assert(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'bank_statement_%'
     AND (qual = 'true' OR with_check = 'true')) = 0,
  'aucune policy USING(true)/WITH CHECK(true)'
);

-- Privilèges tables : anon = rien ; authenticated/service_role = SELECT seul.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bank_statement_import_attempts', 'bank_statement_staging',
    'bank_statement_lines_staging', 'bank_statement_canonical',
    'bank_statement_lines_canonical', 'bank_statement_import_events'] LOOP
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION 'TEST_FAILED: anon a des privileges sur %', t;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'TEST_FAILED: authenticated sans SELECT sur %', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'TEST_FAILED: authenticated a un privilege d''ecriture sur %', t;
    END IF;
    IF has_table_privilege('service_role', 'public.' || t, 'INSERT')
       OR has_table_privilege('service_role', 'public.' || t, 'UPDATE')
       OR has_table_privilege('service_role', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'TEST_FAILED: service_role a un privilege d''ecriture sur %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: matrice privileges tables (anon=0, ecritures revoquees)';
END $$;

-- Privilèges fonctions : RPC exposées = authenticated seul ;
-- helpers internes = aucun rôle applicatif (décision CTO 8).
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'pre_ingest_structured_bank_statement',
      'promote_structured_bank_statement_import',
      'approve_structured_bank_statement_needs_review_promotion',
      'reject_structured_bank_statement_import',
      'resolve_structured_bank_statement_conflict_keep_existing',
      'request_structured_bank_statement_manager_escalation',
      'supersede_structured_bank_statement_import')
  LOOP
    IF has_function_privilege('anon', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: anon peut executer %', f.proname;
    END IF;
    IF NOT has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: authenticated ne peut pas executer %', f.proname;
    END IF;
    IF has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: service_role peut executer % (E-2 non arbitre)', f.proname;
    END IF;
  END LOOP;

  FOR f IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'structured_csv_parse_date_strict', 'structured_csv_parse_amount_strict',
      'structured_csv_assert_safe_details', 'structured_csv_assert_safe_reason',
      'structured_csv_assert_object_keys', 'structured_csv_acquire_import_lock',
      'structured_csv_append_audit_event', 'structured_csv_promote_staging_core',
      'structured_csv_assert_canonical_insert_allowed')
  LOOP
    IF has_function_privilege('anon', f.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', f.oid, 'EXECUTE')
       OR has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: helper interne % executable par un role applicatif', f.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: matrice EXECUTE (7 RPC exposees, 9 helpers verrouilles)';
END $$;

-- Les 7 RPC exposées + helpers sensibles sont SECURITY DEFINER avec
-- search_path épinglé, ou helpers INVOKER sans grant (double verrou).
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.proname, p.prosecdef,
           coalesce(array_to_string(p.proconfig, ';'), '') AS cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'pre_ingest_structured_bank_statement',
      'promote_structured_bank_statement_import',
      'approve_structured_bank_statement_needs_review_promotion',
      'reject_structured_bank_statement_import',
      'resolve_structured_bank_statement_conflict_keep_existing',
      'request_structured_bank_statement_manager_escalation',
      'supersede_structured_bank_statement_import')
  LOOP
    IF NOT f.prosecdef THEN
      RAISE EXCEPTION 'TEST_FAILED: % n''est pas SECURITY DEFINER', f.proname;
    END IF;
    IF f.cfg NOT ILIKE '%search_path=%' THEN
      RAISE EXCEPTION 'TEST_FAILED: % sans search_path epingle', f.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: RPC exposees = SECURITY DEFINER + search_path epingle';
END $$;

SELECT 'structure & privileges: PASS' AS status;
