-- ============================================================================
-- TREASURY V1 — LOT 1 : refus d'état périmé non rejouables (SQLSTATE 22023)
-- GO_DEV_TRESORERIE_REFUS_ETAT_PERIME_LOCAL — suite du diagnostic
-- GO_DIAG_LOCAL_R9_T3_EMPREINTE_PERIMEE.
-- ============================================================================
-- Constat : trois refus d'état périmé étaient levés avec le SQLSTATE 40001
-- (serialization_failure). PostgREST rejoue en boucle une transaction en échec
-- 40001 (constaté avec la v14.12) : aucune réponse n'arrive, l'interface reste
-- « en cours », la base rejoue la commande jusqu'à ce que l'état change, et une
-- commande périmée peut aboutir plus tard si l'état revient à celui qui avait
-- été lu.
-- Changement, et seulement lui : ces trois refus passent au SQLSTATE 22023,
-- celui des autres refus de ces commandes :
--   - public.treasury_admin_attest_inventory_v1 : TREASURY_INVENTORY_CHANGED ;
--   - public.treasury_admin_set_verified_start_v1 : TREASURY_VERIFIED_START_STALE,
--     unité retenue introuvable, puis unité qui n'est plus celle qui a été lue.
-- Les instructions sont reprises à l'identique des seules définitions de ces
-- fonctions (20261102090000 et 20261103130000), identiques octet pour octet aux
-- définitions effectives après les 50 migrations. Messages métier, signatures,
-- attributs (SECURITY DEFINER, search_path), propriétaire et droits sont
-- inchangés : CREATE OR REPLACE conserve propriétaire et droits. Les refus
-- *_COMMAND_IN_PROGRESS ne sont pas modifiés. Le module reste fermé côté
-- serveur : rien ne s'ouvre par cette migration.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.treasury_admin_attest_inventory_v1(
  p_command_key text, p_inventory_fingerprint text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := treasury_private.require_admin();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_prior jsonb;
  v_current text;
  v_count integer;
  v_seq bigint;
  v_result jsonb;
