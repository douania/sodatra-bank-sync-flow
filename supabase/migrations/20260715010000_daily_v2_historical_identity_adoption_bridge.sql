-- ============================================================================
-- DAILY-V2-0U3 — PONT D'ADOPTION DES IDENTITES HISTORIQUES
-- ============================================================================
-- Migration additive, postérieure à 20260715000000. Elle ne migre aucune
-- donnée automatiquement : un administrateur authentifié déclenche l'adoption
-- d'un contexte historique unique après le préflight staging dédié.
--
-- Invariants :
--   - le fingerprint historique reste strictement inchangé ;
--   - aucun day_unit_id, hash, statut, montant ou ligne n'est modifié ;
--   - attempts, staging et canonical sont rattachés dans la même transaction ;
--   - le fingerprint n'est ni accepté en paramètre, ni renvoyé, ni audité ;
--   - ambiguïté, reprise partielle ou masque divergent => échec intégral.
-- ============================================================================

BEGIN;

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

  -- Sérialise les adoptions d'un même contexte sans verrouiller globalement
  -- le pipeline Daily v2. La clé ne contient aucune identité bancaire.
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
  v_fingerprint := public.daily_stmt_assert_hex64(
    v_fingerprint,
    'historical account_fingerprint'
  );

  -- Un fingerprint historique ne doit jamais être partagé par plusieurs
  -- contextes banque/devise, même dans une table seulement.
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

  -- Une exécution précédente incomplète ou un rattachement manuel interdit
  -- toute reprise implicite. L'opérateur doit d'abord auditer l'état.
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
    account_fingerprint, account_number_masked
  ) VALUES (
    v_actor, v_bank, v_currency, v_alias,
    v_fingerprint, v_masked
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
      'attempts_mapped', v_attempts_updated,
      'staging_units_mapped', v_staging_updated,
      'canonical_units_mapped', v_canonical_updated
    )
  );

  -- Le fingerprint et le masque ne sont volontairement pas renvoyés.
  RETURN jsonb_build_object(
    'outcome', 'adopted',
    'account_registry_id', v_account_id,
    'bank', v_bank,
    'currency', v_currency,
    'safe_alias', v_alias,
    'attempts_mapped', v_attempts_updated,
    'staging_units_mapped', v_staging_updated,
    'canonical_units_mapped', v_canonical_updated
  );
END;
$$;

COMMENT ON FUNCTION public.adopt_daily_statement_historical_account(text,text,text)
IS 'Admin-only one-time bridge: adopts one unambiguous historical Daily v2 identity without exposing or changing its fingerprint.';

REVOKE ALL ON FUNCTION public.adopt_daily_statement_historical_account(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adopt_daily_statement_historical_account(text,text,text)
  TO authenticated;

COMMIT;
