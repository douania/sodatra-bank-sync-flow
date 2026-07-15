-- ============================================================================
-- DAILY-V2-0U — REGISTRE DE COMPTES, GRANTS BACKFILL ET MOTIFS DE REVIEW
-- ============================================================================
-- Migration additive uniquement. La migration historique 20260708130000 reste
-- intacte. Les lignes historiques restent lisibles avec account_registry_id
-- NULL ; tout NOUVEAU depot passe par le registre et le wrapper fail-closed.
-- Aucune donnee bancaire complete, aucun IBAN, aucun fichier brut.
-- ============================================================================

BEGIN;

CREATE TABLE public.daily_statement_account_registry (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users (id),
  bank                  text NOT NULL CHECK (bank IN ('BDK','ORA','ATB','BICIS','BIS','BRIDGE')),
  currency              text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  safe_alias            text NOT NULL CHECK (char_length(btrim(safe_alias)) BETWEEN 1 AND 80),
  account_fingerprint   text NOT NULL DEFAULT (
                            replace(gen_random_uuid()::text, '-', '')
                            || replace(gen_random_uuid()::text, '-', '')
                          )
                            CHECK (account_fingerprint ~ '^[0-9a-f]{64}$'),
  account_number_masked text CHECK (
                            account_number_masked IS NULL
                            OR account_number_masked ~ '^[*]+[0-9]{0,4}$'
                          ),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  deactivated_at        timestamptz,
  deactivated_by        uuid REFERENCES auth.users (id),
  deactivation_reason   text,
  CONSTRAINT daily_stmt_account_registry_deactivation_coherent CHECK (
    (status = 'active' AND deactivated_at IS NULL AND deactivated_by IS NULL AND deactivation_reason IS NULL)
    OR
    (status = 'inactive' AND deactivated_at IS NOT NULL AND deactivated_by IS NOT NULL AND deactivation_reason IS NOT NULL)
  ),
  CONSTRAINT daily_stmt_account_registry_fingerprint_unique UNIQUE (account_fingerprint)
);

CREATE UNIQUE INDEX uq_daily_stmt_account_registry_active_alias
  ON public.daily_statement_account_registry (bank, currency, lower(btrim(safe_alias)))
  WHERE status = 'active';

