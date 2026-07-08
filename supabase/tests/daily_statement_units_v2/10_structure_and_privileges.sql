-- ============================================================================
-- 0H — TESTS STRUCTURE & PRIVILÈGES v2 (tables, RLS, index, EXECUTE, E-2)
-- ============================================================================
\set ON_ERROR_STOP on

-- Aucune colonne brute/compte complet sur les 6 tables du pipeline v2
-- (blocklist étendue 0G incluse).
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'daily_statement_export_attempts', 'daily_statement_units_staging',
        'daily_statement_lines_staging', 'daily_statement_units_canonical',
        'daily_statement_lines_canonical', 'daily_statement_import_events')
      AND column_name IN (
        'raw_csv', 'raw_text', 'raw_bytes', 'raw_content', 'file_content',
        'account_number', 'iban', 'decoded_text', 'full_iban', 'raw_account',
        'account_number_raw')
  ),
  'aucune colonne raw/account_number/iban/decoded_text sur les 6 tables v2'
);

-- Doctrine CTO-5 conservée : aucun enum Postgres créé par la migration v2.
SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
      AND t.typname LIKE 'daily_%'
  ),
  'CTO-5 aucun enum daily_* cree'
);

-- Les 6 tables existent et RLS est active. Pas de table watermarks (D-0H-3).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'daily_statement_export_attempts', 'daily_statement_units_staging',
    'daily_statement_lines_staging', 'daily_statement_units_canonical',
    'daily_statement_lines_canonical', 'daily_statement_import_events'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'TEST_FAILED: RLS non active sur %', t;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'daily_statement_watermarks') THEN
    RAISE EXCEPTION 'TEST_FAILED: daily_statement_watermarks ne doit pas exister (D-0H-3)';
  END IF;
  RAISE NOTICE 'OK: RLS active sur les 6 tables v2, pas de watermarks';
END $$;

-- Index critiques (uniques partiels R1/R2 et R3 inclus).
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uq_daily_units_canonical_active_day_unit_id';
  IF v_def IS NULL OR v_def NOT ILIKE '%UNIQUE%' OR v_def NOT ILIKE '%WHERE%ingested%' THEN
    RAISE EXCEPTION 'TEST_FAILED: uq_daily_units_canonical_active_day_unit_id absent ou non partiel';
  END IF;

  SELECT indexdef INTO v_def FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uq_daily_lines_canonical_hash_active';
  IF v_def IS NULL OR v_def NOT ILIKE '%UNIQUE%' OR v_def NOT ILIKE '%WHERE%is_active%' THEN
    RAISE EXCEPTION 'TEST_FAILED: uq_daily_lines_canonical_hash_active absent ou non partiel';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                 AND indexname = 'uq_daily_lines_canonical_hash_per_unit') THEN
    RAISE EXCEPTION 'TEST_FAILED: uq_daily_lines_canonical_hash_per_unit absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                 AND indexname = 'idx_daily_events_attempt_id') THEN
    RAISE EXCEPTION 'TEST_FAILED: idx_daily_events_attempt_id absent';
  END IF;
  RAISE NOTICE 'OK: index critiques v2 presents';
END $$;

-- Trigger anti-promote présent sur units_canonical.
SELECT poc_test.assert(
  EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE c.relname = 'daily_statement_units_canonical'
      AND tg.tgname = 'trg_daily_units_canonical_anti_promote'),
  'trigger anti-promote v2 present'
);

-- Policies : exactement 6 SELECT, zéro policy d'écriture.
SELECT poc_test.assert(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'daily_statement_%'
     AND cmd <> 'SELECT') = 0,
  'aucune policy INSERT/UPDATE/DELETE sur le pipeline v2'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'daily_statement_%'
     AND cmd = 'SELECT') = 6,
  'exactement 6 policies SELECT v2'
);
SELECT poc_test.assert(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public' AND tablename LIKE 'daily_statement_%'
     AND (qual = 'true' OR with_check = 'true')) = 0,
  'aucune policy USING(true)/WITH CHECK(true) v2'
);

