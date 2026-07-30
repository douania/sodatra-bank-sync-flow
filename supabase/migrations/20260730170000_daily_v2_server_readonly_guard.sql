-- ============================================================================
-- DAILY-V2 — GARDE SERVEUR FAIL-CLOSED LECTURE SEULE
-- ============================================================================
-- Migration additive postérieure à 0Z.
--
-- Objectif :
--   - faire respecter le mode lecture seule par PostgreSQL, indépendamment du
--     garde client Daily v2 / upload ;
--   - couvrir les huit RPC SECURITY DEFINER actuelles et toute future surface
--     qui écrirait dans les neuf tables Daily v2 ;
--   - rester fail-closed : mutations désactivées par défaut et si le singleton
--     de contrôle est absent ;
--   - ne jamais déduire l'environnement d'une URL, d'un GUC de session ou
--     d'une donnée fournie par le client.
--
-- Doctrine d'environnement :
--   - production : conserver mutations_enabled = false ;
--   - staging : activation opérateur uniquement, avec raison, sous GO séparé ;
--   - aucun setter RPC n'est exposé aux rôles applicatifs.
--
-- Cette migration est CANDIDATE / DRAFT. Ne jamais l'appliquer sur Supabase
-- live sans validation PostgreSQL jetable, staging complet et GO CTO exact.
-- ============================================================================

BEGIN;

-- Schéma volontairement hors de l'API PostgREST exposée. Aucun rôle
-- applicatif ne reçoit USAGE.
CREATE SCHEMA daily_v2_private AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA daily_v2_private
  FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA daily_v2_private
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA daily_v2_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Singleton d'exploitation. La ligne manquante est interprétée comme false par
-- la garde ; une suppression est néanmoins interdite afin de conserver la
-- traçabilité et un point de contrôle explicite.
CREATE TABLE daily_v2_private.runtime_control (
  singleton         boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mutations_enabled boolean NOT NULL DEFAULT false,
  change_reason     text NOT NULL
                    CHECK (
                      char_length(btrim(change_reason)) BETWEEN 8 AND 240
                      AND change_reason !~ '[[:cntrl:]]'
                    ),
  changed_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  session_actor     name NOT NULL DEFAULT session_user,
  effective_actor   name NOT NULL DEFAULT current_user
);

COMMENT ON TABLE daily_v2_private.runtime_control IS
  'Singleton interne Daily v2. false ou ligne absente = toutes mutations métier bloquées. Activation opérateur uniquement sous GO d''environnement séparé.';

CREATE TABLE daily_v2_private.runtime_control_events (
  event_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  previous_enabled  boolean,
  new_enabled       boolean NOT NULL,
  safe_reason       text NOT NULL
                    CHECK (
                      char_length(btrim(safe_reason)) BETWEEN 8 AND 240
                      AND safe_reason !~ '[[:cntrl:]]'
                    ),
  session_actor     name NOT NULL,
  effective_actor   name NOT NULL,
  transaction_id    bigint NOT NULL
);

COMMENT ON TABLE daily_v2_private.runtime_control_events IS
  'Journal append-only interne des bascules du verrou Daily v2. Aucune donnée bancaire ni payload métier.';

ALTER TABLE daily_v2_private.runtime_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_v2_private.runtime_control_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE daily_v2_private.runtime_control
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE daily_v2_private.runtime_control_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE daily_v2_private.runtime_control_events_event_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

-- Valide chaque bascule opérateur et réécrit les métadonnées d'acteur côté
-- serveur. Une mise à jour sans changement de mode ou sans nouvelle raison
-- explicite est refusée.
CREATE FUNCTION daily_v2_private.prepare_runtime_control_change()
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

  IF NEW.mutations_enabled IS NOT DISTINCT FROM OLD.mutations_enabled THEN
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

CREATE TRIGGER daily_v2_runtime_control_prepare
BEFORE UPDATE OR DELETE ON daily_v2_private.runtime_control
FOR EACH ROW
EXECUTE FUNCTION daily_v2_private.prepare_runtime_control_change();

CREATE TRIGGER daily_v2_runtime_control_no_truncate
BEFORE TRUNCATE ON daily_v2_private.runtime_control
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.prepare_runtime_control_change();

-- Journalise chaque bascule. Le journal lui-même est protégé append-only plus
-- bas, y compris contre UPDATE/DELETE/TRUNCATE accidentels par l'opérateur.
CREATE FUNCTION daily_v2_private.append_runtime_control_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO daily_v2_private.runtime_control_events (
    previous_enabled,
    new_enabled,
    safe_reason,
    session_actor,
    effective_actor,
    transaction_id
  )
  VALUES (
    OLD.mutations_enabled,
    NEW.mutations_enabled,
    NEW.change_reason,
    NEW.session_actor,
    NEW.effective_actor,
    txid_current()
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER daily_v2_runtime_control_audit
AFTER UPDATE ON daily_v2_private.runtime_control
FOR EACH ROW
EXECUTE FUNCTION daily_v2_private.append_runtime_control_event();

CREATE FUNCTION daily_v2_private.block_runtime_control_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'DAILY_V2_RUNTIME_CONTROL_EVENTS_APPEND_ONLY';
END;
$$;

CREATE TRIGGER daily_v2_runtime_control_events_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE
ON daily_v2_private.runtime_control_events
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.block_runtime_control_event_mutation();

-- Garde centrale. La requête est volontairement entièrement qualifiée et
-- COALESCE rend l'absence du singleton équivalente à false.
CREATE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_mutations_enabled boolean;
BEGIN
  SELECT c.mutations_enabled
    INTO v_mutations_enabled
  FROM daily_v2_private.runtime_control AS c
  WHERE c.singleton = true;

  IF COALESCE(v_mutations_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '25006',
      MESSAGE = 'DAILY_V2_SERVER_READ_ONLY';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard() IS
  'Garde trigger interne fail-closed : bloque INSERT/UPDATE/DELETE/TRUNCATE sur les neuf tables Daily v2 tant que le singleton opérateur n''est pas explicitement activé.';

REVOKE ALL ON FUNCTION daily_v2_private.prepare_runtime_control_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION daily_v2_private.append_runtime_control_event()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION daily_v2_private.block_runtime_control_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard()
  FROM PUBLIC, anon, authenticated, service_role;

-- État initial explicite et audité : lecture seule. Aucun environnement n'est
-- activé automatiquement par la migration partagée.
INSERT INTO daily_v2_private.runtime_control (
  singleton,
  mutations_enabled,
  change_reason
)
VALUES (
  true,
  false,
  'Initial fail-closed state installed by migration'
);

INSERT INTO daily_v2_private.runtime_control_events (
  previous_enabled,
  new_enabled,
  safe_reason,
  session_actor,
  effective_actor,
  transaction_id
)
SELECT
  NULL,
  mutations_enabled,
  change_reason,
  session_actor,
  effective_actor,
  txid_current()
FROM daily_v2_private.runtime_control
WHERE singleton = true;

-- Un trigger statement-level par table couvre les quatre opérations. Il se
-- déclenche même lorsque la commande ne toucherait aucune ligne.
CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON public.daily_statement_export_attempts
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON public.daily_statement_units_staging
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON public.daily_statement_lines_staging
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON public.daily_statement_units_canonical
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON public.daily_statement_lines_canonical
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON public.daily_statement_import_events
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON public.daily_statement_account_registry
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON public.daily_statement_backfill_grants
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
ON public.daily_statement_account_events
FOR EACH STATEMENT
EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

COMMIT;
