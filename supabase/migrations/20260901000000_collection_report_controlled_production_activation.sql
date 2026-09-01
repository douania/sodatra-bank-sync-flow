-- ============================================================================
-- COLLECTION REPORT — CONTROLLED PRODUCTION ACTIVATION FOUNDATION
-- ============================================================================
-- Forward-only migration. No live environment is modified by this file alone.
--
-- Guarantees:
--   * fail-closed, expiring server-side promotion scope;
--   * one atomic RPC for the complete reviewed import unit;
--   * actor + command-key idempotency and serialized execution;
--   * strict server-side payload validation and bounded volume;
--   * mass row-shift detection before the first write;
--   * private before/after audit for every changed traceability key;
--   * direct INSERT and stable-identity UPDATE blocked outside the atomic RPC.
--
-- The canonical idempotency key remains (excel_filename, excel_source_row).
-- Existing historical migrations, constraints, indexes and the
-- trg_detect_collection_type trigger are intentionally left unchanged.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS collection_import_private;
REVOKE ALL ON SCHEMA collection_import_private
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE collection_import_private.runtime_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  promotion_scope_enabled boolean NOT NULL DEFAULT false,
  enabled_until timestamptz,
  change_reason text NOT NULL CHECK (
    char_length(btrim(change_reason)) BETWEEN 8 AND 240
    AND change_reason !~ '[[:cntrl:]]'
  ),
  changed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  changed_by text NOT NULL DEFAULT current_user,
  CHECK (
    (promotion_scope_enabled = false AND enabled_until IS NULL)
    OR (promotion_scope_enabled = true AND enabled_until IS NOT NULL)
  )
);

CREATE TABLE collection_import_private.runtime_control_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  previous_enabled boolean NOT NULL,
  new_enabled boolean NOT NULL,
  previous_enabled_until timestamptz,
  new_enabled_until timestamptz,
  safe_reason text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  changed_by text NOT NULL,
  transaction_id bigint NOT NULL
);

CREATE TABLE collection_import_private.commands (
  actor_id uuid NOT NULL,
  command_key uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{32}$'),
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 5000),
  result_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (actor_id, command_key),
  CHECK ((result_payload IS NULL) = (completed_at IS NULL))
);

-- Capability interne liée à la transaction courante. Contrairement à un GUC,
-- cette ligne ne peut pas être forgée par authenticated : le schéma privé ne
-- lui est pas accessible. Le trigger d'écriture exige cette preuve éphémère.
CREATE TABLE collection_import_private.write_contexts (
  transaction_id bigint PRIMARY KEY,
  actor_id uuid NOT NULL,
  command_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (actor_id, command_key)
    REFERENCES collection_import_private.commands(actor_id, command_key)
    ON DELETE RESTRICT
);

CREATE TABLE collection_import_private.row_audit (
  actor_id uuid NOT NULL,
  command_key uuid NOT NULL,
  excel_filename text NOT NULL,
  excel_source_row integer NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update')),
  before_row jsonb,
  after_row jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (actor_id, command_key, excel_filename, excel_source_row),
  FOREIGN KEY (actor_id, command_key)
    REFERENCES collection_import_private.commands(actor_id, command_key)
    ON DELETE RESTRICT
);

ALTER TABLE collection_import_private.runtime_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_import_private.runtime_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_import_private.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_import_private.write_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_import_private.row_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA collection_import_private
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA collection_import_private
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO collection_import_private.runtime_control (
  singleton,
  promotion_scope_enabled,
  enabled_until,
  change_reason,
  changed_by
) VALUES (
  true,
  false,
  NULL,
  'Initial fail-closed Collection Report production scope',
  current_user
);