CREATE TABLE public.daily_statement_backfill_grants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_registry_id   uuid NOT NULL REFERENCES public.daily_statement_account_registry (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users (id),
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  max_units             integer NOT NULL CHECK (max_units BETWEEN 1 AND 4000),
  expires_at            timestamptz NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','consumed','revoked')),
  consumed_at           timestamptz,
  consumed_by           uuid REFERENCES auth.users (id),
  consumed_attempt_id   uuid REFERENCES public.daily_statement_export_attempts (id),
  revoked_at            timestamptz,
  revoked_by            uuid REFERENCES auth.users (id),
  revocation_reason     text,
  CONSTRAINT daily_stmt_backfill_grant_period CHECK (
    period_end >= period_start AND (period_end - period_start + 1) <= 4000
  ),
  CONSTRAINT daily_stmt_backfill_grant_lifecycle CHECK (
    (status = 'active' AND consumed_at IS NULL AND consumed_by IS NULL
                       AND consumed_attempt_id IS NULL AND revoked_at IS NULL
                       AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR
    (status = 'consumed' AND consumed_at IS NOT NULL AND consumed_by IS NOT NULL
                         AND consumed_attempt_id IS NOT NULL AND revoked_at IS NULL
                         AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR
    (status = 'revoked' AND consumed_at IS NULL AND consumed_by IS NULL
                        AND consumed_attempt_id IS NULL AND revoked_at IS NOT NULL
                        AND revoked_by IS NOT NULL AND revocation_reason IS NOT NULL)
  )
);

CREATE INDEX idx_daily_stmt_backfill_grants_account_status
  ON public.daily_statement_backfill_grants (account_registry_id, status, expires_at);

CREATE TABLE public.daily_statement_account_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  actor_id              uuid NOT NULL REFERENCES auth.users (id),
  account_registry_id   uuid NOT NULL REFERENCES public.daily_statement_account_registry (id),
  backfill_grant_id     uuid REFERENCES public.daily_statement_backfill_grants (id),
  event_type            text NOT NULL CHECK (event_type IN (
                          'account_provisioned','account_deactivated',
                          'backfill_grant_issued','backfill_grant_consumed','backfill_grant_revoked'
                        )),
  safe_message          text NOT NULL,
  safe_details          jsonb,
  CONSTRAINT daily_stmt_account_events_safe_details CHECK (
    safe_details IS NULL OR (
      jsonb_typeof(safe_details) = 'object'
      AND NOT (safe_details ?| ARRAY[
        'account_number','iban','raw_account','full_iban','raw_text','raw_bytes','file_content'
      ])
    )
  )
);

ALTER TABLE public.daily_statement_export_attempts
  ADD COLUMN account_registry_id uuid REFERENCES public.daily_statement_account_registry (id),
  ADD COLUMN backfill_grant_id uuid REFERENCES public.daily_statement_backfill_grants (id),
  ADD COLUMN review_reason_codes text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.daily_statement_units_staging
  ADD COLUMN account_registry_id uuid REFERENCES public.daily_statement_account_registry (id),
  ADD COLUMN review_reason_codes text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.daily_statement_units_canonical
  ADD COLUMN account_registry_id uuid REFERENCES public.daily_statement_account_registry (id),
  ADD COLUMN review_reason_codes text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.daily_stmt_assert_safe_alias(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value text := btrim(coalesce(p_value, ''));
BEGIN
  IF char_length(v_value) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_ALIAS_LENGTH: safe alias must contain 1-80 characters (fail-closed)';
  END IF;
  IF v_value ~ '[0-9]{8,}' OR v_value ~* '(^|[^A-Z])[A-Z]{2}[0-9]{2}[A-Z0-9]{8,}' THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_ALIAS_SENSITIVE: safe alias resembles a full account or IBAN (fail-closed)';
  END IF;
  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.daily_stmt_review_reason_codes(p_value jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed constant text[] := ARRAY[
    'TRUSTED_CURRENCY_UNCORROBORATED',
    'RUNNING_BALANCE_MISSING',
    'RUNNING_BALANCE_CHAIN_INCOHERENT',
    'AGGREGATES_UNAVAILABLE',
    'ACTIVE_LINE_HASH_SCOPE_CONFLICT',
    'ACCOUNT_IDENTITY_NOT_CORROBORATED',
    'BACKFILL_REVIEW_REQUIRED'
  ];
  v_codes text[];
BEGIN
  IF p_value IS NULL OR p_value = 'null'::jsonb THEN
    RETURN '{}'::text[];
  END IF;
  IF jsonb_typeof(p_value) <> 'array' OR jsonb_array_length(p_value) > 16 THEN
    RAISE EXCEPTION 'DAILY_STMT_REVIEW_CODES_TYPE: review_reason_codes must be an array of at most 16 codes (fail-closed)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_value) e
    WHERE jsonb_typeof(e.value) <> 'string' OR NOT ((e.value #>> '{}') = ANY (v_allowed))
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_REVIEW_CODE_UNSUPPORTED: review reason outside allow-list (fail-closed)';
  END IF;
  SELECT coalesce(array_agg(DISTINCT e.value #>> '{}' ORDER BY e.value #>> '{}'), '{}'::text[])
    INTO v_codes
  FROM jsonb_array_elements(p_value) e;
  RETURN v_codes;
END;
$$;

CREATE OR REPLACE FUNCTION public.daily_stmt_assert_safe_operator_reason(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value text := btrim(coalesce(p_value,''));
BEGIN
  PERFORM public.daily_stmt_assert_safe_reason(p_value);
  IF v_value ~ '[0-9]{8,}' OR v_value ~* '(^|[^A-Z])[A-Z]{2}[0-9]{2}[A-Z0-9]{8,}' THEN
    RAISE EXCEPTION 'DAILY_STMT_REASON_SENSITIVE: reason resembles account or IBAN data (fail-closed)';
  END IF;
  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_daily_statement_account(
  p_bank text,
  p_currency text,
  p_safe_alias text,
  p_account_number_masked text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.daily_statement_account_registry%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_ADMIN_REQUIRED: admin role required (fail-closed)';
  END IF;
  IF btrim(coalesce(p_bank,'')) NOT IN ('BDK','ORA','ATB','BICIS','BIS','BRIDGE') THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_BANK_UNSUPPORTED (fail-closed)';
  END IF;
  IF btrim(coalesce(p_currency,'')) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_CURRENCY_INVALID (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_assert_masked_account(nullif(btrim(coalesce(p_account_number_masked,'')),''));

  INSERT INTO public.daily_statement_account_registry (
    created_by, bank, currency, safe_alias, account_number_masked
  ) VALUES (
    v_actor, btrim(p_bank), btrim(p_currency),
    public.daily_stmt_assert_safe_alias(p_safe_alias),
    nullif(btrim(coalesce(p_account_number_masked,'')),'')
  ) RETURNING * INTO v_row;

  INSERT INTO public.daily_statement_account_events (
    actor_id, account_registry_id, event_type, safe_message, safe_details
  ) VALUES (
    v_actor, v_row.id, 'account_provisioned', 'daily statement account provisioned',
    jsonb_build_object('bank', v_row.bank, 'currency', v_row.currency)
  );

  RETURN jsonb_build_object(
    'id', v_row.id, 'bank', v_row.bank, 'currency', v_row.currency,
    'safe_alias', v_row.safe_alias, 'account_fingerprint', v_row.account_fingerprint,
    'account_number_masked', v_row.account_number_masked, 'status', v_row.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_daily_statement_account(
  p_account_registry_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_grant_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_ADMIN_REQUIRED: admin role required (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_assert_safe_operator_reason(p_reason);
  UPDATE public.daily_statement_account_registry
     SET status = 'inactive', deactivated_at = now(), deactivated_by = v_actor,
         deactivation_reason = public.daily_stmt_assert_safe_operator_reason(p_reason)
   WHERE id = p_account_registry_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_ACTIVE_NOT_FOUND (fail-closed)';
  END IF;
  INSERT INTO public.daily_statement_account_events (
    actor_id, account_registry_id, event_type, safe_message, safe_details
  ) VALUES (
    v_actor, p_account_registry_id, 'account_deactivated',
    'daily statement account deactivated',
    jsonb_build_object('reason', public.daily_stmt_assert_safe_operator_reason(p_reason))
  );
  FOR v_grant_id IN
    UPDATE public.daily_statement_backfill_grants
       SET status='revoked', revoked_at=now(), revoked_by=v_actor,
           revocation_reason='account deactivated'
     WHERE account_registry_id=p_account_registry_id AND status='active'
     RETURNING id
  LOOP
    INSERT INTO public.daily_statement_account_events (
      actor_id, account_registry_id, backfill_grant_id,
      event_type, safe_message, safe_details
    ) VALUES (
      v_actor, p_account_registry_id, v_grant_id,
      'backfill_grant_revoked', 'daily statement backfill grant revoked',
      jsonb_build_object('reason','account deactivated')
    );
  END LOOP;
  RETURN jsonb_build_object('outcome','deactivated','account_registry_id',p_account_registry_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_daily_statement_backfill_grant(
  p_account_registry_id uuid,
  p_period_start date,
  p_period_end date,
  p_max_units integer,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_account public.daily_statement_account_registry%ROWTYPE;
  v_grant public.daily_statement_backfill_grants%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_ADMIN_ONLY: admin role required (fail-closed)';
  END IF;
  SELECT * INTO v_account FROM public.daily_statement_account_registry
   WHERE id = p_account_registry_id AND status = 'active';
  IF NOT FOUND OR v_account.bank <> 'BIS' THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_ACCOUNT: active BIS account required (fail-closed)';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start
     OR (p_period_end - p_period_start + 1) > 4000 THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_GRANT_PERIOD_INVALID (fail-closed)';
  END IF;
  IF p_max_units IS NULL OR p_max_units NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_GRANT_UNITS_INVALID (fail-closed)';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_GRANT_EXPIRY_INVALID (fail-closed)';
  END IF;
  INSERT INTO public.daily_statement_backfill_grants (
    account_registry_id, created_by, period_start, period_end, max_units, expires_at
  ) VALUES (
    v_account.id, v_actor, p_period_start, p_period_end, p_max_units, p_expires_at
  ) RETURNING * INTO v_grant;
  INSERT INTO public.daily_statement_account_events (
    actor_id, account_registry_id, backfill_grant_id, event_type, safe_message, safe_details
  ) VALUES (
    v_actor, v_account.id, v_grant.id, 'backfill_grant_issued',
    'daily statement backfill grant issued',
    jsonb_build_object('period_start',p_period_start,'period_end',p_period_end,'max_units',p_max_units)
  );
  RETURN jsonb_build_object(
    'id',v_grant.id,'account_registry_id',v_account.id,'period_start',v_grant.period_start,
    'period_end',v_grant.period_end,'max_units',v_grant.max_units,
    'expires_at',v_grant.expires_at,'status',v_grant.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_daily_statement_backfill_grant(
  p_backfill_grant_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_account_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_ADMIN_ONLY: admin role required (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_assert_safe_operator_reason(p_reason);
  UPDATE public.daily_statement_backfill_grants
     SET status='revoked', revoked_at=now(), revoked_by=v_actor,
         revocation_reason=public.daily_stmt_assert_safe_operator_reason(p_reason)
   WHERE id=p_backfill_grant_id AND status='active'
   RETURNING account_registry_id INTO v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_GRANT_ACTIVE_NOT_FOUND (fail-closed)';
  END IF;
  INSERT INTO public.daily_statement_account_events (
    actor_id, account_registry_id, backfill_grant_id, event_type, safe_message, safe_details
  ) VALUES (
    v_actor, v_account_id, p_backfill_grant_id, 'backfill_grant_revoked',
    'daily statement backfill grant revoked',
    jsonb_build_object('reason',public.daily_stmt_assert_safe_operator_reason(p_reason))
  );
  RETURN jsonb_build_object('outcome','revoked','backfill_grant_id',p_backfill_grant_id);
END;
$$;

-- Le coeur 0H/0Q est conserve tel quel et rendu interne. Le wrapper 0U valide
-- le nouveau contexte, retire les champs 0U avant delegation, puis enrichit
-- les lignes produites dans la MEME transaction.
ALTER FUNCTION public.pre_ingest_daily_statement_units(jsonb,jsonb,jsonb,jsonb)
  RENAME TO daily_stmt_pre_ingest_legacy_core_0u;
REVOKE ALL ON FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_unit_codes text[];
  v_legacy_attempt jsonb;
  v_legacy_units jsonb;
  v_legacy_guard jsonb;
  v_result jsonb;
  v_attempt_id uuid;
  v_unit jsonb;
  v_code text;
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
  v_result := public.daily_stmt_pre_ingest_legacy_core_0u(
    v_legacy_attempt, v_legacy_units, p_lines, v_legacy_guard
  );
  v_attempt_id := (v_result ->> 'attempt_id')::uuid;

  UPDATE public.daily_statement_export_attempts
     SET account_registry_id=v_account.id,
         backfill_grant_id=v_grant_id,
         review_reason_codes=v_attempt_codes
   WHERE id=v_attempt_id;

  FOR v_unit IN SELECT value FROM jsonb_array_elements(p_units) LOOP
    v_unit_codes := public.daily_stmt_review_reason_codes(v_unit -> 'review_reason_codes');
    IF coalesce(array_length(v_unit_codes,1),0) > 0
       AND v_unit ->> 'validation_status' <> 'needs_review' THEN
      RAISE EXCEPTION 'DAILY_STMT_REVIEW_STATUS_MISMATCH: coded review reasons require needs_review status (rollback)';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_result -> 'units') r
      WHERE r.value ->> 'day_unit_id' = v_unit ->> 'day_unit_id'
        AND r.value ->> 'unit_status' = 'needs_review'
    ) AND NOT ('ACTIVE_LINE_HASH_SCOPE_CONFLICT' = ANY (v_unit_codes)) THEN
      v_unit_codes := array_append(v_unit_codes, 'ACTIVE_LINE_HASH_SCOPE_CONFLICT');
    END IF;
    IF NOT v_identity_corroborated
       AND NOT ('ACCOUNT_IDENTITY_NOT_CORROBORATED' = ANY (v_unit_codes)) THEN
      RAISE EXCEPTION 'DAILY_STMT_ACCOUNT_REVIEW_REQUIRED: every uncorroborated unit requires an explicit reason (rollback)';
    END IF;
    UPDATE public.daily_statement_units_staging
       SET account_registry_id=v_account.id, review_reason_codes=v_unit_codes
     WHERE attempt_id=v_attempt_id AND day_unit_id=v_unit ->> 'day_unit_id';
    FOREACH v_code IN ARRAY v_unit_codes LOOP
      PERFORM public.daily_stmt_append_audit_event(
        v_actor, v_attempt_id,
        (SELECT id FROM public.daily_statement_units_staging
          WHERE attempt_id=v_attempt_id AND day_unit_id=v_unit ->> 'day_unit_id'),
        NULL, v_unit ->> 'day_unit_id', NULL,
        'status_changed', NULL, NULL, 'review reason recorded',
        jsonb_build_object('reason_code',v_code)
      );
    END LOOP;
  END LOOP;

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

CREATE OR REPLACE FUNCTION public.daily_stmt_populate_canonical_0u_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT account_registry_id, review_reason_codes
    INTO NEW.account_registry_id, NEW.review_reason_codes
  FROM public.daily_statement_units_staging
  WHERE id=NEW.promoted_from_staging_unit_id;
  IF NEW.account_registry_id IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_CANONICAL_ACCOUNT_CONTEXT_REQUIRED (fail-closed)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_daily_units_canonical_0u_context
  BEFORE INSERT ON public.daily_statement_units_canonical
  FOR EACH ROW EXECUTE FUNCTION public.daily_stmt_populate_canonical_0u_context();

ALTER TABLE public.daily_statement_account_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_backfill_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_account_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_stmt_account_registry_select
  ON public.daily_statement_account_registry FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::public.app_role)
    OR public.has_role(auth.uid(),'auditor'::public.app_role)
    OR (status='active' AND public.has_role(auth.uid(),'manager'::public.app_role))
  );

CREATE POLICY daily_stmt_backfill_grants_select
  ON public.daily_statement_backfill_grants FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));

CREATE POLICY daily_stmt_account_events_select
  ON public.daily_statement_account_events FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::public.app_role)
    OR public.has_role(auth.uid(),'auditor'::public.app_role)
  );

REVOKE ALL ON TABLE public.daily_statement_account_registry FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.daily_statement_backfill_grants FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.daily_statement_account_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.daily_statement_account_registry TO authenticated,service_role;
GRANT SELECT ON TABLE public.daily_statement_backfill_grants TO authenticated,service_role;
GRANT SELECT ON TABLE public.daily_statement_account_events TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.daily_stmt_assert_safe_alias(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_review_reason_codes(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_assert_safe_operator_reason(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_populate_canonical_0u_context() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.pre_ingest_daily_statement_units(jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.pre_ingest_daily_statement_units(jsonb,jsonb,jsonb,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.provision_daily_statement_account(text,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.provision_daily_statement_account(text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.deactivate_daily_statement_account(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_daily_statement_account(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_daily_statement_backfill_grant(uuid,date,date,integer,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.issue_daily_statement_backfill_grant(uuid,date,date,integer,timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_daily_statement_backfill_grant(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.revoke_daily_statement_backfill_grant(uuid,text) TO authenticated;

COMMIT;
