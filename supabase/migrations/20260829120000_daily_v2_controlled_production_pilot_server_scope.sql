-- ============================================================================
-- DAILY-V2 — SCOPES SERVEUR DU PILOTE DE PRODUCTION CONTROLE
-- ============================================================================
-- Migration forward-only postérieure au hardening BIS 0V.
--
-- Objectif :
--   - conserver mutations_enabled comme kill switch maître ;
--   - séparer côté serveur les scopes daily, admin et backfill ;
--   - empêcher un administrateur authentifié de contourner l'UI en appelant
--     directement une RPC admin/backfill pendant un pilote daily-only ;
--   - préserver l'état opérationnel existant lors de la migration : chaque
--     nouveau scope reprend la valeur courante du kill switch, sans aucune
--     activation supplémentaire ;
--   - journaliser toute modification du kill switch ou d'un scope.
--
-- Cette migration est CANDIDATE / DRAFT. Elle ne doit jamais être appliquée
-- sur Supabase live sans contre-review, validation PostgreSQL jetable, staging
-- complet et GO CTO d'environnement exact.
-- ============================================================================

BEGIN;

-- Les colonnes sont d'abord nullables afin que l'initialisation state-preserving
-- soit auditée par les triggers existants une fois leurs fonctions remplacées.
ALTER TABLE daily_v2_private.runtime_control
  ADD COLUMN daily_scope_enabled boolean,
  ADD COLUMN admin_scope_enabled boolean,
  ADD COLUMN backfill_scope_enabled boolean;

ALTER TABLE daily_v2_private.runtime_control_events
  ADD COLUMN previous_daily_scope_enabled boolean,
  ADD COLUMN new_daily_scope_enabled boolean,
  ADD COLUMN previous_admin_scope_enabled boolean,
  ADD COLUMN new_admin_scope_enabled boolean,
  ADD COLUMN previous_backfill_scope_enabled boolean,
  ADD COLUMN new_backfill_scope_enabled boolean;

-- Une mise à jour est valide si le kill switch OU au moins un scope change.
-- La raison doit rester nouvelle, bornée et sans caractère de contrôle.
CREATE OR REPLACE FUNCTION daily_v2_private.prepare_runtime_control_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'DAILY_V2_RUNTIME_CONTROL_DELETE_FORBIDDEN';
  END IF;

  IF NEW.singleton IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'DAILY_V2_RUNTIME_CONTROL_SINGLETON_REQUIRED';
  END IF;

  IF NEW.mutations_enabled IS NOT DISTINCT FROM OLD.mutations_enabled
     AND NEW.daily_scope_enabled IS NOT DISTINCT FROM OLD.daily_scope_enabled
     AND NEW.admin_scope_enabled IS NOT DISTINCT FROM OLD.admin_scope_enabled
     AND NEW.backfill_scope_enabled IS NOT DISTINCT FROM OLD.backfill_scope_enabled
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'DAILY_V2_RUNTIME_CONTROL_MODE_UNCHANGED';
  END IF;

  IF char_length(btrim(NEW.change_reason)) NOT BETWEEN 8 AND 240
     OR NEW.change_reason ~ '[[:cntrl:]]'
     OR btrim(NEW.change_reason) = btrim(OLD.change_reason)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'DAILY_V2_RUNTIME_CONTROL_NEW_SAFE_REASON_REQUIRED';
  END IF;

  NEW.changed_at := statement_timestamp();
  NEW.session_actor := session_user;
  NEW.effective_actor := current_user;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION daily_v2_private.append_runtime_control_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO daily_v2_private.runtime_control_events (
    previous_enabled,
    new_enabled,
    previous_daily_scope_enabled,
    new_daily_scope_enabled,
    previous_admin_scope_enabled,
    new_admin_scope_enabled,
    previous_backfill_scope_enabled,
    new_backfill_scope_enabled,
    safe_reason,
    session_actor,
    effective_actor,
    transaction_id
  )
  VALUES (
    OLD.mutations_enabled,
    NEW.mutations_enabled,
    OLD.daily_scope_enabled,
    NEW.daily_scope_enabled,
    OLD.admin_scope_enabled,
    NEW.admin_scope_enabled,
    OLD.backfill_scope_enabled,
    NEW.backfill_scope_enabled,
    NEW.change_reason,
    NEW.session_actor,
    NEW.effective_actor,
    txid_current()
  );
  RETURN NULL;
END;
$$;

-- Préserve exactement le comportement de l'environnement au moment de
-- l'application : un environnement fermé reste fermé ; un staging ouvert
-- conserve temporairement ses trois scopes jusqu'à décision opérateur.
UPDATE daily_v2_private.runtime_control
SET
  daily_scope_enabled = mutations_enabled,
  admin_scope_enabled = mutations_enabled,
  backfill_scope_enabled = mutations_enabled,
  change_reason = 'Initialize scoped runtime control from existing master lock'