CREATE FUNCTION collection_import_private.prepare_runtime_control_change_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COLLECTION_IMPORT_RUNTIME_CONTROL_DELETE_FORBIDDEN';
  END IF;

  IF NEW.singleton IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'COLLECTION_IMPORT_RUNTIME_CONTROL_SINGLETON_REQUIRED';
  END IF;

  IF NEW.promotion_scope_enabled IS NOT DISTINCT FROM OLD.promotion_scope_enabled
     AND NEW.enabled_until IS NOT DISTINCT FROM OLD.enabled_until
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COLLECTION_IMPORT_RUNTIME_CONTROL_MODE_UNCHANGED';
  END IF;

  IF char_length(btrim(NEW.change_reason)) NOT BETWEEN 8 AND 240
     OR NEW.change_reason ~ '[[:cntrl:]]'
     OR btrim(NEW.change_reason) = btrim(OLD.change_reason)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COLLECTION_IMPORT_RUNTIME_CONTROL_NEW_SAFE_REASON_REQUIRED';
  END IF;

  IF NEW.promotion_scope_enabled THEN
    IF NEW.enabled_until IS NULL
       OR NEW.enabled_until <= statement_timestamp()
       OR NEW.enabled_until > statement_timestamp() + interval '2 hours'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'COLLECTION_IMPORT_RUNTIME_CONTROL_EXPIRY_INVALID';
    END IF;
  ELSIF NEW.enabled_until IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COLLECTION_IMPORT_RUNTIME_CONTROL_LOCK_REQUIRES_NULL_EXPIRY';
  END IF;

  NEW.changed_at := statement_timestamp();
  NEW.changed_by := COALESCE(auth.uid()::text, session_user || '->' || current_user);
  RETURN NEW;
END;
$$;

CREATE FUNCTION collection_import_private.append_runtime_control_event_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO collection_import_private.runtime_control_events (
    previous_enabled,
    new_enabled,
    previous_enabled_until,
    new_enabled_until,
    safe_reason,
    changed_by,
    transaction_id
  ) VALUES (
    OLD.promotion_scope_enabled,
    NEW.promotion_scope_enabled,
    OLD.enabled_until,
    NEW.enabled_until,
    NEW.change_reason,
    NEW.changed_by,
    txid_current()
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER collection_import_runtime_control_prepare_v1
BEFORE UPDATE OR DELETE ON collection_import_private.runtime_control
FOR EACH ROW EXECUTE FUNCTION collection_import_private.prepare_runtime_control_change_v1();

CREATE TRIGGER collection_import_runtime_control_event_v1
AFTER UPDATE ON collection_import_private.runtime_control
FOR EACH ROW EXECUTE FUNCTION collection_import_private.append_runtime_control_event_v1();

CREATE FUNCTION collection_import_private.assert_promotion_scope_v1()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_enabled boolean;
  v_enabled_until timestamptz;
BEGIN
  SELECT control.promotion_scope_enabled, control.enabled_until
  INTO v_enabled, v_enabled_until
  FROM collection_import_private.runtime_control AS control
  WHERE control.singleton = true;

  IF COALESCE(v_enabled, false) IS NOT TRUE
     OR v_enabled_until IS NULL
     OR v_enabled_until <= statement_timestamp()
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '25006',
      MESSAGE = 'COLLECTION_IMPORT_SERVER_READ_ONLY';
  END IF;
END;
$$;

CREATE FUNCTION public.collection_report_promotion_enabled_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT control.promotion_scope_enabled
             AND control.enabled_until > statement_timestamp()
      FROM collection_import_private.runtime_control AS control
      WHERE control.singleton = true
    ),
    false
  );
$$;

CREATE FUNCTION collection_import_private.guard_collection_report_write_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_atomic_context boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM collection_import_private.write_contexts AS context
    WHERE context.transaction_id = txid_current()
      AND context.actor_id = auth.uid()
  ) INTO v_atomic_context;

  IF TG_OP = 'INSERT' AND NOT v_atomic_context THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COLLECTION_IMPORT_ATOMIC_RPC_REQUIRED';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       NEW.excel_filename IS DISTINCT FROM OLD.excel_filename
       OR NEW.excel_source_row IS DISTINCT FROM OLD.excel_source_row
       OR NEW.report_date IS DISTINCT FROM OLD.report_date
       OR NEW.client_code IS DISTINCT FROM OLD.client_code
       OR NEW.collection_amount IS DISTINCT FROM OLD.collection_amount
       OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
       OR NEW.facture_no IS DISTINCT FROM OLD.facture_no
       OR NEW.no_chq_bd IS DISTINCT FROM OLD.no_chq_bd
     )
     AND NOT v_atomic_context
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COLLECTION_IMPORT_ATOMIC_RPC_REQUIRED';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_report_atomic_write_guard_v1
BEFORE INSERT OR UPDATE ON public.collection_report
FOR EACH ROW EXECUTE FUNCTION collection_import_private.guard_collection_report_write_v1();

