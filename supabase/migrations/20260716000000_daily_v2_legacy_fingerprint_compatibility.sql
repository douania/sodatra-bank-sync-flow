-- ============================================================================
-- DAILY-V2-0U4 — COMPATIBILITE DES IDENTITES HISTORIQUES OPAQUES
-- ============================================================================
-- Correctif forward-only postérieur à 0U/0U3. Les identités nouvellement
-- provisionnées restent des SHA-256 hexadécimaux. Seul le pont d'adoption
-- admin peut enregistrer, sans la modifier ni l'exposer, une identité opaque
-- historique qui satisfait la grammaire de sûreté fermée ci-dessous.
-- ============================================================================

BEGIN;

ALTER TABLE public.daily_statement_account_registry
  ADD COLUMN fingerprint_scheme text NOT NULL DEFAULT 'sha256_hex_v1'
    CHECK (fingerprint_scheme IN ('sha256_hex_v1','legacy_opaque_v1'));

ALTER TABLE public.daily_statement_account_registry
  DROP CONSTRAINT daily_statement_account_registry_account_fingerprint_check;

ALTER TABLE public.daily_statement_account_registry
  ADD CONSTRAINT daily_stmt_account_registry_fingerprint_scheme_coherent CHECK (
    (
      fingerprint_scheme = 'sha256_hex_v1'
      AND account_fingerprint ~ '^[0-9a-f]{64}$'
    )
    OR
    (
      fingerprint_scheme = 'legacy_opaque_v1'
      AND char_length(account_fingerprint) BETWEEN 16 AND 128
      AND account_fingerprint ~ '^[A-Za-z0-9._:-]+$'
      AND account_fingerprint ~ '[A-Za-z]'
      AND account_fingerprint !~ '[0-9]{8,}'
      AND account_fingerprint !~* '^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,}$'
      AND account_fingerprint !~* '^[0-9a-f]{64}$'
    )
  );