WHERE singleton = true;

ALTER TABLE daily_v2_private.runtime_control
  ALTER COLUMN daily_scope_enabled SET DEFAULT false,
  ALTER COLUMN daily_scope_enabled SET NOT NULL,
  ALTER COLUMN admin_scope_enabled SET DEFAULT false,
  ALTER COLUMN admin_scope_enabled SET NOT NULL,
  ALTER COLUMN backfill_scope_enabled SET DEFAULT false,
  ALTER COLUMN backfill_scope_enabled SET NOT NULL;

COMMENT ON COLUMN daily_v2_private.runtime_control.mutations_enabled IS
  'Kill switch maître. false bloque toutes les mutations quels que soient les scopes.';
COMMENT ON COLUMN daily_v2_private.runtime_control.daily_scope_enabled IS
  'Autorise uniquement dépôt requested_mode=daily, promotion et supersede, sous kill switch maître.';
COMMENT ON COLUMN daily_v2_private.runtime_control.admin_scope_enabled IS
  'Autorise uniquement provisionnement, désactivation et adoption historique, sous kill switch maître.';
COMMENT ON COLUMN daily_v2_private.runtime_control.backfill_scope_enabled IS
  'Autorise uniquement émission/révocation de grant et dépôt requested_mode=backfill, sous kill switch maître.';

