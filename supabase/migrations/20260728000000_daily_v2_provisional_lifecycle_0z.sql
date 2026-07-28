-- ============================================================================
-- DAILY-V2-0Z — CYCLE DE VIE DES JOURNÉES PROVISIONAL (redépôt idempotent)
-- ============================================================================
-- Migration additive postérieure à 0U/0U3/0U4. Elle redéfinit UNIQUEMENT le
-- cœur interne daily_stmt_pre_ingest_legacy_core_0u (ex-RPC 0H renommée par
-- 0U) pour fermer le cycle de vie des unités 'provisional' (journée non
-- close, doctrine ORA fail-closed), constaté ouvert par l'audit
-- GO_AUDIT_ORABANK_PROVISIONAL_LIFECYCLE_0Z_I :
--
--   - avant 0Z, chaque redépôt d'une journée non close accumulait une unité
--     'provisional' supplémentaire ET son jeu complet de lignes sensibles,
--     sans issue ('provisional' était un état terminal jamais réassigné) ;
--   - aucun chemin ne fermait ces unités à la clôture de la journée.
--
-- Décisions 0Z (périmètre strictement minimal) :
--   D-0Z-1. R1-provisional : au dépôt d'une unité 'provisional', son
--           day_content_hash (déjà recalculé serveur) est comparé à celui de
--           la provisional VIVANTE la plus récente du même day_unit_id, sous
--           le verrou journée existant. Contenu identique => statut final
--           'duplicate' : AUCUNE ligne sensible re-stagée (mécanisme R1
--           existant), la provisional d'origine reste l'unique version
--           vivante. Le redépôt strictement identique devient idempotent
--           (croissance bornée aux métadonnées attempt/unit/audit).
--   D-0Z-2. Contenu modifié => la nouvelle unité 'provisional' remplace les
--           anciennes : toute provisional vivante du même day_unit_id passe
--           à 'superseded' (statut déjà présent dans le domaine CHECK 0H,
--           jamais assigné jusqu'ici). La version modifiée est conservée ;
--           les anciennes restent lisibles (aucun DELETE, Option C hors
--           périmètre — GO CTO distinct requis pour toute purge).
--   D-0Z-3. Clôture : un dépôt du même day_unit_id arbitré par le chemin
--           'staged' (journée close, quel que soit son verdict R1/R2/R3)
--           balaie les provisional vivantes restantes vers 'superseded'.
--   D-0Z-4. Chaque bascule provisional->superseded est auditée en append-only
--           via l'événement whitelisté 'status_changed' (previous_status,
--           new_status, reason_code scalaires whitelistés) :
--             - provisional_superseded_by_redeposit (D-0Z-2) ;
--             - provisional_superseded_by_day_closure (D-0Z-3).
--           Le duplicate R1-provisional est audité 'unit_duplicate' avec
--           reason_code 'provisional_redeposit_duplicate'.
--   D-0Z-5. Postcondition fail-closed par unité traitée : exactement UNE
--           provisional vivante après un dépôt de journée non close, ZÉRO
--           après un dépôt de journée close (toute violation => exception =>
--           rollback intégral, doctrine all-or-nothing 0H conservée).
--   D-0Z-6. Invariants 0H intacts : D-0H-4 (une provisional n'atteint JAMAIS
--           l'arbitrage canonical ni la promotion — gate RPC + trigger
--           inchangés), R1/R2/R3, verrous par journée en ordre trié,
--           double verrou EXECUTE du cœur interne (ACL re-révoquée ici).
--
-- Aucune modification : tables, index, RLS, policies, privilèges tables,
-- wrapper 0U, RPC promote/supersede, contrat TypeScript, réponse RPC.
--
-- STATUT : CANDIDATE / DRAFT, même doctrine que 0H/0U. Ne JAMAIS appliquer
-- sur Supabase live sans passage staging complet et GO CTO explicite.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(
  p_attempt       jsonb,
  p_units         jsonb,
  p_lines         jsonb,
  p_guard_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor            uuid;
  v_attempt_id       uuid;

  -- attempt
  v_mode             text;
  v_source_format    text;
  v_bank             text;
  v_currency         text;
  v_fp               text;
  v_masked           text;
  v_file_name        text;
  v_rth              text;
  v_period_start     date;
  v_period_end       date;
  v_stmt_date        date;
  v_ref_date         date;
  v_parser_status    text;
  v_errors_count     integer;
  v_warnings_count   integer;

  -- guard
  v_ingestion_ready  boolean;
  v_bridge           boolean;
  v_period_days      integer;
  v_grant            text;

  -- units (tableaux parallèles indexés par position dans p_units)
  v_n                integer;
  v_unit             jsonb;
  v_line             jsonb;
  v_i                integer;
  v_lidx             integer;
  v_day_unit_ids     text[] := '{}';
  v_acc_raw          text[] := '{}';
  v_acc_dates        date[] := '{}';
  v_content_hashes   text[] := '{}';
  v_line_counts      integer[] := '{}';
  v_req_status       text[] := '{}';
  v_expected         text;
  v_max_acc          date;
  v_unit_hashes      text[];

  -- lignes
  v_direction        text;
  v_signed           numeric;
  v_debit            numeric;
  v_credit           numeric;
  v_seen_pairs       text[] := '{}';
  v_pair             text;

  -- arbitrage
  v_lock_id          text;
  v_active           public.daily_statement_units_canonical%ROWTYPE;
  v_final            text;
  v_overlap          boolean;
  v_staging_unit_id  uuid;
  v_result_units     jsonb := '[]'::jsonb;
  v_active_id        uuid;

  -- cycle de vie provisional (0Z)
  v_prev_provisional   public.daily_statement_units_staging%ROWTYPE;
  v_keep_provisional   uuid;
  v_dup_of_provisional boolean;
  v_swept              record;
  v_live_provisional   integer;
  v_unit_event_type    text;
  v_unit_event_message text;

  -- Miroirs EXACTS des whitelists TS 0G (DAILY_STATEMENT_RPC_*_ALLOWED_KEYS).
  c_attempt_allowed constant text[] := ARRAY[
    'requested_mode', 'source_format', 'bank', 'currency', 'account_fingerprint',
    'account_number_masked', 'source_file_name_redacted', 'raw_text_hash',
    'export_period_start', 'export_period_end', 'statement_date',
    'export_reference_date', 'parser_validation_status', 'errors_count',
    'warnings_count', 'runtime_version', 'parser_version'
  ];
  c_unit_allowed constant text[] := ARRAY[
    'day_unit_id', 'accounting_date', 'day_content_hash', 'line_count',
    'day_total_debits', 'day_total_credits', 'opening_balance_derived',
    'closing_balance_derived', 'aggregates_status', 'validation_status',
    'requested_unit_status'
  ];
  c_line_allowed constant text[] := ARRAY[
    'day_unit_id', 'daily_line_hash', 'daily_occurrence_ordinal',
    'source_line_index', 'accounting_date', 'value_date',
    'description_sanitized', 'debit_amount', 'credit_amount', 'signed_amount',
    'running_balance', 'direction', 'currency'
  ];
  c_guard_allowed constant text[] := ARRAY[
    'ingestion_ready', 'period_days', 'bridge_guard_passed',
    'backfill_grant_reference'
  ];
  -- Miroir de MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS (0C).
  c_max_period_days constant integer := 45;
  -- Plafonds STRUCTURELS du backfill (0K) : un dépôt BIS reste massif mais
  -- borné — jamais de payload illimité, même sous grant admin.
  c_max_backfill_period_days constant integer := 4000;
  c_max_backfill_units       constant integer := 4000;
BEGIN
  -- Rôle : admin ou manager (dépôt) ; backfill = admin seul (doctrine 0F).
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT (public.has_role(v_actor, 'admin'::public.app_role)
          OR public.has_role(v_actor, 'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'DAILY_STMT_ROLE_DENIED: admin or manager role required (fail-closed)';
  END IF;

  -- Anti-smuggling AVANT tout : scan profond des 4 paramètres.
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_attempt, '$.p_attempt');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_units, '$.p_units');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_lines, '$.p_lines');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_guard_context, '$.p_guard_context');

  -- Whitelists structurelles.
  PERFORM public.daily_stmt_assert_object_keys(p_attempt, c_attempt_allowed, 'p_attempt');
  PERFORM public.daily_stmt_assert_object_keys(p_guard_context, c_guard_allowed, 'p_guard_context');
  IF p_units IS NULL OR jsonb_typeof(p_units) <> 'array' OR jsonb_array_length(p_units) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_UNITS_REQUIRED: p_units must be a non-empty json array (fail-closed)';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_LINES_REQUIRED: p_lines must be a non-empty json array (fail-closed)';
  END IF;

  -- ------------------------------------------------------------------
  -- p_attempt
  -- ------------------------------------------------------------------
  v_mode := p_attempt ->> 'requested_mode';
  IF v_mode IS NULL OR v_mode NOT IN ('daily', 'backfill') THEN
    RAISE EXCEPTION 'DAILY_STMT_MODE_UNSUPPORTED: requested_mode must be daily or backfill (fail-closed)';
  END IF;
  IF v_mode = 'backfill'
     AND NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_ADMIN_ONLY: backfill deposits require the admin role (fail-closed)';
  END IF;

  v_source_format := nullif(btrim(coalesce(p_attempt ->> 'source_format', '')), '');
  v_bank          := nullif(btrim(coalesce(p_attempt ->> 'bank', '')), '');
  v_currency      := nullif(btrim(coalesce(p_attempt ->> 'currency', '')), '');
  v_fp            := nullif(btrim(coalesce(p_attempt ->> 'account_fingerprint', '')), '');
  IF v_source_format IS NULL OR v_bank IS NULL OR v_currency IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_SOURCE_REQUIRED: source_format, bank and currency are required (fail-closed)';
  END IF;
  IF v_fp IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_FINGERPRINT_REQUIRED: account_fingerprint is mandatory; no fallback on the masked account number (fail-closed)';
  END IF;

  v_masked := nullif(btrim(coalesce(p_attempt ->> 'account_number_masked', '')), '');
  PERFORM public.daily_stmt_assert_masked_account(v_masked);
  v_file_name := nullif(btrim(coalesce(p_attempt ->> 'source_file_name_redacted', '')), '');
  PERFORM public.daily_stmt_assert_safe_file_name(v_file_name);

  v_rth := public.daily_stmt_assert_hex64(p_attempt ->> 'raw_text_hash', 'raw_text_hash');

  v_period_start := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_start');
  v_period_end   := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_end');
  IF v_period_end < v_period_start THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_INCOHERENT: export_period_end earlier than export_period_start (fail-closed)';
  END IF;
  v_stmt_date := CASE WHEN p_attempt ->> 'statement_date' IS NULL THEN NULL
                      ELSE public.daily_stmt_parse_date_strict(p_attempt ->> 'statement_date') END;
  v_ref_date  := CASE WHEN p_attempt ->> 'export_reference_date' IS NULL THEN NULL
                      ELSE public.daily_stmt_parse_date_strict(p_attempt ->> 'export_reference_date') END;

  v_parser_status := p_attempt ->> 'parser_validation_status';
  IF v_parser_status IS NULL OR v_parser_status NOT IN ('valid', 'needs_review') THEN
    RAISE EXCEPTION 'DAILY_STMT_PARSER_STATUS: parser_validation_status must be valid or needs_review (fail-closed)';
  END IF;

  IF coalesce(p_attempt ->> 'errors_count', '0') !~ '^[0-9]+$'
     OR coalesce(p_attempt ->> 'warnings_count', '0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DAILY_STMT_COUNT_INVALID: errors_count/warnings_count must be integers >= 0 (fail-closed)';
  END IF;
  v_errors_count   := coalesce(p_attempt ->> 'errors_count', '0')::integer;
  v_warnings_count := coalesce(p_attempt ->> 'warnings_count', '0')::integer;

  -- ------------------------------------------------------------------
  -- p_guard_context
  -- ------------------------------------------------------------------
  IF jsonb_typeof(p_guard_context -> 'ingestion_ready') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_guard_context -> 'bridge_guard_passed') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'DAILY_STMT_GUARD_TYPE: ingestion_ready and bridge_guard_passed must be json booleans (fail-closed)';
  END IF;
  v_ingestion_ready := (p_guard_context ->> 'ingestion_ready')::boolean;
  v_bridge          := (p_guard_context ->> 'bridge_guard_passed')::boolean;
  IF coalesce(p_guard_context ->> 'period_days', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_DAYS_INVALID: period_days must be an integer >= 1 (fail-closed)';
  END IF;
  v_period_days := (p_guard_context ->> 'period_days')::integer;
  IF v_period_days < 1 THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_DAYS_INVALID: period_days must be an integer >= 1 (fail-closed)';
  END IF;
  v_grant := nullif(btrim(coalesce(p_guard_context ->> 'backfill_grant_reference', '')), '');

  IF NOT v_bridge THEN
    RAISE EXCEPTION 'DAILY_STMT_BRIDGE_GUARD_FAILED: a guard-rejected export never becomes a deposit (fail-closed)';
  END IF;
  -- Recomptage serveur : la fenêtre déclarée ne peut pas être sous-évaluée.
  IF v_period_days <> (v_period_end - v_period_start + 1) THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_DAYS_MISMATCH: period_days does not match the inclusive export window (fail-closed)';
  END IF;

  IF v_mode = 'daily' THEN
    IF NOT v_ingestion_ready THEN
      RAISE EXCEPTION 'DAILY_STMT_INGESTION_READY_REQUIRED: a daily deposit requires an ingestion-ready export (fail-closed)';
    END IF;
    IF v_period_days > c_max_period_days THEN
      RAISE EXCEPTION 'DAILY_STMT_PERIOD_CAP: export window above the %-day ingestion limit; use the dedicated backfill mode (fail-closed)', c_max_period_days;
    END IF;
    IF v_grant IS NOT NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_GRANT_FORBIDDEN: backfill_grant_reference must not ride a daily deposit (fail-closed)';
    END IF;
  ELSE
    IF v_grant IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_GRANT_REQUIRED: backfill_grant_reference is mandatory in backfill mode (fail-closed)';
    END IF;
    -- Plafonds structurels 0K. Le cap d'unités est contrôlé ICI, AVANT la
    -- boucle de validation de p_units : un payload massif accidentel est
    -- rejeté sans être parsé unité par unité.
    IF v_period_days > c_max_backfill_period_days THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_PERIOD_CAP: backfill window above the structural %-day cap (fail-closed)', c_max_backfill_period_days;
    END IF;
    IF jsonb_array_length(p_units) > c_max_backfill_units THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_UNITS_CAP: backfill deposit above the structural %-unit cap (fail-closed)', c_max_backfill_units;
    END IF;
  END IF;

  -- ------------------------------------------------------------------
  -- p_units : validation + recalculs serveur (day_unit_id, agrégats domaine)
  -- ------------------------------------------------------------------
  v_n := jsonb_array_length(p_units);
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_unit := p_units -> v_i;
    PERFORM public.daily_stmt_assert_object_keys(v_unit, c_unit_allowed, 'p_units[' || v_i || ']');

    -- accounting_date stricte, puis recalcul du day_unit_id depuis le contexte
    -- attempt (D-0H-1) : divergence bank/fingerprint/currency/date impossible.
    v_acc_raw := v_acc_raw || btrim(v_unit ->> 'accounting_date');
    v_acc_dates := v_acc_dates || public.daily_stmt_parse_date_strict(v_unit ->> 'accounting_date');
    PERFORM public.daily_stmt_assert_hex64(v_unit ->> 'day_unit_id', 'p_units[' || v_i || '].day_unit_id');
    IF (v_unit ->> 'day_unit_id')
       <> public.daily_stmt_day_unit_id(v_bank, v_fp, v_currency, v_acc_raw[v_i + 1]) THEN
      RAISE EXCEPTION 'DAILY_STMT_DAY_UNIT_ID_MISMATCH: p_units[%].day_unit_id does not match the attempt context (bank/fingerprint/currency/accounting_date divergence, fail-closed)', v_i;
    END IF;
    IF (v_unit ->> 'day_unit_id') = ANY (v_day_unit_ids) THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_DUPLICATE: duplicate day_unit_id in p_units (one unit per accounting day, fail-closed)';
    END IF;
    v_day_unit_ids := v_day_unit_ids || (v_unit ->> 'day_unit_id');

    v_content_hashes := v_content_hashes
      || public.daily_stmt_assert_hex64(v_unit ->> 'day_content_hash', 'p_units[' || v_i || '].day_content_hash');

    IF coalesce(v_unit ->> 'line_count', '') !~ '^[0-9]+$' OR (v_unit ->> 'line_count')::integer < 1 THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_LINE_COUNT_INVALID: p_units[%].line_count must be an integer >= 1 (fail-closed)', v_i;
    END IF;
    v_line_counts := v_line_counts || (v_unit ->> 'line_count')::integer;

    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_debits');
    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_credits');
    IF v_unit ->> 'day_total_debits' IS NULL OR v_unit ->> 'day_total_credits' IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_TOTALS_REQUIRED: p_units[%] day totals are required (fail-closed)', v_i;
    END IF;
    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'opening_balance_derived');
    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'closing_balance_derived');

    IF coalesce(v_unit ->> 'aggregates_status', '') NOT IN ('derived', 'unavailable')
       OR coalesce(v_unit ->> 'validation_status', '') NOT IN ('valid', 'needs_review') THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_STATUS_DOMAIN: p_units[%] aggregates/validation status outside domain (fail-closed)', v_i;
    END IF;
    -- Miroir TS : derived => soldes présents ; unavailable => rien de fabriqué.
    IF (v_unit ->> 'aggregates_status' = 'derived'
          AND (v_unit ->> 'opening_balance_derived' IS NULL OR v_unit ->> 'closing_balance_derived' IS NULL))
       OR (v_unit ->> 'aggregates_status' = 'unavailable'
          AND (v_unit ->> 'opening_balance_derived' IS NOT NULL OR v_unit ->> 'closing_balance_derived' IS NOT NULL)) THEN
      RAISE EXCEPTION 'DAILY_STMT_AGGREGATES_INCOHERENT: p_units[%] derived balances incoherent with aggregates_status (fail-closed)', v_i;
    END IF;

    IF coalesce(v_unit ->> 'requested_unit_status', '') NOT IN ('staged', 'provisional') THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_STATUS_DOMAIN: p_units[%].requested_unit_status must be staged or provisional (fail-closed)', v_i;
    END IF;
    v_req_status := v_req_status || (v_unit ->> 'requested_unit_status');
  END LOOP;

  -- Re-dérivation serveur de la règle journée non close (doctrine 9) : le
  -- statut déclaré doit être EXACTEMENT celui que la règle impose.
  SELECT max(d) INTO v_max_acc FROM unnest(v_acc_dates) d;
  FOR v_i IN 1 .. v_n LOOP
    IF v_ref_date IS NOT NULL THEN
      v_expected := CASE WHEN v_acc_dates[v_i] >= v_ref_date THEN 'provisional' ELSE 'staged' END;
    ELSIF v_bank = 'ORA' THEN
      -- ORA sans export_reference_date : dernier jour provisional (fail-closed).
      v_expected := CASE WHEN v_acc_dates[v_i] = v_max_acc THEN 'provisional' ELSE 'staged' END;
    ELSE
      v_expected := 'staged';
    END IF;
    IF v_req_status[v_i] <> v_expected THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_STATUS_MISMATCH: p_units[%].requested_unit_status "%" contradicts the server-derived non-closed-day rule ("%") (fail-closed)', v_i - 1, v_req_status[v_i], v_expected;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- p_lines : validation par ligne (formats stricts + one_amount + jointure)
  -- ------------------------------------------------------------------
  FOR v_i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
    v_line := p_lines -> v_i;
    PERFORM public.daily_stmt_assert_object_keys(v_line, c_line_allowed, 'p_lines[' || v_i || ']');

    v_lidx := array_position(v_day_unit_ids, v_line ->> 'day_unit_id');
    IF v_lidx IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_ORPHAN: p_lines[%].day_unit_id does not reference any p_units entry (orphan line, fail-closed)', v_i;
    END IF;

    PERFORM public.daily_stmt_assert_hex64(v_line ->> 'daily_line_hash', 'p_lines[' || v_i || '].daily_line_hash');
    v_pair := v_lidx || '|' || (v_line ->> 'daily_line_hash');
    IF v_pair = ANY (v_seen_pairs) THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_HASH_DUPLICATE: p_lines[%].daily_line_hash duplicated within its unit (ordinal bug upstream, fail-closed)', v_i;
    END IF;
    v_seen_pairs := v_seen_pairs || v_pair;

    IF coalesce(v_line ->> 'daily_occurrence_ordinal', '') !~ '^[0-9]+$'
       OR (v_line ->> 'daily_occurrence_ordinal')::integer < 1 THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_ORDINAL: p_lines[%].daily_occurrence_ordinal must be an integer >= 1 (fail-closed)', v_i;
    END IF;
    IF coalesce(v_line ->> 'source_line_index', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_SOURCE_INDEX: p_lines[%].source_line_index must be an integer >= 0 (fail-closed)', v_i;
    END IF;

    IF public.daily_stmt_parse_date_strict(v_line ->> 'accounting_date') <> v_acc_dates[v_lidx] THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_DATE_MISMATCH: p_lines[%].accounting_date does not equal its unit''s accounting_date (fail-closed)', v_i;
    END IF;
    IF v_line ->> 'value_date' IS NOT NULL THEN
      PERFORM public.daily_stmt_parse_date_strict(v_line ->> 'value_date');
    END IF;

    IF nullif(btrim(coalesce(v_line ->> 'description_sanitized', '')), '') IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_DESCRIPTION_REQUIRED: p_lines[%].description_sanitized is required (fail-closed)', v_i;
    END IF;

    v_direction := v_line ->> 'direction';
    IF v_direction IS NULL OR v_direction NOT IN ('debit', 'credit') THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_DIRECTION: p_lines[%].direction must be debit or credit (fail-closed)', v_i;
    END IF;

    v_signed := public.daily_stmt_parse_amount_strict(v_line ->> 'signed_amount');
    IF v_signed IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_SIGNED_REQUIRED: p_lines[%].signed_amount is required (fail-closed)', v_i;
    END IF;
    v_debit  := public.daily_stmt_parse_amount_strict(v_line ->> 'debit_amount');
    v_credit := public.daily_stmt_parse_amount_strict(v_line ->> 'credit_amount');
    PERFORM public.daily_stmt_parse_amount_strict(v_line ->> 'running_balance');

    -- Miroir lines_staging_v2_one_amount (message stable pour les tests).
    IF NOT (
      (v_direction = 'debit'  AND v_debit  IS NOT NULL AND v_credit IS NULL
        AND v_signed < 0 AND abs(v_signed) = v_debit) OR
      (v_direction = 'credit' AND v_credit IS NOT NULL AND v_debit  IS NULL
        AND v_signed > 0 AND v_signed = v_credit)
    ) THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_ONE_AMOUNT: p_lines[%] violates the direction/amount/sign coherence (lines_staging_v2_one_amount mirror, fail-closed)', v_i;
    END IF;

    IF btrim(coalesce(v_line ->> 'currency', '')) <> v_currency THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_CURRENCY_MISMATCH: p_lines[%].currency does not equal p_attempt.currency (fail-closed)', v_i;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Croisements unité <-> lignes : comptes + day_content_hash recalculé.
  -- ------------------------------------------------------------------
  FOR v_i IN 1 .. v_n LOOP
    SELECT array_agg(l.value ->> 'daily_line_hash')
    INTO v_unit_hashes
    FROM jsonb_array_elements(p_lines) l
    WHERE l.value ->> 'day_unit_id' = v_day_unit_ids[v_i];

    IF coalesce(array_length(v_unit_hashes, 1), 0) <> v_line_counts[v_i] THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_COUNT: p_units[%] declares line_count % but received % p_lines (fail-closed)',
        v_i - 1, v_line_counts[v_i], coalesce(array_length(v_unit_hashes, 1), 0);
    END IF;
    IF public.daily_stmt_day_content_hash(v_day_unit_ids[v_i], v_unit_hashes)
       <> v_content_hashes[v_i] THEN
      RAISE EXCEPTION 'DAILY_STMT_CONTENT_HASH_MISMATCH: p_units[%].day_content_hash does not match the SQL recomputation over its own lines (fail-closed)', v_i - 1;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Écritures : attempt, puis arbitrage R1/R2/R3 par unité SOUS VERROU.
  -- ------------------------------------------------------------------
  INSERT INTO public.daily_statement_export_attempts (
    created_by, requested_mode, source_format, bank, currency,
    account_fingerprint, account_number_masked, source_file_name_redacted,
    raw_text_hash, export_period_start, export_period_end, statement_date,
    export_reference_date, parser_validation_status, errors_count,
    warnings_count, runtime_version, parser_version, ingestion_ready,
    bridge_guard_passed, period_days, backfill_grant_reference, units_total
  ) VALUES (
    v_actor, v_mode, v_source_format, v_bank, v_currency,
    v_fp, v_masked, v_file_name,
    v_rth, v_period_start, v_period_end, v_stmt_date,
    v_ref_date, v_parser_status, v_errors_count,
    v_warnings_count, nullif(btrim(coalesce(p_attempt ->> 'runtime_version', '')), ''),
    nullif(btrim(coalesce(p_attempt ->> 'parser_version', '')), ''), v_ingestion_ready,
    v_bridge, v_period_days, v_grant, v_n
  )
  RETURNING id INTO v_attempt_id;

  PERFORM public.daily_stmt_append_audit_event(
    v_actor, v_attempt_id, NULL, NULL, NULL, v_rth,
    'attempt_received', NULL, NULL,
    'daily statement export deposit received',
    jsonb_build_object('requested_mode', v_mode, 'units_total', v_n,
                       'period_days', v_period_days)
  );
  IF v_mode = 'backfill' THEN
    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_attempt_id, NULL, NULL, NULL, v_rth,
      'backfill_deposit', NULL, NULL,
      'backfill deposit under explicit grant',
      jsonb_build_object('backfill_grant_reference', v_grant,
                         'period_days', v_period_days, 'units_total', v_n)
    );
  END IF;

  -- Verrous PAR JOURNÉE en ordre trié (anti-deadlock entre dépôts recouvrants).
  FOR v_lock_id IN SELECT h FROM unnest(v_day_unit_ids) h ORDER BY h COLLATE "C" LOOP
    PERFORM public.daily_stmt_acquire_day_lock(v_lock_id);
  END LOOP;

  FOR v_i IN 1 .. v_n LOOP
    v_active_id := NULL;
    v_keep_provisional := NULL;
    v_dup_of_provisional := false;

    IF v_req_status[v_i] = 'provisional' THEN
      -- D-0H-4 conservé : jamais promouvable, hors arbitrage canonical.
      -- 0Z (D-0Z-1/D-0Z-2) : arbitrage R1-provisional contre la provisional
      -- VIVANTE la plus récente du même day_unit_id, sous le verrou journée.
      SELECT * INTO v_prev_provisional
      FROM public.daily_statement_units_staging
      WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'provisional'
      ORDER BY created_at DESC, id DESC
      LIMIT 1;

      IF FOUND AND v_prev_provisional.day_content_hash = v_content_hashes[v_i] THEN
        -- Redépôt strictement identique : duplicate contrôlé, AUCUNE ligne
        -- sensible re-stagée ; la provisional d'origine reste la version
        -- vivante unique de la journée.
        v_final := 'duplicate';
        v_dup_of_provisional := true;
        v_keep_provisional := v_prev_provisional.id;
      ELSE
        v_final := 'provisional';
      END IF;
    ELSE
      SELECT * INTO v_active
      FROM public.daily_statement_units_canonical
      WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'ingested';

      IF FOUND AND v_active.active_day_content_hash = v_content_hashes[v_i] THEN
        v_final := 'duplicate';                 -- R1 : journée identique.
        v_active_id := v_active.id;
      ELSIF FOUND THEN
        v_final := 'conflict';                  -- R2 : contenu divergent.
        v_active_id := v_active.id;
      ELSE
        -- R3 : un daily_line_hash encore ACTIF sous une AUTRE journée.
        SELECT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_lines) l
          JOIN public.daily_statement_lines_canonical lc
            ON lc.daily_line_hash = l.value ->> 'daily_line_hash' AND lc.is_active
          WHERE l.value ->> 'day_unit_id' = v_day_unit_ids[v_i]
            AND lc.day_unit_id <> v_day_unit_ids[v_i]
        ) INTO v_overlap;
        v_final := CASE WHEN v_overlap THEN 'needs_review' ELSE 'staged' END;
      END IF;
    END IF;

    -- 0Z (D-0Z-2/D-0Z-3/D-0Z-4) : balayage des provisional vivantes périmées
    -- du même day_unit_id, sous le même verrou journée. Journée non close :
    -- seule la version courante survit (la plus récente identique, ou la
    -- nouvelle unité insérée ci-dessous). Journée close (chemin 'staged',
    -- quel que soit le verdict R1/R2/R3) : plus aucune provisional vivante.
    -- Append-only préservé : UPDATE de statut + événement, jamais de DELETE.
    FOR v_swept IN
      SELECT id FROM public.daily_statement_units_staging
      WHERE day_unit_id = v_day_unit_ids[v_i]
        AND status = 'provisional'
        AND (v_keep_provisional IS NULL OR id <> v_keep_provisional)
      ORDER BY created_at, id
    LOOP
      UPDATE public.daily_statement_units_staging
        SET status = 'superseded'
        WHERE id = v_swept.id;
      PERFORM public.daily_stmt_append_audit_event(
        v_actor, v_attempt_id, v_swept.id, NULL,
        v_day_unit_ids[v_i], v_rth,
        'status_changed', 'provisional', 'superseded',
        CASE WHEN v_req_status[v_i] = 'provisional'
             THEN 'stale provisional unit superseded by redeposit of the same non-closed day'
             ELSE 'stale provisional unit superseded: the day is now closed'
        END,
        jsonb_build_object(
          'reason_code', CASE WHEN v_req_status[v_i] = 'provisional'
                              THEN 'provisional_superseded_by_redeposit'
                              ELSE 'provisional_superseded_by_day_closure' END,
          'day_unit_id', v_day_unit_ids[v_i],
          'previous_status', 'provisional',
          'new_status', 'superseded')
      );
    END LOOP;

    v_unit := p_units -> (v_i - 1);
    INSERT INTO public.daily_statement_units_staging (
      attempt_id, day_unit_id, bank, account_fingerprint, currency,
      accounting_date, day_content_hash, line_count, day_total_debits,
      day_total_credits, opening_balance_derived, closing_balance_derived,
      aggregates_status, validation_status, status, created_by
    ) VALUES (
      v_attempt_id, v_day_unit_ids[v_i], v_bank, v_fp, v_currency,
      v_acc_dates[v_i], v_content_hashes[v_i], v_line_counts[v_i],
      public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_debits'),
      public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_credits'),
      public.daily_stmt_parse_amount_strict(v_unit ->> 'opening_balance_derived'),
      public.daily_stmt_parse_amount_strict(v_unit ->> 'closing_balance_derived'),
      v_unit ->> 'aggregates_status', v_unit ->> 'validation_status',
      v_final, v_actor
    )
    RETURNING id INTO v_staging_unit_id;

    -- R1 duplicate (canonical OU provisional) : AUCUNE ligne stagée — le
    -- contenu identique vit déjà en canonical ou dans la provisional vivante
    -- (ne pas dupliquer des libellés sensibles). Tous les autres statuts
    -- conservent leurs lignes (conflict = matière du futur supersede).
    IF v_final <> 'duplicate' THEN
      FOR v_line IN
        SELECT l.value FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l(value, ord)
        WHERE l.value ->> 'day_unit_id' = v_day_unit_ids[v_i]
        ORDER BY l.ord
      LOOP
        INSERT INTO public.daily_statement_lines_staging (
          staging_unit_id, attempt_id, day_unit_id, daily_line_hash,
          daily_occurrence_ordinal, source_line_index, accounting_date,
          value_date, description_sanitized, debit_amount, credit_amount,
          signed_amount, running_balance, direction, currency
        ) VALUES (
          v_staging_unit_id, v_attempt_id, v_day_unit_ids[v_i],
          v_line ->> 'daily_line_hash',
          (v_line ->> 'daily_occurrence_ordinal')::integer,
          (v_line ->> 'source_line_index')::integer,
          v_acc_dates[v_i],
          CASE WHEN v_line ->> 'value_date' IS NULL THEN NULL
               ELSE public.daily_stmt_parse_date_strict(v_line ->> 'value_date') END,
          v_line ->> 'description_sanitized',
          public.daily_stmt_parse_amount_strict(v_line ->> 'debit_amount'),
          public.daily_stmt_parse_amount_strict(v_line ->> 'credit_amount'),
          public.daily_stmt_parse_amount_strict(v_line ->> 'signed_amount'),
          public.daily_stmt_parse_amount_strict(v_line ->> 'running_balance'),
          v_line ->> 'direction', btrim(v_line ->> 'currency')
        );
      END LOOP;
    END IF;

    v_unit_event_type := CASE v_final
      WHEN 'staged'       THEN 'unit_staged'
      WHEN 'provisional'  THEN 'unit_provisional_held'
      WHEN 'duplicate'    THEN 'unit_duplicate'
      WHEN 'conflict'     THEN 'unit_conflict'
      ELSE 'unit_needs_review'
    END;
    v_unit_event_message := CASE
      WHEN v_final = 'duplicate' AND v_dup_of_provisional
        THEN 'exact duplicate of the live provisional day unit (R1-provisional, 0Z)'
      WHEN v_final = 'staged'      THEN 'daily unit staged'
      WHEN v_final = 'provisional' THEN 'non-closed day held provisional (never promotable)'
      WHEN v_final = 'duplicate'   THEN 'exact duplicate of the active canonical day (R1)'
      WHEN v_final = 'conflict'    THEN 'same day_unit_id with different day_content_hash than active canonical (R2)'
      ELSE 'active daily_line_hash overlap with another day unit (R3)'
    END;

    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_attempt_id, v_staging_unit_id, v_active_id,
      v_day_unit_ids[v_i], v_rth,
      v_unit_event_type,
      NULL, v_final,
      v_unit_event_message,
      jsonb_build_object('day_unit_id', v_day_unit_ids[v_i],
                         'day_content_hash', v_content_hashes[v_i],
                         'line_count', v_line_counts[v_i])
      || CASE WHEN v_dup_of_provisional
              THEN jsonb_build_object('reason_code', 'provisional_redeposit_duplicate')
              ELSE '{}'::jsonb END
    );

    -- 0Z (D-0Z-5) postcondition : nombre de provisional vivantes déterministe
    -- par journée après traitement (toute violation => rollback intégral).
    SELECT count(*) INTO v_live_provisional
    FROM public.daily_statement_units_staging
    WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'provisional';
    IF v_req_status[v_i] = 'provisional' AND v_live_provisional <> 1 THEN
      RAISE EXCEPTION 'DAILY_STMT_PROVISIONAL_POSTCONDITION: exactly one live provisional unit expected for a non-closed day (rollback)';
    ELSIF v_req_status[v_i] <> 'provisional' AND v_live_provisional <> 0 THEN
      RAISE EXCEPTION 'DAILY_STMT_PROVISIONAL_POSTCONDITION: no live provisional unit may survive a closed-day deposit (rollback)';
    END IF;

    v_result_units := v_result_units || jsonb_build_object(
      'day_unit_id', v_day_unit_ids[v_i],
      'unit_status', v_final,
      'staging_unit_id', v_staging_unit_id,
      'active_canonical_unit_id', v_active_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'requested_mode', v_mode,
    'units', v_result_units
  );
END;
$$;

COMMENT ON FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(jsonb, jsonb, jsonb, jsonb) IS
  'Cœur interne du dépôt Daily v2 (0H, renommé par 0U, cycle de vie provisional fermé par 0Z). Jamais exposé : seul le wrapper pre_ingest_daily_statement_units l''appelle.';

-- Double verrou re-affirmé : le cœur interne reste inexécutable par tout rôle
-- applicatif (CREATE OR REPLACE préserve l'ACL ; ceinture explicite).
REVOKE ALL ON FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