CREATE OR REPLACE FUNCTION public.daily_stmt_classify_fingerprint_scheme(
  p_value text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value text := coalesce(p_value, '');
BEGIN
  IF v_value ~ '^[0-9a-f]{64}$' THEN
    RETURN 'sha256_hex_v1';
  END IF;

  IF char_length(v_value) BETWEEN 16 AND 128
     AND v_value ~ '^[A-Za-z0-9._:-]+$'
     AND v_value ~ '[A-Za-z]'
     AND v_value !~ '[0-9]{8,}'
     AND v_value !~* '^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,}$'
     AND v_value !~* '^[0-9a-f]{64}$' THEN
    RETURN 'legacy_opaque_v1';
  END IF;

  RAISE EXCEPTION
    'DAILY_STMT_FINGERPRINT_UNSUPPORTED: identity does not match an approved opaque scheme (fail-closed)';
END;
$$;

COMMENT ON FUNCTION public.daily_stmt_classify_fingerprint_scheme(text)
IS 'Classifies an internal Daily v2 identity without returning or logging it; rejects unsafe legacy shapes fail-closed.';

REVOKE ALL ON FUNCTION public.daily_stmt_classify_fingerprint_scheme(text)
  FROM PUBLIC, anon, authenticated, service_role;

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
    created_by, bank, currency, safe_alias, account_number_masked,
    fingerprint_scheme
  ) VALUES (
    v_actor, btrim(p_bank), btrim(p_currency),
    public.daily_stmt_assert_safe_alias(p_safe_alias),
    nullif(btrim(coalesce(p_account_number_masked,'')),''),
    'sha256_hex_v1'
  ) RETURNING * INTO v_row;

  IF v_row.account_fingerprint !~ '^[0-9a-f]{64}$'
     OR v_row.fingerprint_scheme <> 'sha256_hex_v1' THEN
    RAISE EXCEPTION
      'DAILY_STMT_ACCOUNT_IDENTITY_GENERATION_FAILED: normal provisioning must generate SHA-256 hex identity (rollback)';
  END IF;

  INSERT INTO public.daily_statement_account_events (
    actor_id, account_registry_id, event_type, safe_message, safe_details
  ) VALUES (
    v_actor, v_row.id, 'account_provisioned', 'daily statement account provisioned',
    jsonb_build_object('bank', v_row.bank, 'currency', v_row.currency)
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'created_at', v_row.created_at,
    'created_by', v_row.created_by,
    'bank', v_row.bank,
    'currency', v_row.currency,
    'safe_alias', v_row.safe_alias,
    'fingerprint_scheme', v_row.fingerprint_scheme,
    'account_fingerprint', v_row.account_fingerprint,
    'account_number_masked', v_row.account_number_masked,
    'status', v_row.status,
    'deactivated_at', v_row.deactivated_at,
    'deactivated_by', v_row.deactivated_by,
    'deactivation_reason', v_row.deactivation_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.adopt_daily_statement_historical_account(
  p_bank text,
  p_currency text,
  p_safe_alias text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_bank text := btrim(coalesce(p_bank, ''));
  v_currency text := btrim(coalesce(p_currency, ''));
  v_alias text;
  v_fingerprint text;
  v_fingerprint_scheme text;
  v_fingerprint_count bigint;
  v_masked text;
  v_mask_count bigint;
  v_account_id uuid;
  v_attempts_expected bigint;
  v_staging_expected bigint;
  v_canonical_expected bigint;
  v_attempts_updated bigint;
  v_staging_updated bigint;
  v_canonical_updated bigint;
BEGIN
  IF v_actor IS NULL
     OR NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_ADOPTION_ADMIN_REQUIRED: admin role required (fail-closed)';
  END IF;

  IF v_bank NOT IN ('BDK','ORA','ATB','BICIS','BIS','BRIDGE') THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_ADOPTION_BANK_UNSUPPORTED (fail-closed)';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_ADOPTION_CURRENCY_INVALID (fail-closed)';
  END IF;
  v_alias := public.daily_stmt_assert_safe_alias(p_safe_alias);

  PERFORM pg_advisory_xact_lock(
    hashtextextended('daily-v2-historical-adoption:' || v_bank || ':' || v_currency, 0)
  );

  SELECT count(DISTINCT c.account_fingerprint), min(c.account_fingerprint)
    INTO v_fingerprint_count, v_fingerprint
  FROM public.daily_statement_units_canonical c
  WHERE c.bank = v_bank
    AND c.currency = v_currency
    AND c.account_registry_id IS NULL;

  IF v_fingerprint_count = 0 THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_IDENTITY_NOT_FOUND: no unmapped canonical identity for context (fail-closed)';
  END IF;
  IF v_fingerprint_count <> 1 THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_IDENTITY_AMBIGUOUS: context contains multiple unmapped identities (fail-closed)';
  END IF;
  v_fingerprint_scheme := public.daily_stmt_classify_fingerprint_scheme(v_fingerprint);

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT bank, currency
      FROM public.daily_statement_export_attempts
      WHERE account_fingerprint = v_fingerprint
      UNION ALL
      SELECT bank, currency
      FROM public.daily_statement_units_staging
      WHERE account_fingerprint = v_fingerprint
      UNION ALL
      SELECT bank, currency
      FROM public.daily_statement_units_canonical
      WHERE account_fingerprint = v_fingerprint
    ) historical_context
    WHERE historical_context.bank <> v_bank
       OR historical_context.currency <> v_currency
  ) THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_IDENTITY_CONTEXT_AMBIGUOUS: fingerprint spans multiple contexts (fail-closed)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.daily_statement_account_registry r
    WHERE r.account_fingerprint = v_fingerprint
  ) OR EXISTS (
    SELECT 1
    FROM public.daily_statement_export_attempts a
    WHERE a.bank = v_bank AND a.currency = v_currency
      AND a.account_fingerprint = v_fingerprint
      AND a.account_registry_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.daily_statement_units_staging s
    WHERE s.bank = v_bank AND s.currency = v_currency
      AND s.account_fingerprint = v_fingerprint
      AND s.account_registry_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.daily_statement_units_canonical c
    WHERE c.bank = v_bank AND c.currency = v_currency
      AND c.account_fingerprint = v_fingerprint
      AND c.account_registry_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_ADOPTION_PARTIAL_STATE: identity is already registered or partially mapped (fail-closed)';
  END IF;

  SELECT count(DISTINCT a.account_number_masked), min(a.account_number_masked)
    FILTER (WHERE a.account_number_masked IS NOT NULL)
    INTO v_mask_count, v_masked
  FROM public.daily_statement_export_attempts a
  WHERE a.bank = v_bank
    AND a.currency = v_currency
    AND a.account_fingerprint = v_fingerprint;

  IF v_mask_count > 1 THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_MASK_AMBIGUOUS: identity carries multiple masked labels (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_assert_masked_account(v_masked);

  SELECT count(*) INTO v_attempts_expected
  FROM public.daily_statement_export_attempts a
  WHERE a.bank = v_bank AND a.currency = v_currency
    AND a.account_fingerprint = v_fingerprint;
  SELECT count(*) INTO v_staging_expected
  FROM public.daily_statement_units_staging s
  WHERE s.bank = v_bank AND s.currency = v_currency
    AND s.account_fingerprint = v_fingerprint;
  SELECT count(*) INTO v_canonical_expected
  FROM public.daily_statement_units_canonical c
  WHERE c.bank = v_bank AND c.currency = v_currency
    AND c.account_fingerprint = v_fingerprint;

  IF v_attempts_expected = 0 OR v_staging_expected = 0
     OR v_canonical_expected = 0 THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_ADOPTION_INCOMPLETE: attempts, staging and canonical are all required (fail-closed)';
  END IF;

  INSERT INTO public.daily_statement_account_registry (
    created_by, bank, currency, safe_alias,
    account_fingerprint, account_number_masked, fingerprint_scheme
  ) VALUES (
    v_actor, v_bank, v_currency, v_alias,
    v_fingerprint, v_masked, v_fingerprint_scheme
  )
  RETURNING id INTO v_account_id;

  UPDATE public.daily_statement_export_attempts a
     SET account_registry_id = v_account_id
   WHERE a.bank = v_bank AND a.currency = v_currency
     AND a.account_fingerprint = v_fingerprint
     AND a.account_registry_id IS NULL;
  GET DIAGNOSTICS v_attempts_updated = ROW_COUNT;

  UPDATE public.daily_statement_units_staging s
     SET account_registry_id = v_account_id
   WHERE s.bank = v_bank AND s.currency = v_currency
     AND s.account_fingerprint = v_fingerprint
     AND s.account_registry_id IS NULL;
  GET DIAGNOSTICS v_staging_updated = ROW_COUNT;

  UPDATE public.daily_statement_units_canonical c
     SET account_registry_id = v_account_id
   WHERE c.bank = v_bank AND c.currency = v_currency
     AND c.account_fingerprint = v_fingerprint
     AND c.account_registry_id IS NULL;
  GET DIAGNOSTICS v_canonical_updated = ROW_COUNT;

  IF v_attempts_updated <> v_attempts_expected
     OR v_staging_updated <> v_staging_expected
     OR v_canonical_updated <> v_canonical_expected THEN
    RAISE EXCEPTION
      'DAILY_STMT_HISTORICAL_ADOPTION_COUNT_MISMATCH: mapping changed concurrently (rollback)';
  END IF;

  INSERT INTO public.daily_statement_account_events (
    actor_id, account_registry_id, event_type, safe_message, safe_details
  ) VALUES (
    v_actor,
    v_account_id,
    'account_provisioned',
    'historical daily statement account adopted',
    jsonb_build_object(
      'bank', v_bank,
      'currency', v_currency,
      'fingerprint_scheme', v_fingerprint_scheme,
      'attempts_mapped', v_attempts_updated,
      'staging_units_mapped', v_staging_updated,
      'canonical_units_mapped', v_canonical_updated
    )
  );

  RETURN jsonb_build_object(
    'outcome', 'adopted',
    'account_registry_id', v_account_id,
    'bank', v_bank,
    'currency', v_currency,
    'safe_alias', v_alias,
    'fingerprint_scheme', v_fingerprint_scheme,
    'attempts_mapped', v_attempts_updated,
    'staging_units_mapped', v_staging_updated,
    'canonical_units_mapped', v_canonical_updated
  );
END;
$$;

COMMENT ON FUNCTION public.adopt_daily_statement_historical_account(text,text,text)
IS 'Admin-only bridge: adopts one safe historical Daily v2 identity under an explicit scheme without exposing or changing its fingerprint.';

REVOKE ALL ON FUNCTION public.provision_daily_statement_account(text,text,text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.provision_daily_statement_account(text,text,text,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.adopt_daily_statement_historical_account(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adopt_daily_statement_historical_account(text,text,text)
  TO authenticated;

COMMIT;