CREATE FUNCTION public.import_collection_report_atomic_v1(
  p_command_key uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_command collection_import_private.commands%ROWTYPE;
  v_total integer;
  v_compared integer;
  v_divergent integer;
  v_inserted integer;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COLLECTION_IMPORT_FORBIDDEN';
  END IF;

  IF p_command_key IS NULL
     OR p_rows IS NULL
     OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 5000
     OR pg_column_size(p_rows) > 16777216
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COLLECTION_IMPORT_PAYLOAD_INVALID_OR_LIMIT_EXCEEDED';
  END IF;

  v_total := jsonb_array_length(p_rows);
  v_payload_hash := md5(p_rows::text);

  PERFORM pg_advisory_xact_lock(hashtextextended('collection-report-atomic-import-v1', 0));

  INSERT INTO collection_import_private.commands (
    actor_id, command_key, payload_hash, row_count
  ) VALUES (
    v_actor, p_command_key, v_payload_hash, v_total
  ) ON CONFLICT DO NOTHING;

  SELECT * INTO v_command
  FROM collection_import_private.commands
  WHERE actor_id = v_actor AND command_key = p_command_key
  FOR UPDATE;

  IF v_command.payload_hash <> v_payload_hash OR v_command.row_count <> v_total THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COLLECTION_IMPORT_COMMAND_PAYLOAD_MISMATCH';
  END IF;

  IF v_command.result_payload IS NOT NULL THEN
    RETURN v_command.result_payload;
  END IF;

  PERFORM collection_import_private.assert_promotion_scope_v1();

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS e(item)
    WHERE jsonb_typeof(item) <> 'object'
       OR NOT item ?& ARRAY[
         'report_date','client_code','collection_amount','bank_name','status',
         'collection_type','effet_echeance_date','effet_status','cheque_number','cheque_status',
         'excel_filename','excel_source_row','date_of_validity','facture_no','no_chq_bd',
         'bank_name_display','depo_ref','nj','taux','interet','commission','tob',
         'frais_escompte','bank_commission','sg_or_fa_no','d_n_amount','income',
         'date_of_impay','reglement_impaye','remarques'
       ]
       OR item - ARRAY[
         'report_date','client_code','collection_amount','bank_name','status',
         'collection_type','effet_echeance_date','effet_status','cheque_number','cheque_status',
         'excel_filename','excel_source_row','date_of_validity','facture_no','no_chq_bd',
         'bank_name_display','depo_ref','nj','taux','interet','commission','tob',
         'frais_escompte','bank_commission','sg_or_fa_no','d_n_amount','income',
         'date_of_impay','reglement_impaye','remarques'
       ] <> '{}'::jsonb
       OR jsonb_typeof(item->'report_date') <> 'string'
       OR jsonb_typeof(item->'client_code') <> 'string'
       OR jsonb_typeof(item->'collection_amount') <> 'number'
       OR jsonb_typeof(item->'bank_name') <> 'string'
       OR jsonb_typeof(item->'status') <> 'string'
       OR jsonb_typeof(item->'collection_type') NOT IN ('string','null')
       OR jsonb_typeof(item->'effet_echeance_date') NOT IN ('string','null')
       OR jsonb_typeof(item->'effet_status') NOT IN ('string','null')
       OR jsonb_typeof(item->'cheque_number') NOT IN ('string','null')
       OR jsonb_typeof(item->'cheque_status') NOT IN ('string','null')
       OR jsonb_typeof(item->'excel_filename') <> 'string'
       OR jsonb_typeof(item->'excel_source_row') <> 'number'
       OR jsonb_typeof(item->'date_of_validity') NOT IN ('string','null')
       OR jsonb_typeof(item->'facture_no') NOT IN ('string','null')
       OR jsonb_typeof(item->'no_chq_bd') NOT IN ('string','null')
       OR jsonb_typeof(item->'bank_name_display') NOT IN ('string','null')
       OR jsonb_typeof(item->'depo_ref') NOT IN ('string','null')
       OR jsonb_typeof(item->'nj') NOT IN ('number','null')
       OR jsonb_typeof(item->'taux') NOT IN ('number','null')
       OR jsonb_typeof(item->'interet') NOT IN ('number','null')
       OR jsonb_typeof(item->'commission') NOT IN ('number','null')
       OR jsonb_typeof(item->'tob') NOT IN ('number','null')
       OR jsonb_typeof(item->'frais_escompte') NOT IN ('number','null')
       OR jsonb_typeof(item->'bank_commission') NOT IN ('number','null')
       OR jsonb_typeof(item->'sg_or_fa_no') NOT IN ('string','null')
       OR jsonb_typeof(item->'d_n_amount') NOT IN ('number','null')
       OR jsonb_typeof(item->'income') NOT IN ('number','null')
       OR jsonb_typeof(item->'date_of_impay') NOT IN ('string','null')
       OR jsonb_typeof(item->'reglement_impaye') NOT IN ('string','null')
       OR jsonb_typeof(item->'remarques') NOT IN ('string','null')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COLLECTION_IMPORT_ROW_SCHEMA_INVALID';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS collection_import_rows_v1 (
    report_date date NOT NULL,
    client_code text NOT NULL,
    collection_amount numeric NOT NULL,
    bank_name text NOT NULL,
    status text NOT NULL,
    collection_type text,
    effet_echeance_date date,
    effet_status text,
    cheque_number text,
    cheque_status text,
    excel_filename text NOT NULL,
    excel_source_row integer NOT NULL,
    date_of_validity date,
    facture_no text,
    no_chq_bd text,
    bank_name_display text,
    depo_ref text,
    nj integer,
    taux numeric,
    interet numeric,
    commission numeric,
    tob numeric,
    frais_escompte numeric,
    bank_commission numeric,
    sg_or_fa_no text,
    d_n_amount numeric,
    income numeric,
    date_of_impay date,
    reglement_impaye date,
    remarques text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.collection_import_rows_v1;

  INSERT INTO pg_temp.collection_import_rows_v1
  SELECT *
  FROM jsonb_to_recordset(p_rows) AS x(
    report_date date,
    client_code text,
    collection_amount numeric,
    bank_name text,
    status text,
    collection_type text,
    effet_echeance_date date,
    effet_status text,
    cheque_number text,
    cheque_status text,
    excel_filename text,
    excel_source_row integer,
    date_of_validity date,
    facture_no text,
    no_chq_bd text,
    bank_name_display text,
    depo_ref text,
    nj integer,
    taux numeric,
    interet numeric,
    commission numeric,
    tob numeric,
    frais_escompte numeric,
    bank_commission numeric,
    sg_or_fa_no text,
    d_n_amount numeric,
    income numeric,
    date_of_impay date,
    reglement_impaye date,
    remarques text
  );

  IF EXISTS (
    SELECT 1 FROM pg_temp.collection_import_rows_v1 AS row
    WHERE btrim(row.client_code) = '' OR char_length(row.client_code) > 500
       OR row.collection_amount <= 0
       OR btrim(row.bank_name) = '' OR char_length(row.bank_name) > 200
       OR btrim(row.excel_filename) = '' OR char_length(row.excel_filename) > 255
       OR row.excel_source_row <= 1 OR row.excel_source_row > 10000000
       OR row.status NOT IN ('pending', 'processed', 'failed')
       OR row.collection_type IS NOT NULL
          AND row.collection_type NOT IN ('EFFET', 'CHEQUE', 'UNKNOWN')
       OR row.effet_status IS NOT NULL
          AND row.effet_status NOT IN ('PENDING', 'PAID', 'IMPAYE')
       OR row.cheque_status IS NOT NULL
          AND row.cheque_status NOT IN ('PENDING', 'CLEARED', 'BOUNCED')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COLLECTION_IMPORT_ROW_VALUES_INVALID';
  END IF;

  IF (SELECT count(DISTINCT excel_filename) FROM pg_temp.collection_import_rows_v1) > 10 THEN
    RAISE EXCEPTION USING
      ERRCODE = '54000',
      MESSAGE = 'COLLECTION_IMPORT_FILE_LIMIT_EXCEEDED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.collection_import_rows_v1
    GROUP BY excel_filename, excel_source_row
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'COLLECTION_IMPORT_DUPLICATE_TRACEABILITY_IN_PAYLOAD';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE existing.report_date IS DISTINCT FROM incoming.report_date
         OR btrim(existing.client_code) IS DISTINCT FROM btrim(incoming.client_code)
         OR existing.collection_amount IS DISTINCT FROM incoming.collection_amount
         OR btrim(COALESCE(existing.bank_name, '')) IS DISTINCT FROM btrim(incoming.bank_name)
         OR btrim(COALESCE(existing.facture_no, '')) IS DISTINCT FROM btrim(COALESCE(incoming.facture_no, ''))
         OR btrim(COALESCE(existing.no_chq_bd, '')) IS DISTINCT FROM btrim(COALESCE(incoming.no_chq_bd, ''))
    )::integer
  INTO v_compared, v_divergent
  FROM pg_temp.collection_import_rows_v1 AS incoming
  JOIN public.collection_report AS existing
    ON existing.excel_filename = incoming.excel_filename
   AND existing.excel_source_row = incoming.excel_source_row;

  IF v_divergent >= 5
     OR (v_compared > 0 AND v_divergent::numeric / v_compared::numeric >= 0.20)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format(
        'COLLECTION_IMPORT_MASS_ROW_SHIFT_DETECTED: %s divergent existing rows of %s',
        v_divergent,
        v_compared
      );
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS collection_import_before_v1 (
    excel_filename text NOT NULL,
    excel_source_row integer NOT NULL,
    action text NOT NULL,
    before_row jsonb,
    PRIMARY KEY (excel_filename, excel_source_row)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.collection_import_before_v1;

  INSERT INTO pg_temp.collection_import_before_v1 (
    excel_filename, excel_source_row, action, before_row
  )
  SELECT
    incoming.excel_filename,
    incoming.excel_source_row,
    CASE WHEN existing.id IS NULL THEN 'insert' ELSE 'update' END,
    CASE WHEN existing.id IS NULL THEN NULL ELSE to_jsonb(existing) END
  FROM pg_temp.collection_import_rows_v1 AS incoming
  LEFT JOIN public.collection_report AS existing
    ON existing.excel_filename = incoming.excel_filename
   AND existing.excel_source_row = incoming.excel_source_row;

  v_inserted := v_total - v_compared;

  INSERT INTO collection_import_private.write_contexts (
    transaction_id, actor_id, command_key
  ) VALUES (
    txid_current(), v_actor, p_command_key
  );

  INSERT INTO public.collection_report (
    report_date, client_code, collection_amount, bank_name, status,
    collection_type, effet_echeance_date, effet_status, cheque_number, cheque_status,
    excel_filename, excel_source_row, excel_processed_at,
    date_of_validity, facture_no, no_chq_bd, bank_name_display, depo_ref,
    nj, taux, interet, commission, tob, frais_escompte, bank_commission,
    sg_or_fa_no, d_n_amount, income, date_of_impay, reglement_impaye, remarques,
    processing_status, processed_at
  )
  SELECT
    report_date, btrim(client_code), collection_amount, btrim(bank_name), status,
    collection_type, effet_echeance_date, effet_status, cheque_number, cheque_status,
    btrim(excel_filename), excel_source_row, statement_timestamp(),
    date_of_validity, facture_no, no_chq_bd, bank_name_display, depo_ref,
    nj, taux, interet, commission, tob, frais_escompte, bank_commission,
    sg_or_fa_no, d_n_amount, income, date_of_impay, reglement_impaye, remarques,
    'NEW', statement_timestamp()
  FROM pg_temp.collection_import_rows_v1
  ON CONFLICT (excel_filename, excel_source_row)
    WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL
  DO UPDATE SET
    report_date = EXCLUDED.report_date,
    client_code = EXCLUDED.client_code,
    collection_amount = EXCLUDED.collection_amount,
    bank_name = EXCLUDED.bank_name,
    status = EXCLUDED.status,
    collection_type = EXCLUDED.collection_type,
    effet_echeance_date = EXCLUDED.effet_echeance_date,
    effet_status = EXCLUDED.effet_status,
    cheque_number = EXCLUDED.cheque_number,
    cheque_status = EXCLUDED.cheque_status,
    excel_processed_at = EXCLUDED.excel_processed_at,
    date_of_validity = EXCLUDED.date_of_validity,
    facture_no = EXCLUDED.facture_no,
    no_chq_bd = EXCLUDED.no_chq_bd,
    bank_name_display = EXCLUDED.bank_name_display,
    depo_ref = EXCLUDED.depo_ref,
    nj = EXCLUDED.nj,
    taux = EXCLUDED.taux,
    interet = EXCLUDED.interet,
    commission = EXCLUDED.commission,
    tob = EXCLUDED.tob,
    frais_escompte = EXCLUDED.frais_escompte,
    bank_commission = EXCLUDED.bank_commission,
    sg_or_fa_no = EXCLUDED.sg_or_fa_no,
    d_n_amount = EXCLUDED.d_n_amount,
    income = EXCLUDED.income,
    date_of_impay = EXCLUDED.date_of_impay,
    reglement_impaye = EXCLUDED.reglement_impaye,
    remarques = EXCLUDED.remarques,
    processing_status = EXCLUDED.processing_status,
    processed_at = EXCLUDED.processed_at;

  DELETE FROM collection_import_private.write_contexts
  WHERE transaction_id = txid_current()
    AND actor_id = v_actor
    AND command_key = p_command_key;

  IF FOUND IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'COLLECTION_IMPORT_WRITE_CONTEXT_CLEANUP_FAILED';
  END IF;

  INSERT INTO collection_import_private.row_audit (
    actor_id, command_key, excel_filename, excel_source_row,
    action, before_row, after_row
  )
  SELECT
    v_actor,
    p_command_key,
    before.excel_filename,
    before.excel_source_row,
    before.action,
    before.before_row,
    to_jsonb(current_row)
  FROM pg_temp.collection_import_before_v1 AS before
  JOIN public.collection_report AS current_row
    ON current_row.excel_filename = before.excel_filename
   AND current_row.excel_source_row = before.excel_source_row;

  v_result := jsonb_build_object(
    'command_key', p_command_key,
    'total_rows', v_total,
    'inserted_rows', v_inserted,
    'updated_rows', v_compared,
    'divergent_rows', v_divergent,
    'audit_rows', v_total
  );

  UPDATE collection_import_private.commands
  SET result_payload = v_result, completed_at = statement_timestamp()
  WHERE actor_id = v_actor AND command_key = p_command_key;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION collection_import_private.prepare_runtime_control_change_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION collection_import_private.append_runtime_control_event_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION collection_import_private.assert_promotion_scope_v1()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION collection_import_private.guard_collection_report_write_v1()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.collection_report_promotion_enabled_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collection_report_promotion_enabled_v1()
  TO authenticated;

REVOKE ALL ON FUNCTION public.import_collection_report_atomic_v1(uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_collection_report_atomic_v1(uuid,jsonb)
  TO authenticated;

COMMENT ON TABLE collection_import_private.runtime_control IS
  'Private fail-closed, expiring Collection Report promotion scope. Updated only under an exact environment GO.';
COMMENT ON TABLE collection_import_private.commands IS
  'Private idempotency ledger for atomic Collection Report imports.';
COMMENT ON TABLE collection_import_private.write_contexts IS
  'Private transaction-bound capability required by the Collection Report write guard.';
COMMENT ON TABLE collection_import_private.row_audit IS
  'Private before/after evidence for each Collection Report traceability key changed by an atomic import.';
COMMENT ON FUNCTION public.collection_report_promotion_enabled_v1() IS
  'Read-only server scope state for the controlled Collection Report promotion UI.';
COMMENT ON FUNCTION public.import_collection_report_atomic_v1(uuid,jsonb) IS
  'Validates and atomically applies one complete reviewed Collection Report import unit.';

COMMIT;