-- Assertion privée appelée par chaque wrapper public avant toute délégation au
-- coeur mutatif. Ligne absente, kill switch faux, scope absent ou faux : refus.
CREATE FUNCTION daily_v2_private.assert_runtime_scope(p_scope text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_master_enabled boolean;
  v_scope_enabled boolean;
BEGIN
  IF p_scope NOT IN ('daily', 'admin', 'backfill') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'DAILY_V2_RUNTIME_SCOPE_UNKNOWN';
  END IF;

  SELECT
    control.mutations_enabled,
    CASE p_scope
      WHEN 'daily' THEN control.daily_scope_enabled
      WHEN 'admin' THEN control.admin_scope_enabled
      WHEN 'backfill' THEN control.backfill_scope_enabled
    END
  INTO v_master_enabled, v_scope_enabled
  FROM daily_v2_private.runtime_control AS control
  WHERE control.singleton = true;

  IF COALESCE(v_master_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '25006',
      MESSAGE = 'DAILY_V2_SERVER_READ_ONLY';
  END IF;

  IF COALESCE(v_scope_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'DAILY_V2_RUNTIME_SCOPE_DISABLED: ' || p_scope || ' scope disabled';
  END IF;
END;
$$;

COMMENT ON FUNCTION daily_v2_private.assert_runtime_scope(text) IS
  'Barrière privée fail-closed : exige kill switch maître et scope serveur explicite avant toute RPC Daily v2 mutative.';

REVOKE ALL ON FUNCTION daily_v2_private.prepare_runtime_control_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION daily_v2_private.append_runtime_control_event()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION daily_v2_private.assert_runtime_scope(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Le booléen historique consommé par le frontend signifie désormais
-- précisément « mutations journalières disponibles » : master AND daily.
CREATE OR REPLACE FUNCTION public.daily_stmt_mutations_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT control.mutations_enabled AND control.daily_scope_enabled
      FROM daily_v2_private.runtime_control AS control
      WHERE control.singleton = true
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.daily_stmt_mutations_enabled()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.daily_stmt_mutations_enabled()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.daily_stmt_mutations_enabled() IS
  'Read-only Daily v2 daily-scope state. Returns master AND daily scope; absent control returns false.';

-- Les huit fonctions mutatives existantes deviennent des coeurs inaccessibles.
-- Leurs wrappers publics conservent signatures et contrats applicatifs.
ALTER FUNCTION public.pre_ingest_daily_statement_units(jsonb,jsonb,jsonb,jsonb)
  RENAME TO daily_stmt_pre_ingest_scoped_core_0w;
ALTER FUNCTION public.promote_daily_statement_unit(uuid,text)
  RENAME TO daily_stmt_promote_scoped_core_0w;
ALTER FUNCTION public.supersede_daily_statement_unit(uuid,uuid,text)
  RENAME TO daily_stmt_supersede_scoped_core_0w;
ALTER FUNCTION public.provision_daily_statement_account(text,text,text,text)
  RENAME TO daily_stmt_provision_account_scoped_core_0w;
ALTER FUNCTION public.deactivate_daily_statement_account(uuid,text)
  RENAME TO daily_stmt_deactivate_account_scoped_core_0w;
ALTER FUNCTION public.adopt_daily_statement_historical_account(text,text,text)
  RENAME TO daily_stmt_adopt_historical_scoped_core_0w;
ALTER FUNCTION public.issue_daily_statement_backfill_grant(uuid,date,date,integer,timestamptz)
  RENAME TO daily_stmt_issue_backfill_grant_scoped_core_0w;
ALTER FUNCTION public.revoke_daily_statement_backfill_grant(uuid,text)
  RENAME TO daily_stmt_revoke_backfill_grant_scoped_core_0w;

REVOKE ALL ON FUNCTION public.daily_stmt_pre_ingest_scoped_core_0w(jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_promote_scoped_core_0w(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_supersede_scoped_core_0w(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_provision_account_scoped_core_0w(text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_deactivate_account_scoped_core_0w(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_adopt_historical_scoped_core_0w(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_issue_backfill_grant_scoped_core_0w(uuid,date,date,integer,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_revoke_backfill_grant_scoped_core_0w(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.pre_ingest_daily_statement_units(
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
  v_mode text;
BEGIN
  IF p_attempt IS NULL OR jsonb_typeof(p_attempt) <> 'object' THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTEMPT_OBJECT_REQUIRED (fail-closed)';
  END IF;
  v_mode := p_attempt ->> 'requested_mode';
  IF v_mode = 'daily' THEN
    PERFORM daily_v2_private.assert_runtime_scope('daily');
  ELSIF v_mode = 'backfill' THEN
    PERFORM daily_v2_private.assert_runtime_scope('backfill');
  ELSE
    RAISE EXCEPTION 'DAILY_STMT_MODE_UNSUPPORTED: requested_mode must be daily or backfill (fail-closed)';
  END IF;
  RETURN public.daily_stmt_pre_ingest_scoped_core_0w(
    p_attempt, p_units, p_lines, p_guard_context
  );
END;
$$;

CREATE FUNCTION public.promote_daily_statement_unit(
  p_staging_unit_id uuid,
  p_approval_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('daily');
  RETURN public.daily_stmt_promote_scoped_core_0w(
    p_staging_unit_id, p_approval_reason
  );
END;
$$;

CREATE FUNCTION public.supersede_daily_statement_unit(
  p_old_canonical_unit_id uuid,
  p_new_staging_unit_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('daily');
  RETURN public.daily_stmt_supersede_scoped_core_0w(
    p_old_canonical_unit_id, p_new_staging_unit_id, p_reason
  );
END;
$$;

CREATE FUNCTION public.provision_daily_statement_account(
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
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('admin');
  RETURN public.daily_stmt_provision_account_scoped_core_0w(
    p_bank, p_currency, p_safe_alias, p_account_number_masked
  );
END;
$$;

CREATE FUNCTION public.deactivate_daily_statement_account(
  p_account_registry_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('admin');
  RETURN public.daily_stmt_deactivate_account_scoped_core_0w(
    p_account_registry_id, p_reason
  );
END;
$$;

CREATE FUNCTION public.adopt_daily_statement_historical_account(
  p_bank text,
  p_currency text,
  p_safe_alias text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('admin');
  RETURN public.daily_stmt_adopt_historical_scoped_core_0w(
    p_bank, p_currency, p_safe_alias
  );
END;
$$;

CREATE FUNCTION public.issue_daily_statement_backfill_grant(
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
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('backfill');
  RETURN public.daily_stmt_issue_backfill_grant_scoped_core_0w(
    p_account_registry_id, p_period_start, p_period_end, p_max_units, p_expires_at
  );
END;
$$;

CREATE FUNCTION public.revoke_daily_statement_backfill_grant(
  p_backfill_grant_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('backfill');
  RETURN public.daily_stmt_revoke_backfill_grant_scoped_core_0w(
    p_backfill_grant_id, p_reason
  );
END;
$$;

-- Surface API minimale : seuls les wrappers publics conservent EXECUTE pour
-- authenticated. PUBLIC, anon et service_role restent privés de mutation.
REVOKE ALL ON FUNCTION public.pre_ingest_daily_statement_units(jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pre_ingest_daily_statement_units(jsonb,jsonb,jsonb,jsonb)
  TO authenticated;

REVOKE ALL ON FUNCTION public.promote_daily_statement_unit(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_daily_statement_unit(uuid,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.supersede_daily_statement_unit(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.supersede_daily_statement_unit(uuid,uuid,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.provision_daily_statement_account(text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provision_daily_statement_account(text,text,text,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.deactivate_daily_statement_account(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_daily_statement_account(uuid,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.adopt_daily_statement_historical_account(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adopt_daily_statement_historical_account(text,text,text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.issue_daily_statement_backfill_grant(uuid,date,date,integer,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_daily_statement_backfill_grant(uuid,date,date,integer,timestamptz)
  TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_daily_statement_backfill_grant(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_daily_statement_backfill_grant(uuid,text)
  TO authenticated;

COMMIT;