-- Privilèges tables : anon = rien ; authenticated/service_role = SELECT seul.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'daily_statement_export_attempts', 'daily_statement_units_staging',
    'daily_statement_lines_staging', 'daily_statement_units_canonical',
    'daily_statement_lines_canonical', 'daily_statement_import_events'] LOOP
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
  RAISE NOTICE 'OK: matrice privileges tables v2 (anon=0, ecritures revoquees)';
END $$;

-- Privilèges fonctions : 3 RPC exposées = authenticated seul (service_role
-- JAMAIS, doctrine E-2) ; helpers internes = aucun rôle applicatif.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'pre_ingest_daily_statement_units',
      'promote_daily_statement_unit',
      'supersede_daily_statement_unit')
  LOOP
    IF has_function_privilege('anon', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: anon peut executer %', f.proname;
    END IF;
    IF NOT has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: authenticated ne peut pas executer %', f.proname;
    END IF;
    IF has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: service_role peut executer % (doctrine E-2)', f.proname;
    END IF;
  END LOOP;

  FOR f IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'daily_stmt_parse_date_strict', 'daily_stmt_parse_amount_strict',
      'daily_stmt_assert_hex64', 'daily_stmt_assert_object_keys',
      'daily_stmt_assert_no_forbidden_keys', 'daily_stmt_assert_masked_account',
      'daily_stmt_assert_safe_file_name', 'daily_stmt_assert_safe_reason',
      'daily_stmt_day_content_hash', 'daily_stmt_day_unit_id',
      'daily_stmt_assert_safe_details', 'daily_stmt_append_audit_event',
      'daily_stmt_acquire_day_lock', 'daily_stmt_promote_unit_core',
      'daily_stmt_assert_canonical_insert_allowed')
  LOOP
    IF has_function_privilege('anon', f.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', f.oid, 'EXECUTE')
       OR has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: helper interne % executable par un role applicatif', f.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: matrice EXECUTE v2 (3 RPC exposees, 15 helpers verrouilles)';
END $$;

-- Les 3 RPC exposées sont SECURITY DEFINER avec search_path épinglé.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.proname, p.prosecdef,
           coalesce(array_to_string(p.proconfig, ';'), '') AS cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'pre_ingest_daily_statement_units',
      'promote_daily_statement_unit',
      'supersede_daily_statement_unit')
  LOOP
    IF NOT f.prosecdef THEN
      RAISE EXCEPTION 'TEST_FAILED: % n''est pas SECURITY DEFINER', f.proname;
    END IF;
    IF f.cfg NOT ILIKE '%search_path=%' THEN
      RAISE EXCEPTION 'TEST_FAILED: % sans search_path epingle', f.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: RPC v2 = SECURITY DEFINER + search_path epingle';
END $$;

-- 0K : promote_daily_statement_unit = signature UNIQUE (uuid, text) avec
-- default argument — jamais d'overload (uuid) résiduel (compat appel
-- historique à un argument assurée par le default, pas par une 2e fonction).
DO $$
DECLARE
  v_count integer;
  v_args  text;
  v_ndef  integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'promote_daily_statement_unit';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: promote_daily_statement_unit attendu en UNE signature, trouve %', v_count;
  END IF;
  SELECT pg_get_function_identity_arguments(p.oid), p.pronargdefaults
  INTO v_args, v_ndef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'promote_daily_statement_unit';
  IF v_args <> 'p_staging_unit_id uuid, p_approval_reason text' THEN
    RAISE EXCEPTION 'TEST_FAILED: signature promote inattendue [%]', v_args;
  END IF;
  IF v_ndef <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: p_approval_reason doit porter un DEFAULT (compat appel historique)';
  END IF;
  RAISE NOTICE 'OK: promote_daily_statement_unit = signature unique (uuid, text DEFAULT)';
END $$;

SELECT 'structure & privileges v2: PASS' AS status;
