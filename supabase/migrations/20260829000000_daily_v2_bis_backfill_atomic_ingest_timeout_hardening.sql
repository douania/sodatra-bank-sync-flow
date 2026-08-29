-- =============================================================================
-- DAILY-V2 — BIS BACKFILL ATOMIC INGEST TIMEOUT HARDENING
-- =============================================================================
-- Optimise uniquement l'enrichissement 0U post-ingestion : les motifs de
-- review et leurs événements d'audit sont appliqués en deux écritures
-- ensemblistes au lieu de N updates + N*M inserts PL/pgSQL.
--
-- Invariants conservés :
--   * le cœur 0H/0Z reste l'unique arbitre R1/R2/R3 et reste atomique ;
--   * le grant BIS est verrouillé puis consommé dans la même transaction ;
--   * aucun chunk inter-transaction, aucune écriture partielle ;
--   * les codes de review passent toujours par la whitelist canonique ;
--   * Auth/RLS/ACL et garde runtime restent inchangés.
-- =============================================================================

BEGIN;

-- Point d'écriture interne spécialisé pour les événements de revue en masse.
-- SECURITY INVOKER est volontaire : seul le propriétaire, déjà actif dans le
-- wrapper SECURITY DEFINER, peut l'exécuter après les REVOKE ci-dessous.
CREATE OR REPLACE FUNCTION public.daily_stmt_append_audit_events_0v(p_events jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'DAILY_STMT_AUDIT_BATCH_INVALID: event array required (rollback)';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_events) e(value)
    WHERE jsonb_typeof(e.value) <> 'object'
       OR coalesce(e.value ->> 'actor_id','') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       OR coalesce(e.value ->> 'attempt_id','') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       OR (e.value ->> 'staging_unit_id' IS NOT NULL AND e.value ->> 'staging_unit_id' !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')
       OR (e.value ->> 'canonical_unit_id' IS NOT NULL AND e.value ->> 'canonical_unit_id' !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')
       OR nullif(btrim(coalesce(e.value ->> 'event_type','')),'') IS NULL
       OR nullif(btrim(coalesce(e.value ->> 'safe_message','')),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_AUDIT_BATCH_SHAPE: safe event identity and message required (rollback)';
  END IF;

  PERFORM public.daily_stmt_assert_safe_details(e.value -> 'safe_details')
  FROM jsonb_array_elements(p_events) e(value);

  INSERT INTO public.daily_statement_import_events (
    actor_id, attempt_id, staging_unit_id, canonical_unit_id,
    day_unit_id, raw_text_hash, event_type, previous_status, new_status,
    safe_message, safe_details
  )
  SELECT
    (e.value ->> 'actor_id')::uuid,
    (e.value ->> 'attempt_id')::uuid,
    (e.value ->> 'staging_unit_id')::uuid,
    (e.value ->> 'canonical_unit_id')::uuid,
    e.value ->> 'day_unit_id',
    e.value ->> 'raw_text_hash',
    e.value ->> 'event_type',
    e.value ->> 'previous_status',
    e.value ->> 'new_status',
    e.value ->> 'safe_message',
    e.value -> 'safe_details'
  FROM jsonb_array_elements(p_events) e(value);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.daily_stmt_append_audit_events_0v(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.daily_stmt_append_audit_events_0v(jsonb) IS
  'Internal set-based audit writer for validated Daily v2 events; no API role can execute it.';

COMMENT ON TABLE public.daily_statement_import_events IS
  'Audit append-only. INSERT uniquement via les fonctions internes daily_stmt_append_audit_event et daily_stmt_append_audit_events_0v (whitelist + scalaires). Aucune policy UPDATE/DELETE ; privilèges d''écriture révoqués.';

-- Chemin borné spécialisé pour le backfill BIS historique. Le chemin daily et
-- tous les autres profils restent servis par le cœur 0Z canonique. Ici, les
-- mêmes contrôles, arbitrages et écritures sont exécutés par lots SQL dans une
-- transaction unique afin de rester sous le budget de requête.
CREATE OR REPLACE FUNCTION public.daily_stmt_pre_ingest_bis_backfill_core_0v(
  p_attempt jsonb,
  p_units jsonb,
  p_lines jsonb,
  p_guard_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_attempt_id uuid;
  v_source_format text;
  v_currency text;
  v_fingerprint text;
  v_masked text;
  v_file_name text;
  v_raw_hash text;
  v_period_start date;
  v_period_end date;
  v_period_days integer;
  v_parser_status text;
  v_errors_count integer;
  v_warnings_count integer;
  v_units_count integer;
  v_decisions jsonb;
  v_events jsonb;
  v_expected integer;
  v_inserted integer;
  v_lock_day_unit_id text;
  c_attempt_allowed constant text[] := ARRAY[
    'requested_mode','source_format','bank','currency','account_fingerprint',
    'account_number_masked','source_file_name_redacted','raw_text_hash',
    'export_period_start','export_period_end','statement_date',
    'export_reference_date','parser_validation_status','errors_count',
    'warnings_count','runtime_version','parser_version'
  ];
  c_unit_allowed constant text[] := ARRAY[
    'day_unit_id','accounting_date','day_content_hash','line_count',
    'day_total_debits','day_total_credits','opening_balance_derived',
    'closing_balance_derived','aggregates_status','validation_status',
    'requested_unit_status'
  ];
  c_line_allowed constant text[] := ARRAY[
    'day_unit_id','daily_line_hash','daily_occurrence_ordinal',
    'source_line_index','accounting_date','value_date',
    'description_sanitized','debit_amount','credit_amount','signed_amount',
    'running_balance','direction','currency'
  ];
  c_guard_allowed constant text[] := ARRAY[
    'ingestion_ready','period_days','bridge_guard_passed',
    'backfill_grant_reference'
  ];
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor,'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_ADMIN_ONLY: backfill deposits require the admin role (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_attempt,'$.p_attempt');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_guard_context,'$.p_guard_context');
  PERFORM public.daily_stmt_assert_object_keys(p_attempt,c_attempt_allowed,'p_attempt');
  PERFORM public.daily_stmt_assert_object_keys(p_guard_context,c_guard_allowed,'p_guard_context');
  IF p_units IS NULL OR jsonb_typeof(p_units) <> 'array' OR jsonb_array_length(p_units)=0
     OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_ARRAYS_REQUIRED: non-empty unit and line arrays required (fail-closed)';
  END IF;

  IF p_attempt ->> 'requested_mode' <> 'backfill'
     OR btrim(coalesce(p_attempt ->> 'bank','')) <> 'BIS' THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_SCOPE: optimized core accepts BIS backfill only (fail-closed)';
  END IF;
  -- Un backfill historique ne contient aucune journée non close. Ce contrat
  -- réduit la surface du chemin massif ; tout autre cas reste fail-closed.
  IF p_attempt ->> 'export_reference_date' IS NOT NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_REFERENCE_DATE_FORBIDDEN: historical backfill must contain closed days only (fail-closed)';
  END IF;
  v_source_format := nullif(btrim(coalesce(p_attempt ->> 'source_format','')),'');
  v_currency := nullif(btrim(coalesce(p_attempt ->> 'currency','')),'');
  v_fingerprint := nullif(btrim(coalesce(p_attempt ->> 'account_fingerprint','')),'');
  IF v_source_format IS NULL OR v_currency IS NULL OR v_fingerprint IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_SOURCE_REQUIRED: source format, currency and fingerprint required (fail-closed)';
  END IF;
  v_masked := nullif(btrim(coalesce(p_attempt ->> 'account_number_masked','')),'');
  PERFORM public.daily_stmt_assert_masked_account(v_masked);
  v_file_name := nullif(btrim(coalesce(p_attempt ->> 'source_file_name_redacted','')),'');
  PERFORM public.daily_stmt_assert_safe_file_name(v_file_name);
  v_raw_hash := public.daily_stmt_assert_hex64(p_attempt ->> 'raw_text_hash','raw_text_hash');
  v_period_start := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_start');
  v_period_end := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_end');
  IF v_period_end < v_period_start THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_INCOHERENT: invalid export window (fail-closed)';
  END IF;
  v_parser_status := p_attempt ->> 'parser_validation_status';
  IF v_parser_status NOT IN ('valid','needs_review') THEN
    RAISE EXCEPTION 'DAILY_STMT_PARSER_STATUS: invalid parser status (fail-closed)';
  END IF;
  IF coalesce(p_attempt ->> 'errors_count','0') !~ '^[0-9]+$'
     OR coalesce(p_attempt ->> 'warnings_count','0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DAILY_STMT_COUNT_INVALID: non-negative integer counts required (fail-closed)';
  END IF;
  v_errors_count := coalesce(p_attempt ->> 'errors_count','0')::integer;
  v_warnings_count := coalesce(p_attempt ->> 'warnings_count','0')::integer;
  IF jsonb_typeof(p_guard_context -> 'ingestion_ready') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_guard_context -> 'bridge_guard_passed') IS DISTINCT FROM 'boolean'
     OR (p_guard_context ->> 'bridge_guard_passed')::boolean IS NOT TRUE
     OR coalesce(p_guard_context ->> 'period_days','') !~ '^[0-9]+$'
     OR nullif(btrim(coalesce(p_guard_context ->> 'backfill_grant_reference','')),'') IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_GUARD_INVALID: explicit valid guard and grant required (fail-closed)';
  END IF;
  v_period_days := (p_guard_context ->> 'period_days')::integer;
  IF v_period_days <> v_period_end-v_period_start+1 OR v_period_days > 4000 THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_PERIOD_CAP: period mismatch or structural cap exceeded (fail-closed)';
  END IF;
  v_units_count := jsonb_array_length(p_units);
  IF v_units_count > 4000 THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_UNITS_CAP: structural unit cap exceeded (fail-closed)';
  END IF;

  -- Formes plates et whitelists : les valeurs objet/tableau sont interdites,
  -- donc aucune clé profonde ne peut contourner l'anti-smuggling.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_units) WITH ORDINALITY u(value,ord)
    WHERE jsonb_typeof(value) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) k WHERE NOT k=ANY(c_unit_allowed))
       OR EXISTS (SELECT 1 FROM jsonb_each(value) kv WHERE jsonb_typeof(kv.value) IN ('object','array'))
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) WITH ORDINALITY l(value,ord)
    WHERE jsonb_typeof(value) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) k WHERE NOT k=ANY(c_line_allowed))
       OR EXISTS (SELECT 1 FROM jsonb_each(value) kv WHERE jsonb_typeof(kv.value) IN ('object','array'))
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_PAYLOAD_KEY: BIS backfill row outside flat whitelist (fail-closed)';
  END IF;

  -- Validation des unités en un statement : identités recalculées, domaines,
  -- agrégats et unicité restent strictement contrôlés côté serveur.
  IF EXISTS (
    WITH u AS MATERIALIZED (
      SELECT ord, value,
        btrim(value ->> 'accounting_date') AS accounting_raw,
        public.daily_stmt_parse_date_strict(value ->> 'accounting_date') AS accounting_date
      FROM jsonb_array_elements(p_units) WITH ORDINALITY x(value,ord)
    )
    SELECT 1 FROM u
    WHERE value ->> 'day_unit_id' !~ '^[0-9a-f]{64}$'
       OR value ->> 'day_content_hash' !~ '^[0-9a-f]{64}$'
       OR value ->> 'day_unit_id' <>
          public.daily_stmt_day_unit_id('BIS',v_fingerprint,v_currency,accounting_raw)
       OR coalesce(value ->> 'line_count','') !~ '^[0-9]+$'
       OR (value ->> 'line_count')::integer < 1
       OR value ->> 'day_total_debits' IS NULL
       OR value ->> 'day_total_credits' IS NULL
       OR public.daily_stmt_parse_amount_strict(value ->> 'day_total_debits') IS NULL
       OR public.daily_stmt_parse_amount_strict(value ->> 'day_total_credits') IS NULL
       OR value ->> 'aggregates_status' NOT IN ('derived','unavailable')
       OR value ->> 'validation_status' NOT IN ('valid','needs_review')
       OR value ->> 'requested_unit_status' <> 'staged'
       OR (value ->> 'aggregates_status'='derived' AND
           (value ->> 'opening_balance_derived' IS NULL OR value ->> 'closing_balance_derived' IS NULL))
       OR (value ->> 'aggregates_status'='unavailable' AND
           (value ->> 'opening_balance_derived' IS NOT NULL OR value ->> 'closing_balance_derived' IS NOT NULL))
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_units) u(value)
    GROUP BY value ->> 'day_unit_id' HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_UNIT_INVALID: identity, aggregate or status invariant failed (fail-closed)';
  END IF;

  -- Validation des lignes et de leur jointure à l'unité, également ensembliste.
  IF EXISTS (
    WITH units AS MATERIALIZED (
      SELECT value ->> 'day_unit_id' AS day_unit_id,
             public.daily_stmt_parse_date_strict(value ->> 'accounting_date') AS accounting_date
      FROM jsonb_array_elements(p_units) u(value)
    ), lines AS MATERIALIZED (
      SELECT ord, value,
        public.daily_stmt_parse_amount_strict(value ->> 'signed_amount') AS signed_amount,
        public.daily_stmt_parse_amount_strict(value ->> 'debit_amount') AS debit_amount,
        public.daily_stmt_parse_amount_strict(value ->> 'credit_amount') AS credit_amount
      FROM jsonb_array_elements(p_lines) WITH ORDINALITY l(value,ord)
    )
    SELECT 1 FROM lines l LEFT JOIN units u ON u.day_unit_id=l.value ->> 'day_unit_id'
    WHERE u.day_unit_id IS NULL
       OR l.value ->> 'daily_line_hash' !~ '^[0-9a-f]{64}$'
       OR coalesce(l.value ->> 'daily_occurrence_ordinal','') !~ '^[0-9]+$'
       OR (l.value ->> 'daily_occurrence_ordinal')::integer < 1
       OR coalesce(l.value ->> 'source_line_index','') !~ '^[0-9]+$'
       OR public.daily_stmt_parse_date_strict(l.value ->> 'accounting_date') <> u.accounting_date
       OR (l.value ->> 'value_date' IS NOT NULL AND
           public.daily_stmt_parse_date_strict(l.value ->> 'value_date') IS NULL)
       OR nullif(btrim(coalesce(l.value ->> 'description_sanitized','')),'') IS NULL
       OR l.value ->> 'direction' NOT IN ('debit','credit')
       OR l.signed_amount IS NULL
       OR NOT ((l.value ->> 'direction'='debit' AND l.debit_amount IS NOT NULL
                 AND l.credit_amount IS NULL AND l.signed_amount < 0
                 AND abs(l.signed_amount)=l.debit_amount)
            OR (l.value ->> 'direction'='credit' AND l.credit_amount IS NOT NULL
                 AND l.debit_amount IS NULL AND l.signed_amount > 0
                 AND l.signed_amount=l.credit_amount))
       OR btrim(coalesce(l.value ->> 'currency','')) <> v_currency
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) l(value)
    GROUP BY value ->> 'day_unit_id', value ->> 'daily_line_hash'
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_LINE_INVALID: line identity, amount or join invariant failed (fail-closed)';
  END IF;

  IF EXISTS (
    WITH declared AS MATERIALIZED (
      SELECT value ->> 'day_unit_id' AS day_unit_id,
             (value ->> 'line_count')::integer AS line_count,
             value ->> 'day_content_hash' AS content_hash
      FROM jsonb_array_elements(p_units) u(value)
    ), actual AS MATERIALIZED (
      SELECT value ->> 'day_unit_id' AS day_unit_id,
             count(*)::integer AS line_count,
             array_agg(value ->> 'daily_line_hash') AS hashes
      FROM jsonb_array_elements(p_lines) l(value)
      GROUP BY value ->> 'day_unit_id'
    )
    SELECT 1 FROM declared d LEFT JOIN actual a USING(day_unit_id)
    WHERE a.line_count IS NULL OR a.line_count<>d.line_count
       OR public.daily_stmt_day_content_hash(d.day_unit_id,a.hashes)<>d.content_hash
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_CONTENT_MISMATCH: line count or content hash mismatch (fail-closed)';
  END IF;

  INSERT INTO public.daily_statement_export_attempts (
    created_by,requested_mode,source_format,bank,currency,account_fingerprint,
    account_number_masked,source_file_name_redacted,raw_text_hash,
    export_period_start,export_period_end,statement_date,export_reference_date,
    parser_validation_status,errors_count,warnings_count,runtime_version,
    parser_version,ingestion_ready,bridge_guard_passed,period_days,
    backfill_grant_reference,units_total
  ) VALUES (
    v_actor,'backfill',v_source_format,'BIS',v_currency,v_fingerprint,v_masked,
    v_file_name,v_raw_hash,v_period_start,v_period_end,
    CASE WHEN p_attempt ->> 'statement_date' IS NULL THEN NULL
         ELSE public.daily_stmt_parse_date_strict(p_attempt ->> 'statement_date') END,
    NULL,v_parser_status,v_errors_count,v_warnings_count,
    nullif(btrim(coalesce(p_attempt ->> 'runtime_version','')),''),
    nullif(btrim(coalesce(p_attempt ->> 'parser_version','')),''),
    (p_guard_context ->> 'ingestion_ready')::boolean,TRUE,v_period_days,
    p_guard_context ->> 'backfill_grant_reference',v_units_count
  ) RETURNING id INTO v_attempt_id;

  PERFORM public.daily_stmt_append_audit_event(
    v_actor,v_attempt_id,NULL,NULL,NULL,v_raw_hash,'attempt_received',NULL,NULL,
    'daily statement export deposit received',
    jsonb_build_object('requested_mode','backfill','units_total',v_units_count,'period_days',v_period_days)
  );
  PERFORM public.daily_stmt_append_audit_event(
    v_actor,v_attempt_id,NULL,NULL,NULL,v_raw_hash,'backfill_deposit',NULL,NULL,
    'backfill deposit under explicit grant',
    jsonb_build_object('backfill_grant_reference',p_guard_context ->> 'backfill_grant_reference',
                       'period_days',v_period_days,'units_total',v_units_count)
  );

  -- Le curseur PL/pgSQL porte l'ordre contractuel d'acquisition. Une simple
  -- sous-requête ORDER BY ne garantit pas l'ordre d'évaluation des fonctions
  -- VOLATILE dans la requête englobante.
  FOR v_lock_day_unit_id IN
    SELECT value ->> 'day_unit_id' AS day_unit_id
    FROM jsonb_array_elements(p_units) u(value)
    ORDER BY value ->> 'day_unit_id' COLLATE "C"
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_day_unit_id,0));
  END LOOP;

  WITH units AS MATERIALIZED (
    SELECT value ->> 'day_unit_id' AS day_unit_id,
           value ->> 'day_content_hash' AS content_hash,
           (value ->> 'line_count')::integer AS line_count
    FROM jsonb_array_elements(p_units) u(value)
  ), overlap_days AS MATERIALIZED (
    SELECT DISTINCT l.value ->> 'day_unit_id' AS day_unit_id
    FROM jsonb_array_elements(p_lines) l(value)
    JOIN public.daily_statement_lines_canonical c
      ON c.daily_line_hash=l.value ->> 'daily_line_hash' AND c.is_active
    WHERE c.day_unit_id<>l.value ->> 'day_unit_id'
  ), decisions AS (
    SELECT u.day_unit_id,u.content_hash,u.line_count,gen_random_uuid() AS staging_unit_id,
           c.id AS active_id,
           CASE WHEN c.id IS NOT NULL AND c.active_day_content_hash=u.content_hash THEN 'duplicate'
                WHEN c.id IS NOT NULL THEN 'conflict'
                WHEN o.day_unit_id IS NOT NULL THEN 'needs_review'
                ELSE 'staged' END AS final_status
    FROM units u
    LEFT JOIN public.daily_statement_units_canonical c
      ON c.day_unit_id=u.day_unit_id AND c.status='ingested'
    LEFT JOIN overlap_days o ON o.day_unit_id=u.day_unit_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'day_unit_id',day_unit_id,'day_content_hash',content_hash,
    'line_count',line_count,
    'staging_unit_id',staging_unit_id,'active_id',active_id,
    'final_status',final_status
  ) ORDER BY day_unit_id COLLATE "C") INTO v_decisions FROM decisions;

  -- Toute provisional de ces journées historiques devient superseded avant
  -- l'insertion des versions closes, avec audit append-only en masse.
  WITH input_days AS MATERIALIZED (
    SELECT value ->> 'day_unit_id' AS day_unit_id FROM jsonb_array_elements(p_units) u(value)
  ), swept AS (
    UPDATE public.daily_statement_units_staging s SET status='superseded'
    FROM input_days d
    WHERE s.day_unit_id=d.day_unit_id AND s.status='provisional'
    RETURNING s.id,s.day_unit_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'actor_id',v_actor,'attempt_id',v_attempt_id,'staging_unit_id',id,
    'canonical_unit_id',NULL,'day_unit_id',day_unit_id,'raw_text_hash',v_raw_hash,
    'event_type','status_changed','previous_status','provisional','new_status','superseded',
    'safe_message','stale provisional unit superseded: the day is now closed',
    'safe_details',jsonb_build_object('reason_code','provisional_superseded_by_day_closure',
      'day_unit_id',day_unit_id,'previous_status','provisional','new_status','superseded')
  )),'[]'::jsonb) INTO v_events FROM swept;
  IF jsonb_array_length(v_events)>0 THEN
    v_inserted := public.daily_stmt_append_audit_events_0v(v_events);
    IF v_inserted<>jsonb_array_length(v_events) THEN
      RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_SWEEP_AUDIT: audit cardinality mismatch (rollback)';
    END IF;
  END IF;

  INSERT INTO public.daily_statement_units_staging (
    id,attempt_id,day_unit_id,bank,account_fingerprint,currency,accounting_date,
    day_content_hash,line_count,day_total_debits,day_total_credits,
    opening_balance_derived,closing_balance_derived,aggregates_status,
    validation_status,status,created_by
  )
  SELECT (d.value ->> 'staging_unit_id')::uuid,v_attempt_id,
    u.value ->> 'day_unit_id','BIS',v_fingerprint,v_currency,
    public.daily_stmt_parse_date_strict(u.value ->> 'accounting_date'),
    u.value ->> 'day_content_hash',(u.value ->> 'line_count')::integer,
    public.daily_stmt_parse_amount_strict(u.value ->> 'day_total_debits'),
    public.daily_stmt_parse_amount_strict(u.value ->> 'day_total_credits'),
    public.daily_stmt_parse_amount_strict(u.value ->> 'opening_balance_derived'),
    public.daily_stmt_parse_amount_strict(u.value ->> 'closing_balance_derived'),
    u.value ->> 'aggregates_status',u.value ->> 'validation_status',
    d.value ->> 'final_status',v_actor
  FROM jsonb_array_elements(p_units) u(value)
  JOIN jsonb_array_elements(v_decisions) d(value)
    ON d.value ->> 'day_unit_id'=u.value ->> 'day_unit_id';
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  IF v_inserted<>v_units_count THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_UNIT_CARDINALITY: every unit must stage (rollback)';
  END IF;

  INSERT INTO public.daily_statement_lines_staging (
    staging_unit_id,attempt_id,day_unit_id,daily_line_hash,
    daily_occurrence_ordinal,source_line_index,accounting_date,value_date,
    description_sanitized,debit_amount,credit_amount,signed_amount,
    running_balance,direction,currency
  )
  SELECT (d.value ->> 'staging_unit_id')::uuid,v_attempt_id,
    l.value ->> 'day_unit_id',l.value ->> 'daily_line_hash',
    (l.value ->> 'daily_occurrence_ordinal')::integer,
    (l.value ->> 'source_line_index')::integer,
    public.daily_stmt_parse_date_strict(l.value ->> 'accounting_date'),
    CASE WHEN l.value ->> 'value_date' IS NULL THEN NULL
         ELSE public.daily_stmt_parse_date_strict(l.value ->> 'value_date') END,
    l.value ->> 'description_sanitized',
    public.daily_stmt_parse_amount_strict(l.value ->> 'debit_amount'),
    public.daily_stmt_parse_amount_strict(l.value ->> 'credit_amount'),
    public.daily_stmt_parse_amount_strict(l.value ->> 'signed_amount'),
    public.daily_stmt_parse_amount_strict(l.value ->> 'running_balance'),
    l.value ->> 'direction',btrim(l.value ->> 'currency')
  FROM jsonb_array_elements(p_lines) l(value)
  JOIN jsonb_array_elements(v_decisions) d(value)
    ON d.value ->> 'day_unit_id'=l.value ->> 'day_unit_id'
  WHERE d.value ->> 'final_status'<>'duplicate';
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  SELECT count(*)::integer INTO v_expected
  FROM jsonb_array_elements(p_lines) l(value)
  JOIN jsonb_array_elements(v_decisions) d(value)
    ON d.value ->> 'day_unit_id'=l.value ->> 'day_unit_id'
  WHERE d.value ->> 'final_status'<>'duplicate';
  IF v_inserted<>v_expected THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_LINE_CARDINALITY: every non-duplicate line must stage (rollback)';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'actor_id',v_actor,'attempt_id',v_attempt_id,
    'staging_unit_id',value ->> 'staging_unit_id',
    'canonical_unit_id',value ->> 'active_id','day_unit_id',value ->> 'day_unit_id',
    'raw_text_hash',v_raw_hash,
    'event_type',CASE value ->> 'final_status'
      WHEN 'staged' THEN 'unit_staged' WHEN 'duplicate' THEN 'unit_duplicate'
      WHEN 'conflict' THEN 'unit_conflict' ELSE 'unit_needs_review' END,
    'previous_status',NULL,'new_status',value ->> 'final_status',
    'safe_message',CASE value ->> 'final_status'
      WHEN 'staged' THEN 'daily unit staged'
      WHEN 'duplicate' THEN 'exact duplicate of the active canonical day (R1)'
      WHEN 'conflict' THEN 'same day_unit_id with different day_content_hash than active canonical (R2)'
      ELSE 'active daily_line_hash overlap with another day unit (R3)' END,
    'safe_details',jsonb_build_object('day_unit_id',value ->> 'day_unit_id',
      'day_content_hash',value ->> 'day_content_hash',
      'line_count',(value ->> 'line_count')::integer
  ))),'[]'::jsonb) INTO v_events
  FROM jsonb_array_elements(v_decisions) d(value);
  v_inserted:=public.daily_stmt_append_audit_events_0v(v_events);
  IF v_inserted<>v_units_count THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_AUDIT_CARDINALITY: one unit event required (rollback)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.daily_statement_units_staging s
    JOIN jsonb_array_elements(v_decisions) d(value)
      ON d.value ->> 'day_unit_id'=s.day_unit_id
    WHERE s.status='provisional'
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_PROVISIONAL_POSTCONDITION: no live provisional may survive historical backfill (rollback)';
  END IF;

  RETURN jsonb_build_object(
    'attempt_id',v_attempt_id,'requested_mode','backfill','units',
    (SELECT jsonb_agg(jsonb_build_object(
      'day_unit_id',value ->> 'day_unit_id','unit_status',value ->> 'final_status',
      'staging_unit_id',value ->> 'staging_unit_id',
      'active_canonical_unit_id',value ->> 'active_id'
    ) ORDER BY value ->> 'day_unit_id' COLLATE "C")
     FROM jsonb_array_elements(v_decisions) d(value))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.daily_stmt_pre_ingest_bis_backfill_core_0v(jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.daily_stmt_pre_ingest_bis_backfill_core_0v(jsonb,jsonb,jsonb,jsonb) IS
  'Internal atomic set-based core for bounded closed-day BIS backfills; never executable by API roles.';

CREATE OR REPLACE FUNCTION public.pre_ingest_daily_statement_units(
  p_attempt jsonb,
  p_units jsonb,
  p_lines jsonb,
  p_guard_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_account_id uuid;
  v_account public.daily_statement_account_registry%ROWTYPE;
  v_identity_corroborated boolean;
  v_grant_id uuid;
  v_grant public.daily_statement_backfill_grants%ROWTYPE;
  v_attempt_codes text[];
  v_legacy_attempt jsonb;
  v_legacy_units jsonb;
  v_legacy_guard jsonb;
  v_result jsonb;
  v_attempt_id uuid;
  v_review_units jsonb;
  v_review_events jsonb;
  v_review_event_count integer;
  v_expected_review_event_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF p_attempt IS NULL OR jsonb_typeof(p_attempt) <> 'object' THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTEMPT_OBJECT_REQUIRED (fail-closed)';
  END IF;
  IF coalesce(p_attempt ->> 'account_registry_id','') !~
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_REGISTRY_ID_REQUIRED (fail-closed)';
  END IF;
  v_account_id := (p_attempt ->> 'account_registry_id')::uuid;
  SELECT * INTO v_account FROM public.daily_statement_account_registry
   WHERE id=v_account_id AND status='active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_REGISTRY_ACTIVE_NOT_FOUND (fail-closed)';
  END IF;
  IF v_account.bank <> btrim(coalesce(p_attempt ->> 'bank',''))
     OR v_account.currency <> btrim(coalesce(p_attempt ->> 'currency',''))
     OR v_account.account_fingerprint <> btrim(coalesce(p_attempt ->> 'account_fingerprint','')) THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_CONTEXT_MISMATCH: registry/bank/currency/fingerprint mismatch (fail-closed)';
  END IF;
  IF v_account.account_number_masked IS NOT NULL
     AND nullif(btrim(coalesce(p_attempt ->> 'account_number_masked','')),'') IS NOT NULL
     AND v_account.account_number_masked <>
         nullif(btrim(coalesce(p_attempt ->> 'account_number_masked','')),'') THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_MASK_MISMATCH: parsed and provisioned masked identities differ (fail-closed)';
  END IF;
  v_identity_corroborated := v_account.account_number_masked IS NOT NULL
    AND v_account.account_number_masked =
        nullif(btrim(coalesce(p_attempt ->> 'account_number_masked','')),'');

  v_attempt_codes := public.daily_stmt_review_reason_codes(p_attempt -> 'review_reason_codes');
  IF NOT v_identity_corroborated
     AND NOT ('ACCOUNT_IDENTITY_NOT_CORROBORATED' = ANY (v_attempt_codes)) THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_REVIEW_REQUIRED: uncorroborated account identity must be explicit (fail-closed)';
  END IF;
  IF p_units IS NULL OR jsonb_typeof(p_units) <> 'array' OR jsonb_array_length(p_units)=0 THEN
    RAISE EXCEPTION 'DAILY_STMT_UNITS_REQUIRED: non-empty array required (fail-closed)';
  END IF;
  SELECT jsonb_agg(e.value - 'review_reason_codes' ORDER BY e.ord)
    INTO v_legacy_units
  FROM jsonb_array_elements(p_units) WITH ORDINALITY e(value,ord);

  IF p_guard_context IS NULL OR jsonb_typeof(p_guard_context) <> 'object' THEN
    RAISE EXCEPTION 'DAILY_STMT_GUARD_OBJECT_REQUIRED (fail-closed)';
  END IF;
  IF p_attempt ->> 'requested_mode' = 'backfill' THEN
    IF coalesce(p_guard_context ->> 'backfill_grant_id','') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_GRANT_ID_REQUIRED (fail-closed)';
    END IF;
    v_grant_id := (p_guard_context ->> 'backfill_grant_id')::uuid;
    SELECT * INTO v_grant FROM public.daily_statement_backfill_grants
     WHERE id=v_grant_id FOR UPDATE;
    IF NOT FOUND OR v_grant.status <> 'active' OR v_grant.expires_at <= now()
       OR v_grant.account_registry_id <> v_account.id
       OR v_account.bank <> 'BIS'
       OR v_grant.period_start > public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_start')
       OR v_grant.period_end < public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_end')
       OR v_grant.max_units < jsonb_array_length(p_units) THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_GRANT_INVALID: grant absent, expired, consumed or out of scope (fail-closed)';
    END IF;
    v_legacy_guard := (p_guard_context - 'backfill_grant_id')
      || jsonb_build_object('backfill_grant_reference',v_grant_id::text);
  ELSE
    IF p_guard_context ? 'backfill_grant_id' AND p_guard_context -> 'backfill_grant_id' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_GRANT_FORBIDDEN: daily mode cannot carry a grant (fail-closed)';
    END IF;
    v_legacy_guard := p_guard_context - 'backfill_grant_id';
  END IF;

  v_legacy_attempt := p_attempt - 'account_registry_id' - 'review_reason_codes';
  IF p_attempt ->> 'requested_mode' = 'backfill' THEN
    v_result := public.daily_stmt_pre_ingest_bis_backfill_core_0v(
      v_legacy_attempt, v_legacy_units, p_lines, v_legacy_guard
    );
  ELSE
    v_result := public.daily_stmt_pre_ingest_legacy_core_0u(
      v_legacy_attempt, v_legacy_units, p_lines, v_legacy_guard
    );
  END IF;
  v_attempt_id := (v_result ->> 'attempt_id')::uuid;

  UPDATE public.daily_statement_export_attempts
     SET account_registry_id=v_account.id,
         backfill_grant_id=v_grant_id,
         review_reason_codes=v_attempt_codes
   WHERE id=v_attempt_id;

  -- Matérialise une seule fois les motifs validés et le résultat d'arbitrage.
  -- Aucun objet temporaire n'est créé dans cette SECURITY DEFINER : la surface
  -- de temp-table poisoning reste donc fermée.
  WITH unit_input AS MATERIALIZED (
    SELECT
      e.value ->> 'day_unit_id' AS day_unit_id,
      e.value ->> 'validation_status' AS validation_status,
      public.daily_stmt_review_reason_codes(e.value -> 'review_reason_codes') AS codes
    FROM jsonb_array_elements(p_units) WITH ORDINALITY e(value, ord)
  ), result_units AS MATERIALIZED (
    SELECT
      e.value ->> 'day_unit_id' AS day_unit_id,
      e.value
    FROM jsonb_array_elements(v_result -> 'units') e(value)
  ), resolved AS MATERIALIZED (
    SELECT
      u.day_unit_id,
      u.validation_status,
      s.id AS staging_unit_id,
      r.value ->> 'unit_status' AS unit_status,
      CASE
        WHEN r.value ->> 'unit_status' = 'needs_review'
             AND NOT ('ACTIVE_LINE_HASH_SCOPE_CONFLICT' = ANY (u.codes))
          THEN array_append(u.codes, 'ACTIVE_LINE_HASH_SCOPE_CONFLICT')
        ELSE u.codes
      END AS codes
    FROM unit_input u
    JOIN result_units r ON r.day_unit_id=u.day_unit_id
    JOIN public.daily_statement_units_staging s
      ON s.attempt_id=v_attempt_id AND s.day_unit_id=u.day_unit_id
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'day_unit_id', day_unit_id,
        'validation_status', validation_status,
        'staging_unit_id', staging_unit_id,
        'unit_status', unit_status,
        'review_reason_codes', to_jsonb(codes)
      ) ORDER BY day_unit_id COLLATE "C"
    ),
    '[]'::jsonb
  ) INTO v_review_units
  FROM resolved;

  IF jsonb_array_length(v_review_units) <> jsonb_array_length(p_units) THEN
    RAISE EXCEPTION 'DAILY_STMT_REVIEW_BATCH_CARDINALITY: every input unit requires one staging result (rollback)';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_review_units) e(value)
    WHERE jsonb_array_length(e.value -> 'review_reason_codes') > 0
      AND e.value ->> 'validation_status' <> 'needs_review'
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_REVIEW_STATUS_MISMATCH: coded review reasons require needs_review status (rollback)';
  END IF;
  IF NOT v_identity_corroborated AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_review_units) e(value)
    WHERE NOT (e.value -> 'review_reason_codes' ? 'ACCOUNT_IDENTITY_NOT_CORROBORATED')
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_REVIEW_REQUIRED: every uncorroborated unit requires an explicit reason (rollback)';
  END IF;

  UPDATE public.daily_statement_units_staging s
     SET account_registry_id=v_account.id,
         review_reason_codes=ARRAY(
           SELECT jsonb_array_elements_text(e.value -> 'review_reason_codes')
         )
    FROM jsonb_array_elements(v_review_units) e(value)
   WHERE s.id=(e.value ->> 'staging_unit_id')::uuid
     AND s.attempt_id=v_attempt_id;

  SELECT coalesce(sum(jsonb_array_length(e.value -> 'review_reason_codes')),0)
    INTO v_expected_review_event_count
  FROM jsonb_array_elements(v_review_units) e(value);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'actor_id',v_actor,
    'attempt_id',v_attempt_id,
    'staging_unit_id',e.value ->> 'staging_unit_id',
    'canonical_unit_id',NULL,
    'day_unit_id',e.value ->> 'day_unit_id',
    'raw_text_hash',NULL,
    'event_type','status_changed',
    'previous_status',NULL,
    'new_status',NULL,
    'safe_message','review reason recorded',
    'safe_details',jsonb_build_object('reason_code',code)
  ) ORDER BY e.value ->> 'day_unit_id' COLLATE "C", code),'[]'::jsonb)
    INTO v_review_events
  FROM jsonb_array_elements(v_review_units) e(value)
  CROSS JOIN LATERAL jsonb_array_elements_text(e.value -> 'review_reason_codes') code;
  v_review_event_count := public.daily_stmt_append_audit_events_0v(v_review_events);
  IF v_review_event_count <> v_expected_review_event_count THEN
    RAISE EXCEPTION 'DAILY_STMT_REVIEW_AUDIT_CARDINALITY: every reason requires one audit event (rollback)';
  END IF;

  IF v_grant_id IS NOT NULL THEN
    UPDATE public.daily_statement_backfill_grants
       SET status='consumed', consumed_at=now(), consumed_by=v_actor,
           consumed_attempt_id=v_attempt_id
     WHERE id=v_grant_id AND status='active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_GRANT_CONSUME_RACE (rollback)';
    END IF;
    INSERT INTO public.daily_statement_account_events (
      actor_id, account_registry_id, backfill_grant_id, event_type, safe_message, safe_details
    ) VALUES (
      v_actor, v_account.id, v_grant_id, 'backfill_grant_consumed',
      'daily statement backfill grant consumed',
      jsonb_build_object('attempt_id',v_attempt_id)
    );
  END IF;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.pre_ingest_daily_statement_units(jsonb,jsonb,jsonb,jsonb) IS
  'Unique write path Daily v2. 0U review enrichment is set-based so a bounded BIS backfill remains atomic under the request timeout.';

REVOKE ALL ON FUNCTION public.pre_ingest_daily_statement_units(jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pre_ingest_daily_statement_units(jsonb,jsonb,jsonb,jsonb)
  TO authenticated;

COMMIT;