BEGIN
  v_prior := treasury_private.command_begin(v_actor, 'ATTEST_INVENTORY', p_command_key,
    jsonb_build_object('fingerprint', p_inventory_fingerprint, 'reason', v_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := treasury_private.require_reason(v_reason);

  SELECT count(*) INTO v_count FROM treasury_private.expected_accounts e WHERE e.status = 'ACTIVE';
  IF v_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_INVENTORY_EMPTY';
  END IF;
  v_current := treasury_private.inventory_fingerprint();
  -- L'administrateur atteste ce qu'il a vu : tout changement intercalé est refusé.
  IF p_inventory_fingerprint IS NULL OR p_inventory_fingerprint <> v_current THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_INVENTORY_CHANGED';
  END IF;
  INSERT INTO treasury_private.inventory_attestations (attested_by, inventory_fingerprint, accounts_count, reason)
  VALUES (v_actor, v_current, v_count, v_reason)
  RETURNING seq INTO v_seq;
  INSERT INTO treasury_private.events (event_type, actor_id, payload, reason)
  VALUES ('INVENTORY_ATTESTED', v_actor,
          jsonb_build_object('attestation_seq', v_seq, 'inventory_fingerprint', v_current, 'accounts_count', v_count),
          v_reason);
  v_result := jsonb_build_object('attestation_seq', v_seq, 'inventory_fingerprint', v_current,
                                 'accounts_count', v_count);
  RETURN treasury_private.command_finish(p_command_key, v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.treasury_admin_set_verified_start_v1(
  p_command_key text, p_registry_account_id uuid, p_day date, p_canonical_unit_id uuid, p_content_hash text,
  p_verified_opening text, p_evidence_ref text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := treasury_private.require_admin();
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_evidence text := btrim(coalesce(p_evidence_ref, ''));
  v_prior    jsonb;
  v_unit     public.daily_statement_units_canonical%ROWTYPE;
  v_opening  numeric;
  v_after    uuid;
  v_id       uuid;
  v_read     jsonb;
  v_point    jsonb;
  v_result   jsonb;
BEGIN
  v_prior := treasury_private.command_begin(v_actor, 'SET_VERIFIED_START', p_command_key, jsonb_build_object(
    'registry', p_registry_account_id, 'day', p_day, 'unit', p_canonical_unit_id, 'hash', p_content_hash,
    'opening', p_verified_opening, 'evidence', v_evidence, 'reason', v_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := treasury_private.require_reason(v_reason);
  IF char_length(v_evidence) NOT BETWEEN 1 AND 200 OR v_evidence ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_EVIDENCE_REQUIRED';
  END IF;
  v_evidence := treasury_private.assert_safe_text(v_evidence);
  -- Ouverture lue sur pièce : francs XOF entiers, sans tolérance.
  IF p_verified_opening IS NULL OR btrim(p_verified_opening) !~ '^-?[0-9]{1,16}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_OPENING_NOT_WHOLE_XOF';
  END IF;
  v_opening := btrim(p_verified_opening)::numeric;
  IF NOT EXISTS (SELECT 1 FROM treasury_private.expected_accounts e
                 WHERE e.status = 'ACTIVE' AND e.registry_account_id = p_registry_account_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_EXPECTED_ACCOUNT_UNKNOWN';
  END IF;

  SELECT * INTO v_unit FROM public.daily_statement_units_canonical WHERE id = p_canonical_unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_VERIFIED_START_STALE';
  END IF;
  PERFORM public.daily_stmt_acquire_day_lock(v_unit.day_unit_id);
  -- Puis le fichier de la livraison retenue, en partage (C9) : une révocation
  -- d'attestation de ce fichier attend la pose, ou la précède.
  PERFORM public.daily_stmt_acquire_attempt_lock(
    (SELECT s.attempt_id FROM public.daily_statement_units_staging s WHERE s.id = v_unit.promoted_from_staging_unit_id), false);
  SELECT * INTO v_unit FROM public.daily_statement_units_canonical WHERE id = p_canonical_unit_id;
  IF v_unit.status <> 'ingested' OR v_unit.account_registry_id IS DISTINCT FROM p_registry_account_id
     OR v_unit.accounting_date <> p_day OR v_unit.active_day_content_hash IS DISTINCT FROM p_content_hash THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_VERIFIED_START_STALE';
  END IF;
  IF v_unit.currency <> 'XOF' OR v_unit.opening_balance_derived IS NULL
     OR v_unit.opening_balance_derived <> trunc(v_unit.opening_balance_derived) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_RETAINED_OPENING_NOT_WHOLE_XOF';
  END IF;
  IF v_unit.opening_balance_derived <> v_opening THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_OPENING_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM treasury_private.verified_starts v
             WHERE v.action = 'SET' AND v.registry_account_id = p_registry_account_id AND v.day = p_day
               AND NOT EXISTS (SELECT 1 FROM treasury_private.verified_starts r WHERE r.revokes_id = v.id)) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'TREASURY_VERIFIED_START_ALREADY_ACTIVE';
  END IF;
  SELECT r.id INTO v_after FROM treasury_private.verified_starts r
  WHERE r.action = 'REVOKE' AND r.registry_account_id = p_registry_account_id AND r.day = p_day
    AND NOT EXISTS (SELECT 1 FROM treasury_private.verified_starts a WHERE a.after_revocation_id = r.id)
  ORDER BY r.created_at DESC, r.id LIMIT 1;

  INSERT INTO treasury_private.verified_starts (
    action, registry_account_id, day, canonical_unit_id, content_hash, verified_opening, evidence_ref, reason,
    after_revocation_id, actor_id)
  VALUES ('SET', p_registry_account_id, p_day, p_canonical_unit_id, p_content_hash, v_opening, v_evidence, v_reason,
          v_after, v_actor)
  RETURNING id INTO v_id;

  -- Le point doit être effectif pour sa propre journée S (refus à la pose).
  v_read := treasury_private.balances_snapshot(p_day, treasury_private.today());
  SELECT p INTO v_point
  FROM jsonb_array_elements(v_read -> 'accounts') a, jsonb_array_elements(a -> 'verified_starts') p
  WHERE (a ->> 'registry_account_id')::uuid = p_registry_account_id AND (p ->> 'verified_start_id')::uuid = v_id;
  IF v_point IS NULL OR v_point ->> 'for_date' <> 'EFFECTIVE' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'TREASURY_VERIFIED_START_NOT_EFFECTIVE',
      DETAIL = coalesce(v_point ->> 'suspension', 'UNKNOWN');
  END IF;

  INSERT INTO treasury_private.events (event_type, actor_id, payload, reason)
  VALUES ('VERIFIED_START_SET', v_actor, jsonb_build_object(
            'verified_start_id', v_id, 'registry_account_id', p_registry_account_id, 'day', p_day,
            'canonical_unit_id', p_canonical_unit_id, 'evidence_ref', v_evidence), v_reason);
  v_result := jsonb_build_object('verified_start_id', v_id, 'day', p_day, 'state', 'EFFECTIVE');
  RETURN treasury_private.command_finish(p_command_key, v_result);
END;
$$;

COMMIT;
