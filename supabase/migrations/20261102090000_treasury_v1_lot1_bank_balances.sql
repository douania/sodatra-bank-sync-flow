-- ============================================================================
-- TREASURY V1 — LOT 1 : SOLDES FIABLES MULTIBANQUES (couche « solde » seule)
-- GO_IMPLEMENT_TREASURY_V1_LOT1_BANK_BALANCES — cadrage R3 PASS_WITH_RESERVES.
-- ============================================================================
-- Migration ADDITIVE. Aucun objet Daily v2, payables, legacy, Auth ou RLS
-- existant n'est modifié : nouveau schéma privé `treasury_private`, cinq
-- fonctions publiques. Aucune donnée de paiement n'est lue (registre des
-- chèques, factures, virements, remises, facilités) ; la seule dépendance au
-- module chèques est l'autorité existante :
--   - lecture : payables_private.require_bank_read (READ ou AUDIT + BANK_READ),
--     mécanisme inchangé, aucune RLS Daily v2 touchée ;
--   - administration de l'inventaire : payables_private.require_admin
--     (administrateur unique), aucun nouveau rôle ni circuit d'attribution.
--
-- Provenance des périodes d'export établie format par format (commit 49afcef) :
--   - CSV BDK/ORA (`structured_bank_statement_csv`, `structured-csv-0b`) :
--     période DÉCLARÉE par la ligne d'en-tête « Période » de la banque,
--     obligatoire à l'import (dailyV2BrowserPipeline.requireStrictDate) ;
--   - Excel ATB/BICIS/BIS (.xls) et BRIDGE (.xlsx) (`structured-excel-0q/…`) :
--     période DÉDUITE de la première et de la dernière opération
--     (structuredBankStatementExcelParser) : elle ne prouve aucune journée.
-- Une journée sans mouvement n'a jamais d'unité Daily v2 (line_count >= 1).
-- Elle n'est couverte que par une PREUVE POSITIVE : période déclarée d'un
-- export valide, entièrement accepté, et journée close pour cet export ; sinon
-- elle reste NON COUVERTE. Aucune unité fictive, aucune opération artificielle.
-- Une journée n'est close que par une preuve tirée des données : le fichier qui
-- la livre porte une ligne datée après elle, ou l'ouverture de la journée
-- suivante retenue confirme sa clôture. Ni l'instant de dépôt ni la date de
-- référence saisie ne prouvent la fin d'une journée.
--
-- Module FERMÉ côté serveur par défaut : aucune lecture ni commande tant que
-- le canal opérateur (`treasury_private.set_module_open`, sans privilège
-- d'exécution accordé) ne l'a pas ouvert. Appliquer cette migration n'ouvre
-- donc rien ; toute ouverture d'environnement relève d'un GO dédié.
-- ============================================================================

BEGIN;

CREATE SCHEMA treasury_private;
REVOKE ALL ON SCHEMA treasury_private FROM PUBLIC;
REVOKE ALL ON SCHEMA treasury_private FROM anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 1. Formats supportés et provenance des périodes (constat de code, figé)
-- --------------------------------------------------------------------------
CREATE TABLE treasury_private.supported_formats (
  bank                  text NOT NULL,
  source_format         text NOT NULL,
  parser_version_prefix text NOT NULL CHECK (char_length(parser_version_prefix) BETWEEN 1 AND 80),
  period_provenance     text NOT NULL CHECK (period_provenance IN ('DECLARED', 'INFERRED')),
  basis                 text NOT NULL CHECK (char_length(btrim(basis)) BETWEEN 1 AND 300),
  PRIMARY KEY (bank, source_format),
  CONSTRAINT supported_formats_bank CHECK (bank IN ('BDK', 'ORA', 'ATB', 'BICIS', 'BIS', 'BRIDGE')),
  CONSTRAINT supported_formats_format CHECK (source_format IN (
    'structured_bank_statement_csv', 'structured_bank_statement_xls', 'structured_bank_statement_xlsx'))
);

INSERT INTO treasury_private.supported_formats (bank, source_format, parser_version_prefix, period_provenance, basis) VALUES
  ('BDK', 'structured_bank_statement_csv', 'structured-csv-0b', 'DECLARED',
   'En-tête « Période » déclaré par la banque, exigé par le pipeline Daily v2 (49afcef).'),
  ('ORA', 'structured_bank_statement_csv', 'structured-csv-0b', 'DECLARED',
   'En-tête « Période » déclaré par la banque, exigé par le pipeline Daily v2 (49afcef).'),
  ('ATB', 'structured_bank_statement_xls', 'structured-excel-0q/', 'INFERRED',
   'Période déduite de la première et de la dernière opération (profil Excel, 49afcef).'),
  ('BICIS', 'structured_bank_statement_xls', 'structured-excel-0q/', 'INFERRED',
   'Période déduite de la première et de la dernière opération (profil Excel, 49afcef).'),
  ('BIS', 'structured_bank_statement_xls', 'structured-excel-0q/', 'INFERRED',
   'Période déduite de la première et de la dernière opération (profil Excel, 49afcef).'),
  ('BRIDGE', 'structured_bank_statement_xlsx', 'structured-excel-0q/', 'INFERRED',
   'Période déduite de la première et de la dernière opération (profil Excel, 49afcef).');

-- --------------------------------------------------------------------------
-- 2. Qualification par banque et format : ajout seul, canal opérateur
-- --------------------------------------------------------------------------
CREATE TABLE treasury_private.bank_format_qualifications (
  seq            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bank           text NOT NULL,
  source_format  text NOT NULL,
  status         text NOT NULL CHECK (status IN ('NOT_QUALIFIED', 'PILOT', 'QUALIFIED', 'SUSPENDED')),
  evidence_ref   text NOT NULL CHECK (char_length(btrim(evidence_ref)) BETWEEN 1 AND 200
                   AND evidence_ref !~ '[[:cntrl:]]'),
  reason         text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500
                   AND reason !~ '[[:cntrl:]]'),
  operator_label text NOT NULL CHECK (char_length(btrim(operator_label)) BETWEEN 1 AND 80
                   AND operator_label !~ '[[:cntrl:]]'),
  decided_at     timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (bank, source_format) REFERENCES treasury_private.supported_formats (bank, source_format)
);

-- Interrupteur serveur du module : ajout seul, canal opérateur, fermé sans
-- décision enregistrée.
CREATE TABLE treasury_private.module_switch_events (
  seq            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  is_open        boolean NOT NULL,
  evidence_ref   text NOT NULL CHECK (char_length(btrim(evidence_ref)) BETWEEN 1 AND 200
                   AND evidence_ref !~ '[[:cntrl:]]'),
  reason         text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500
                   AND reason !~ '[[:cntrl:]]'),
  operator_label text NOT NULL CHECK (char_length(btrim(operator_label)) BETWEEN 1 AND 80
                   AND operator_label !~ '[[:cntrl:]]'),
  decided_at     timestamptz NOT NULL DEFAULT statement_timestamp()
);

-- --------------------------------------------------------------------------
-- 3. Inventaire des comptes attendus, attestations, journal, commandes
-- --------------------------------------------------------------------------
CREATE TABLE treasury_private.expected_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank                text NOT NULL CHECK (bank IN ('BDK', 'ORA', 'ATB', 'BICIS', 'BIS', 'BRIDGE', 'NSIA')),
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  registry_account_id uuid REFERENCES public.daily_statement_account_registry (id),
  safe_alias          text CHECK (safe_alias IS NULL OR (char_length(btrim(safe_alias)) BETWEEN 1 AND 80
                        AND safe_alias !~ '[[:cntrl:]]')),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at          timestamptz NOT NULL DEFAULT statement_timestamp(),
  created_by          uuid NOT NULL REFERENCES auth.users (id),
  created_reason      text NOT NULL CHECK (char_length(btrim(created_reason)) BETWEEN 5 AND 500),
  linked_at           timestamptz,
  linked_by           uuid REFERENCES auth.users (id),
  retired_at          timestamptz,
  retired_by          uuid REFERENCES auth.users (id),
  retired_reason      text,
  -- Un compte du registre Daily v2 garde son identité canonique ; un compte
  -- attendu sans relevé (NSIA, compte à ouvrir) porte son propre alias.
  CONSTRAINT expected_accounts_identity CHECK (
    (registry_account_id IS NOT NULL AND safe_alias IS NULL)
    OR (registry_account_id IS NULL AND safe_alias IS NOT NULL)
    OR (registry_account_id IS NOT NULL AND linked_at IS NOT NULL)),
  CONSTRAINT expected_accounts_nsia_unregistered CHECK (bank <> 'NSIA' OR registry_account_id IS NULL),
  CONSTRAINT expected_accounts_link_coherent CHECK ((linked_at IS NULL) = (linked_by IS NULL)),
  CONSTRAINT expected_accounts_retire_coherent CHECK (
    (status = 'ACTIVE' AND retired_at IS NULL AND retired_by IS NULL AND retired_reason IS NULL)
    OR (status = 'RETIRED' AND retired_at IS NOT NULL AND retired_by IS NOT NULL
        AND char_length(btrim(coalesce(retired_reason, ''))) BETWEEN 5 AND 500))
);

-- Ni doublon ni double comptage : un compte du registre au plus une fois
-- parmi les comptes attendus actifs ; un alias non enregistré unique.
CREATE UNIQUE INDEX uq_treasury_expected_registry_active
  ON treasury_private.expected_accounts (registry_account_id)
  WHERE status = 'ACTIVE' AND registry_account_id IS NOT NULL;
CREATE UNIQUE INDEX uq_treasury_expected_alias_active
  ON treasury_private.expected_accounts (bank, currency, lower(btrim(safe_alias)))
  WHERE status = 'ACTIVE' AND registry_account_id IS NULL;

CREATE TABLE treasury_private.inventory_attestations (
  seq                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attested_by           uuid NOT NULL REFERENCES auth.users (id),
  attested_at           timestamptz NOT NULL DEFAULT statement_timestamp(),
  inventory_fingerprint text NOT NULL CHECK (inventory_fingerprint ~ '^[0-9a-f]{64}$'),
  accounts_count        integer NOT NULL CHECK (accounts_count >= 1),
  reason                text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500)
);

CREATE TABLE treasury_private.events (
  seq            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type     text NOT NULL CHECK (event_type IN (
                   'EXPECTED_ACCOUNT_ADDED', 'EXPECTED_ACCOUNT_LINKED', 'EXPECTED_ACCOUNT_RETIRED',
                   'INVENTORY_ATTESTED', 'QUALIFICATION_RECORDED', 'MODULE_SWITCH_RECORDED')),
  actor_id       uuid REFERENCES auth.users (id),
  operator_label text,
  payload        jsonb NOT NULL,
  reason         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT events_author CHECK ((actor_id IS NULL) <> (operator_label IS NULL))
);

CREATE TABLE treasury_private.commands (
  command_key  text PRIMARY KEY CHECK (command_key ~ '^[A-Za-z0-9._:-]{8,120}$'),
  command_name text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES auth.users (id),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result       jsonb,
  created_at   timestamptz NOT NULL DEFAULT statement_timestamp(),
  finished_at  timestamptz
);

-- Gardes de mutation : ajout seul, sauf transitions explicitement prévues.
CREATE FUNCTION treasury_private.block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TREASURY_APPEND_ONLY';
END;
$$;

CREATE FUNCTION treasury_private.guard_expected_accounts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TREASURY_APPEND_ONLY';
  END IF;
  -- Rattachement unique d'un compte non enregistré à son compte du registre.
  IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE' AND OLD.registry_account_id IS NULL
     AND NEW.registry_account_id IS NOT NULL AND OLD.linked_at IS NULL AND NEW.linked_at IS NOT NULL
     AND NEW.id = OLD.id AND NEW.bank = OLD.bank AND NEW.currency = OLD.currency
     AND NEW.safe_alias IS NOT DISTINCT FROM OLD.safe_alias AND NEW.created_at = OLD.created_at
     AND NEW.created_by = OLD.created_by AND NEW.created_reason = OLD.created_reason
     AND NEW.retired_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- Retrait unique.
  IF OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED'
     AND NEW.id = OLD.id AND NEW.bank = OLD.bank AND NEW.currency = OLD.currency
     AND NEW.registry_account_id IS NOT DISTINCT FROM OLD.registry_account_id
     AND NEW.safe_alias IS NOT DISTINCT FROM OLD.safe_alias AND NEW.created_at = OLD.created_at
     AND NEW.created_by = OLD.created_by AND NEW.created_reason = OLD.created_reason
     AND NEW.linked_at IS NOT DISTINCT FROM OLD.linked_at AND NEW.linked_by IS NOT DISTINCT FROM OLD.linked_by THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TREASURY_APPEND_ONLY';
END;
$$;

CREATE FUNCTION treasury_private.guard_commands()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.result IS NULL AND NEW.result IS NOT NULL AND NEW.finished_at IS NOT NULL
     AND NEW.command_key = OLD.command_key AND NEW.command_name = OLD.command_name
     AND NEW.actor_id = OLD.actor_id AND NEW.request_hash = OLD.request_hash AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TREASURY_APPEND_ONLY';
END;
$$;

CREATE TRIGGER treasury_supported_formats_append_only
  BEFORE UPDATE OR DELETE ON treasury_private.supported_formats
  FOR EACH ROW EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_qualifications_append_only
  BEFORE UPDATE OR DELETE ON treasury_private.bank_format_qualifications
  FOR EACH ROW EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_module_switch_append_only
  BEFORE UPDATE OR DELETE ON treasury_private.module_switch_events
  FOR EACH ROW EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_attestations_append_only
  BEFORE UPDATE OR DELETE ON treasury_private.inventory_attestations
  FOR EACH ROW EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_events_append_only
  BEFORE UPDATE OR DELETE ON treasury_private.events
  FOR EACH ROW EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_expected_accounts_guard
  BEFORE UPDATE OR DELETE ON treasury_private.expected_accounts
  FOR EACH ROW EXECUTE FUNCTION treasury_private.guard_expected_accounts();
CREATE TRIGGER treasury_commands_guard
  BEFORE UPDATE OR DELETE ON treasury_private.commands
  FOR EACH ROW EXECUTE FUNCTION treasury_private.guard_commands();
CREATE TRIGGER treasury_supported_formats_no_truncate
  BEFORE TRUNCATE ON treasury_private.supported_formats
  FOR EACH STATEMENT EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_qualifications_no_truncate
  BEFORE TRUNCATE ON treasury_private.bank_format_qualifications
  FOR EACH STATEMENT EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_module_switch_no_truncate
  BEFORE TRUNCATE ON treasury_private.module_switch_events
  FOR EACH STATEMENT EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_expected_accounts_no_truncate
  BEFORE TRUNCATE ON treasury_private.expected_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_attestations_no_truncate
  BEFORE TRUNCATE ON treasury_private.inventory_attestations
  FOR EACH STATEMENT EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_events_no_truncate
  BEFORE TRUNCATE ON treasury_private.events
  FOR EACH STATEMENT EXECUTE FUNCTION treasury_private.block_mutation();
CREATE TRIGGER treasury_commands_no_truncate
  BEFORE TRUNCATE ON treasury_private.commands
  FOR EACH STATEMENT EXECUTE FUNCTION treasury_private.block_mutation();

-- --------------------------------------------------------------------------
-- 4. Outils internes
-- --------------------------------------------------------------------------
CREATE FUNCTION treasury_private.today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT (statement_timestamp() AT TIME ZONE 'Africa/Dakar')::date $$;

CREATE FUNCTION treasury_private.require_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'TREASURY_AUTH_REQUIRED';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE FUNCTION treasury_private.require_reason(p_reason text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v text := btrim(coalesce(p_reason, ''));
BEGIN
  IF char_length(v) < 5 OR char_length(v) > 500 OR v ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_REASON_REQUIRED';
  END IF;
  RETURN v;
END;
$$;

-- Module fermé tant que la dernière décision opérateur n'est pas une ouverture.
CREATE FUNCTION treasury_private.require_module_open()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT coalesce((SELECT s.is_open FROM treasury_private.module_switch_events s ORDER BY s.seq DESC LIMIT 1), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TREASURY_MODULE_CLOSED';
  END IF;
END;
$$;

-- Empreinte de l'inventaire actif : ce que l'administrateur atteste.
CREATE FUNCTION treasury_private.inventory_fingerprint()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT encode(sha256(convert_to(coalesce(string_agg(
           e.id::text || '|' || e.bank || '|' || e.currency || '|' || coalesce(e.registry_account_id::text, '-')
           || '|' || coalesce(lower(btrim(e.safe_alias)), '-'), ';' ORDER BY e.id), ''), 'UTF8')), 'hex')
  FROM treasury_private.expected_accounts e
  WHERE e.status = 'ACTIVE'
$$;

-- Idempotence : la clé est réservée AVANT tout effet ; un rejeu identique rend
-- le résultat enregistré ; une même clé pour une autre demande est refusée.
CREATE FUNCTION treasury_private.command_begin(p_actor uuid, p_command text, p_key text, p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_hash text := encode(sha256(convert_to(p_command || ':' || p_request::text, 'UTF8')), 'hex');
  v_row treasury_private.commands%ROWTYPE;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9._:-]{8,120}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_COMMAND_KEY_INVALID';
  END IF;
  SELECT * INTO v_row FROM treasury_private.commands c WHERE c.command_key = p_key;
  IF NOT FOUND THEN
    BEGIN
      INSERT INTO treasury_private.commands (command_key, command_name, actor_id, request_hash)
      VALUES (p_key, p_command, p_actor, v_hash);
      RETURN NULL;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_row FROM treasury_private.commands c WHERE c.command_key = p_key;
    END;
  END IF;
  IF v_row.command_name <> p_command OR v_row.actor_id <> p_actor OR v_row.request_hash <> v_hash THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_COMMAND_KEY_REUSED';
  END IF;
  IF v_row.result IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TREASURY_COMMAND_IN_PROGRESS';
  END IF;
  RETURN v_row.result;
END;
$$;

CREATE FUNCTION treasury_private.command_finish(p_key text, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE treasury_private.commands
     SET result = p_result, finished_at = statement_timestamp()
   WHERE command_key = p_key AND result IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TREASURY_COMMAND_IN_PROGRESS';
  END IF;
  RETURN p_result;
END;
$$;

-- Administration de l'inventaire : autorité existante de l'administrateur
-- unique, inchangée.
CREATE FUNCTION treasury_private.require_admin()
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_actor uuid := treasury_private.require_actor();
BEGIN
  PERFORM treasury_private.require_module_open();
  PERFORM payables_private.require_admin(v_actor);
  -- Une seule modification d'inventaire à la fois : l'empreinte attestée
  -- correspond toujours à un état réellement observé.
  PERFORM pg_advisory_xact_lock(hashtextextended('treasury:inventory', 0));
  RETURN v_actor;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Canal opérateur de qualification (aucun privilège d'exécution accordé)
-- --------------------------------------------------------------------------
CREATE FUNCTION treasury_private.set_bank_format_qualification(
  p_bank text, p_source_format text, p_status text, p_evidence_ref text, p_reason text, p_operator_label text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_seq bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM treasury_private.supported_formats f
                 WHERE f.bank = p_bank AND f.source_format = p_source_format) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_FORMAT_UNSUPPORTED';
  END IF;
  INSERT INTO treasury_private.bank_format_qualifications
    (bank, source_format, status, evidence_ref, reason, operator_label)
  VALUES (p_bank, p_source_format, p_status, btrim(p_evidence_ref), btrim(p_reason), btrim(p_operator_label))
  RETURNING seq INTO v_seq;
  INSERT INTO treasury_private.events (event_type, operator_label, payload, reason)
  VALUES ('QUALIFICATION_RECORDED', btrim(p_operator_label),
          jsonb_build_object('bank', p_bank, 'source_format', p_source_format, 'status', p_status,
                             'evidence_ref', btrim(p_evidence_ref), 'seq', v_seq), btrim(p_reason));
  RETURN v_seq;
END;
$$;

-- Ouverture ou fermeture du module côté serveur : même canal opérateur,
-- journalisé, sans privilège d'exécution accordé.
CREATE FUNCTION treasury_private.set_module_open(
  p_open boolean, p_evidence_ref text, p_reason text, p_operator_label text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_seq bigint;
BEGIN
  IF p_open IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_SWITCH_INVALID';
  END IF;
  INSERT INTO treasury_private.module_switch_events (is_open, evidence_ref, reason, operator_label)
  VALUES (p_open, btrim(p_evidence_ref), btrim(p_reason), btrim(p_operator_label))
  RETURNING seq INTO v_seq;
  INSERT INTO treasury_private.events (event_type, operator_label, payload, reason)
  VALUES ('MODULE_SWITCH_RECORDED', btrim(p_operator_label),
          jsonb_build_object('is_open', p_open, 'evidence_ref', btrim(p_evidence_ref), 'seq', v_seq), btrim(p_reason));
  RETURN v_seq;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. Commandes d'administration de l'inventaire (administrateur unique)
-- --------------------------------------------------------------------------
CREATE FUNCTION public.treasury_admin_add_expected_account_v1(
  p_command_key text, p_registry_account_id uuid, p_bank text, p_currency text, p_safe_alias text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := treasury_private.require_admin();
  v_bank text := upper(btrim(coalesce(p_bank, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_alias text := nullif(btrim(coalesce(p_safe_alias, '')), '');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_prior jsonb;
  v_reg public.daily_statement_account_registry%ROWTYPE;
  v_id uuid;
  v_result jsonb;
BEGIN
  v_prior := treasury_private.command_begin(v_actor, 'ADD_EXPECTED_ACCOUNT', p_command_key,
    jsonb_build_object('registry', p_registry_account_id, 'bank', v_bank, 'currency', v_currency,
                       'alias', v_alias, 'reason', v_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := treasury_private.require_reason(v_reason);

  IF p_registry_account_id IS NOT NULL THEN
    SELECT * INTO v_reg FROM public.daily_statement_account_registry r WHERE r.id = p_registry_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_REGISTRY_ACCOUNT_UNKNOWN';
    END IF;
    IF v_reg.status <> 'active' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_REGISTRY_ACCOUNT_INACTIVE';
    END IF;
    IF (v_bank <> '' AND v_bank <> v_reg.bank) OR (v_currency <> '' AND v_currency <> v_reg.currency) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_BANK_MISMATCH';
    END IF;
    IF v_alias IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_ALIAS_NOT_ALLOWED';
    END IF;
    IF EXISTS (SELECT 1 FROM treasury_private.expected_accounts e
               WHERE e.status = 'ACTIVE' AND e.registry_account_id = p_registry_account_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'TREASURY_REGISTRY_ACCOUNT_ALREADY_EXPECTED';
    END IF;
    INSERT INTO treasury_private.expected_accounts (bank, currency, registry_account_id, created_by, created_reason)
    VALUES (v_reg.bank, v_reg.currency, v_reg.id, v_actor, v_reason)
    RETURNING id INTO v_id;
  ELSE
    IF v_bank NOT IN ('BDK', 'ORA', 'ATB', 'BICIS', 'BIS', 'BRIDGE', 'NSIA') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_BANK_UNSUPPORTED';
    END IF;
    IF v_currency !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_CURRENCY_INVALID';
    END IF;
    IF v_alias IS NULL OR char_length(v_alias) > 80 OR v_alias ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_ALIAS_INVALID';
    END IF;
    -- Un compte déjà présent au registre se rattache : aucun second compte.
    IF EXISTS (SELECT 1 FROM public.daily_statement_account_registry r
               WHERE r.status = 'active' AND r.bank = v_bank AND r.currency = v_currency
                 AND lower(btrim(r.safe_alias)) = lower(v_alias)) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'TREASURY_REGISTRY_ACCOUNT_EXISTS_LINK_INSTEAD';
    END IF;
    IF EXISTS (SELECT 1 FROM treasury_private.expected_accounts e
               WHERE e.status = 'ACTIVE' AND e.registry_account_id IS NULL AND e.bank = v_bank
                 AND e.currency = v_currency AND lower(btrim(e.safe_alias)) = lower(v_alias)) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'TREASURY_EXPECTED_ACCOUNT_DUPLICATE';
    END IF;
    INSERT INTO treasury_private.expected_accounts (bank, currency, safe_alias, created_by, created_reason)
    VALUES (v_bank, v_currency, v_alias, v_actor, v_reason)
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO treasury_private.events (event_type, actor_id, payload, reason)
  VALUES ('EXPECTED_ACCOUNT_ADDED', v_actor,
          jsonb_build_object('expected_account_id', v_id, 'registry_account_id', p_registry_account_id), v_reason);
  v_result := jsonb_build_object('expected_account_id', v_id,
                                 'inventory_fingerprint', treasury_private.inventory_fingerprint());
  RETURN treasury_private.command_finish(p_command_key, v_result);
END;
$$;

CREATE FUNCTION public.treasury_admin_link_expected_account_v1(
  p_command_key text, p_expected_account_id uuid, p_registry_account_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := treasury_private.require_admin();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_prior jsonb;
  v_exp treasury_private.expected_accounts%ROWTYPE;
  v_reg public.daily_statement_account_registry%ROWTYPE;
  v_result jsonb;
BEGIN
  v_prior := treasury_private.command_begin(v_actor, 'LINK_EXPECTED_ACCOUNT', p_command_key,
    jsonb_build_object('expected', p_expected_account_id, 'registry', p_registry_account_id, 'reason', v_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := treasury_private.require_reason(v_reason);

  SELECT * INTO v_exp FROM treasury_private.expected_accounts e WHERE e.id = p_expected_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_EXPECTED_ACCOUNT_UNKNOWN';
  END IF;
  IF v_exp.status <> 'ACTIVE' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_EXPECTED_ACCOUNT_RETIRED';
  END IF;
  IF v_exp.registry_account_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_EXPECTED_ACCOUNT_ALREADY_LINKED';
  END IF;
  SELECT * INTO v_reg FROM public.daily_statement_account_registry r WHERE r.id = p_registry_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_REGISTRY_ACCOUNT_UNKNOWN';
  END IF;
  IF v_reg.status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_REGISTRY_ACCOUNT_INACTIVE';
  END IF;
  IF v_reg.bank <> v_exp.bank OR v_reg.currency <> v_exp.currency THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_BANK_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM treasury_private.expected_accounts e
             WHERE e.status = 'ACTIVE' AND e.registry_account_id = p_registry_account_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'TREASURY_REGISTRY_ACCOUNT_ALREADY_EXPECTED';
  END IF;

  UPDATE treasury_private.expected_accounts
     SET registry_account_id = p_registry_account_id, linked_at = statement_timestamp(), linked_by = v_actor
   WHERE id = p_expected_account_id;
  INSERT INTO treasury_private.events (event_type, actor_id, payload, reason)
  VALUES ('EXPECTED_ACCOUNT_LINKED', v_actor,
          jsonb_build_object('expected_account_id', p_expected_account_id, 'registry_account_id', p_registry_account_id),
          v_reason);
  v_result := jsonb_build_object('expected_account_id', p_expected_account_id,
                                 'inventory_fingerprint', treasury_private.inventory_fingerprint());
  RETURN treasury_private.command_finish(p_command_key, v_result);
END;
$$;

CREATE FUNCTION public.treasury_admin_retire_expected_account_v1(
  p_command_key text, p_expected_account_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := treasury_private.require_admin();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_prior jsonb;
  v_exp treasury_private.expected_accounts%ROWTYPE;
  v_result jsonb;
BEGIN
  v_prior := treasury_private.command_begin(v_actor, 'RETIRE_EXPECTED_ACCOUNT', p_command_key,
    jsonb_build_object('expected', p_expected_account_id, 'reason', v_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := treasury_private.require_reason(v_reason);

  SELECT * INTO v_exp FROM treasury_private.expected_accounts e WHERE e.id = p_expected_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_EXPECTED_ACCOUNT_UNKNOWN';
  END IF;
  IF v_exp.status <> 'ACTIVE' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_EXPECTED_ACCOUNT_RETIRED';
  END IF;
  UPDATE treasury_private.expected_accounts
     SET status = 'RETIRED', retired_at = statement_timestamp(), retired_by = v_actor, retired_reason = v_reason
   WHERE id = p_expected_account_id;
  INSERT INTO treasury_private.events (event_type, actor_id, payload, reason)
  VALUES ('EXPECTED_ACCOUNT_RETIRED', v_actor, jsonb_build_object('expected_account_id', p_expected_account_id), v_reason);
  v_result := jsonb_build_object('expected_account_id', p_expected_account_id,
                                 'inventory_fingerprint', treasury_private.inventory_fingerprint());
  RETURN treasury_private.command_finish(p_command_key, v_result);
END;
$$;

CREATE FUNCTION public.treasury_admin_attest_inventory_v1(
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
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TREASURY_INVENTORY_CHANGED';
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

-- --------------------------------------------------------------------------
-- 7. Lecture : soldes à une date comptable D, en UNE instruction
-- --------------------------------------------------------------------------
-- Fonction SQL STABLE : une seule instruction SELECT, exécutée avec l'instantané
-- de la requête appelante. Le mécanisme est démontré par le test de course
-- `supabase/tests/treasury_v1_lot1` (un import validé après le début de la
-- lecture n'est jamais vu, même partiellement).
CREATE FUNCTION treasury_private.balances_snapshot(p_as_of date, p_today date)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
WITH
params AS (
  SELECT p_as_of AS d, p_today AS t, statement_timestamp() AS read_at
),
qual AS (
  SELECT DISTINCT ON (q.bank, q.source_format) q.bank, q.source_format, q.status, q.evidence_ref, q.decided_at
  FROM treasury_private.bank_format_qualifications q
  ORDER BY q.bank, q.source_format, q.seq DESC
),
inv AS (
  SELECT e.id AS expected_id, e.bank, e.currency, e.registry_account_id AS rid, e.safe_alias,
         r.safe_alias AS registry_alias, r.status AS registry_status, r.bank AS registry_bank,
         r.currency AS registry_currency
  FROM treasury_private.expected_accounts e
  LEFT JOIN public.daily_statement_account_registry r ON r.id = e.registry_account_id
  WHERE e.status = 'ACTIVE'
),
acc AS (
  SELECT DISTINCT inv.rid FROM inv WHERE inv.rid IS NOT NULL
),
units AS (
  SELECT u.id AS unit_id, u.account_registry_id AS rid, u.accounting_date AS day,
         u.opening_balance_derived AS opening, u.closing_balance_derived AS closing,
         u.aggregates_status, u.currency AS unit_currency, u.ingested_at,
         a.created_at AS export_ingested_at, a.source_format,
         -- Version de parseur prise en charge pour la banque et le format.
         EXISTS (SELECT 1 FROM treasury_private.supported_formats f
                 WHERE f.bank = a.bank AND f.source_format = a.source_format AND a.parser_version IS NOT NULL
                   AND left(a.parser_version, char_length(f.parser_version_prefix)) = f.parser_version_prefix)
           AS format_supported,
         -- Ni l'unité ni son export ne sont à revoir (identité de compte comprise).
         (u.validation_status = 'valid' AND a.parser_validation_status = 'valid'
          AND cardinality(u.review_reason_codes) = 0 AND cardinality(a.review_reason_codes) = 0) AS unit_clean,
         -- Journée close, preuve (a) : ce contenu exact a été livré par un fichier qui
         -- porte aussi une ligne datée APRÈS la journée, et au plus tard le jour de
         -- son dépôt (heure de Dakar) : le fichier a été produit la journée finie.
         -- Ni l'instant de dépôt ni la date de référence saisie ne le prouvent.
         EXISTS (SELECT 1 FROM public.daily_statement_units_staging s2
                 JOIN public.daily_statement_export_attempts a2 ON a2.id = s2.attempt_id
                 WHERE s2.day_unit_id = u.day_unit_id AND s2.day_content_hash = u.active_day_content_hash
                   AND s2.status IN ('promoted', 'duplicate')
                   AND EXISTS (SELECT 1 FROM public.daily_statement_units_staging s3
                               WHERE s3.attempt_id = s2.attempt_id AND s3.accounting_date > u.accounting_date
                                 AND s3.accounting_date <= (a2.created_at AT TIME ZONE 'Africa/Dakar')::date))
           AS closed_by_later_line
  FROM public.daily_statement_units_canonical u
  JOIN acc ON acc.rid = u.account_registry_id
  JOIN public.daily_statement_units_staging s ON s.id = u.promoted_from_staging_unit_id
  JOIN public.daily_statement_export_attempts a ON a.id = s.attempt_id
  WHERE u.status = 'ingested'
),
-- Toutes les versions de staging d'une journée : provisoire, en attente, en conflit.
staged_days AS (
  SELECT s.account_registry_id AS rid, s.accounting_date AS day,
         bool_or(s.status = 'provisional') AS has_provisional,
         bool_or(s.status = 'conflict') AS has_conflict,
         bool_or(s.status IN ('staged', 'needs_review', 'promotion_failed', 'provisional')) AS has_pending,
         bool_or(s.status <> 'superseded') AS has_live
  FROM public.daily_statement_units_staging s
  JOIN acc ON acc.rid = s.account_registry_id
  GROUP BY s.account_registry_id, s.accounting_date
),
-- Ouvertures connues d'une journée : unité canonique, quelle que soit sa nature,
-- et versions livrées non retenues (provisoire, en attente, à revoir, en échec,
-- en conflit).
day_openings AS (
  SELECT u.rid, u.day, u.opening FROM units u WHERE u.opening IS NOT NULL
  UNION
  SELECT s.account_registry_id, s.accounting_date, s.opening_balance_derived
  FROM public.daily_statement_units_staging s
  JOIN acc ON acc.rid = s.account_registry_id
  WHERE s.status IN ('provisional', 'staged', 'needs_review', 'promotion_failed', 'conflict')
    AND s.opening_balance_derived IS NOT NULL
),
-- Exports à période DÉCLARÉE, valides, sans motif de revue et entièrement
-- acceptés : seules preuves d'une journée sans mouvement. Une journée n'y est
-- close que si le fichier porte une ligne datée APRÈS elle (et au plus tard le
-- jour de son dépôt) ; rien sans ligne. La date de référence saisie ne prouve rien.
proof_exports AS (
  SELECT a.account_registry_id AS rid, a.id AS export_id, a.created_at AS export_ingested_at,
         a.export_period_start AS p_start, a.export_period_end AS p_end,
         least(a.export_period_end, coalesce(eu.last_line_day, a.export_period_start) - 1) AS closed_until
  FROM public.daily_statement_export_attempts a
  JOIN acc ON acc.rid = a.account_registry_id
  JOIN treasury_private.supported_formats f
    ON f.bank = a.bank AND f.source_format = a.source_format AND f.period_provenance = 'DECLARED'
   AND a.parser_version IS NOT NULL
   AND left(a.parser_version, char_length(f.parser_version_prefix)) = f.parser_version_prefix
  JOIN LATERAL (
    SELECT count(*) FILTER (WHERE s.status NOT IN ('promoted', 'duplicate', 'provisional', 'superseded')
                              OR s.validation_status <> 'valid' OR cardinality(s.review_reason_codes) > 0) AS bad_n,
           max(s.accounting_date) FILTER (WHERE s.accounting_date <= (a.created_at AT TIME ZONE 'Africa/Dakar')::date)
             AS last_line_day
    FROM public.daily_statement_units_staging s
    WHERE s.attempt_id = a.id
  ) eu ON true
  WHERE a.parser_validation_status = 'valid'
    AND cardinality(a.review_reason_codes) = 0
    AND eu.bad_n = 0
),
bounds AS (
  SELECT acc.rid,
         (SELECT min(u.day) FROM units u WHERE u.rid = acc.rid) AS first_unit,
         (SELECT max(u.day) FROM units u WHERE u.rid = acc.rid) AS last_unit,
         (SELECT min(pe.p_start) FROM proof_exports pe WHERE pe.rid = acc.rid AND pe.closed_until >= pe.p_start) AS first_proof,
         (SELECT max(pe.closed_until) FROM proof_exports pe WHERE pe.rid = acc.rid) AS last_proof,
         (SELECT max(sd.day) FROM staged_days sd WHERE sd.rid = acc.rid) AS last_staged
  FROM acc
),
series AS (
  SELECT b.rid, g::date AS day
  FROM bounds b
  CROSS JOIN params p
  CROSS JOIN LATERAL generate_series(
    least(b.first_unit, coalesce(b.first_proof, b.first_unit)),
    least(p.t, greatest(p.d, b.last_unit, coalesce(b.last_proof, b.last_unit), coalesce(b.last_staged, b.last_unit))),
    interval '1 day') g
  WHERE b.first_unit IS NOT NULL
),
-- Nature de chaque journée, avant la preuve de clôture des unités retenues.
base AS (
  SELECT s.rid, s.day, u.unit_id, u.opening, u.closing, u.unit_currency, u.ingested_at, u.export_ingested_at,
         u.source_format, u.closed_by_later_line,
         CASE
           -- Journée disputée par une autre version : contenu divergent ou en attente.
           WHEN u.unit_id IS NOT NULL AND sd.has_conflict THEN 'CONFLICT'
           WHEN u.unit_id IS NOT NULL AND sd.has_pending THEN 'CONTESTED'
           WHEN u.unit_id IS NOT NULL AND NOT u.format_supported THEN 'UNIT_UNSUPPORTED'
           WHEN u.unit_id IS NOT NULL AND NOT u.unit_clean THEN 'UNIT_REVIEW'
           WHEN u.unit_id IS NOT NULL AND u.aggregates_status = 'derived' THEN 'UNIT_OK'
           WHEN u.unit_id IS NOT NULL THEN 'UNIT_NO_BALANCE'
           -- Une journée encore provisoire n'est jamais déclarée sans mouvement.
           WHEN sd.has_provisional THEN 'PROVISIONAL'
           -- Des mouvements livrés mais non retenus interdisent l'absence de mouvement.
           WHEN sd.has_live THEN 'CONTESTED'
           WHEN EXISTS (SELECT 1 FROM proof_exports pe
                        WHERE pe.rid = s.rid AND s.day BETWEEN pe.p_start AND pe.closed_until) THEN 'NOMOV'
           ELSE 'UNPROVEN'
         END AS base_kind
  FROM series s
  LEFT JOIN units u ON u.rid = s.rid AND u.day = s.day
  LEFT JOIN staged_days sd ON sd.rid = s.rid AND sd.day = s.day
),
-- Journée close, preuve (b) : la journée suivante qui n'est pas « sans
-- mouvement » est une unité retenue dont l'ouverture égale la clôture.
next_heads AS (
  SELECT b.rid, b.day,
         lead(b.base_kind) OVER (PARTITION BY b.rid ORDER BY b.day) AS next_kind,
         lead(b.opening) OVER (PARTITION BY b.rid ORDER BY b.day) AS next_opening
  FROM base b WHERE b.base_kind <> 'NOMOV'
),
days AS (
  SELECT b.rid, b.day, b.unit_id, b.opening, b.closing, b.unit_currency, b.ingested_at, b.export_ingested_at,
         b.source_format,
         CASE WHEN b.base_kind <> 'UNIT_OK' THEN b.base_kind
              WHEN b.closed_by_later_line THEN 'UNIT'
              WHEN n.next_kind = 'UNIT_OK' AND n.next_opening = b.closing THEN 'UNIT'
              ELSE 'NOT_CLOSED'
         END AS kind
  FROM base b
  LEFT JOIN next_heads n ON n.rid = b.rid AND n.day = b.day
),
grouped AS (
  SELECT d.*,
         count(*) FILTER (WHERE d.kind <> 'NOMOV')
           OVER (PARTITION BY d.rid ORDER BY d.day ROWS UNBOUNDED PRECEDING) AS grp_f,
         count(*) FILTER (WHERE d.kind <> 'NOMOV')
           OVER (PARTITION BY d.rid ORDER BY d.day DESC ROWS UNBOUNDED PRECEDING) AS grp_b,
         -- Toute unité canonique dont la clôture est connue, quelle que soit sa nature.
         count(*) FILTER (WHERE d.unit_id IS NOT NULL AND d.closing IS NOT NULL)
           OVER (PARTITION BY d.rid ORDER BY d.day ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS units_before
  FROM days d
),
heads AS (
  SELECT g.rid, g.grp_f, g.grp_b, g.kind, g.day, g.opening, g.closing, g.ingested_at, g.export_ingested_at,
         g.source_format
  FROM grouped g WHERE g.kind <> 'NOMOV'
),
unit_rank AS (
  SELECT g.rid, g.closing, row_number() OVER (PARTITION BY g.rid ORDER BY g.day) AS n
  FROM grouped g WHERE g.unit_id IS NOT NULL AND g.closing IS NOT NULL
),
-- Solde de fin de journée prouvé : unité close de la journée, ou report à travers
-- des journées sans mouvement PROUVÉES, depuis la clôture de l'unité close
-- précédente ou, à défaut, l'ouverture (toujours connue) de l'unité suivante.
bal AS (
  SELECT g.*,
         CASE WHEN g.kind = 'UNIT' THEN g.closing
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.closing
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.opening
         END AS balance_end,
         CASE WHEN g.kind = 'UNIT' THEN g.day
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.day
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.day
         END AS source_day,
         CASE WHEN g.kind = 'UNIT' THEN g.source_format
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.source_format
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.source_format
         END AS source_format_used,
         CASE WHEN g.kind = 'UNIT' THEN g.ingested_at
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.ingested_at
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.ingested_at
         END AS source_unit_ingested_at,
         CASE WHEN g.kind = 'UNIT' THEN g.export_ingested_at
              WHEN g.kind = 'NOMOV' AND hf.kind = 'UNIT' THEN hf.export_ingested_at
              WHEN g.kind = 'NOMOV' AND hb.kind IN ('UNIT', 'NOT_CLOSED') THEN hb.export_ingested_at
         END AS source_export_ingested_at
  FROM grouped g
  LEFT JOIN heads hf ON g.kind = 'NOMOV' AND hf.rid = g.rid AND hf.grp_f = g.grp_f
  LEFT JOIN heads hb ON g.kind = 'NOMOV' AND hb.rid = g.rid AND hb.grp_b = g.grp_b
),
chain AS (
  SELECT b.*,
         lag(b.day) OVER (PARTITION BY b.rid ORDER BY b.day) AS prev_day,
         lag(b.balance_end) OVER (PARTITION BY b.rid ORDER BY b.day) AS prev_balance,
         ur.closing AS prev_unit_closing
  FROM bal b
  LEFT JOIN unit_rank ur ON ur.rid = b.rid AND ur.n = b.units_before
),
transitions AS (
  SELECT c.*,
         -- Contrôle de l'ouverture d'une unité close, ou d'une journée non close
         -- dont l'ouverture est connue : toute contradiction compte.
         CASE WHEN c.kind NOT IN ('UNIT', 'NOT_CLOSED') OR c.opening IS NULL THEN NULL
              WHEN c.prev_day = c.day - 1 AND c.prev_balance IS NOT NULL
                THEN CASE WHEN c.opening = c.prev_balance THEN 'OK' ELSE 'BREAK' END
              WHEN c.prev_unit_closing IS NULL THEN 'ANCHOR'
              WHEN c.opening = c.prev_unit_closing THEN 'CONTINUOUS_GAP'
              ELSE 'UNPROVEN'
         END AS transition
  FROM chain c
),
per_rid AS (
  SELECT acc.rid,
         (SELECT t.kind FROM transitions t, params p WHERE t.rid = acc.rid AND t.day = p.d) AS kind_d,
         (SELECT t.balance_end FROM transitions t, params p WHERE t.rid = acc.rid AND t.day = p.d) AS balance_d,
         (SELECT t.source_day FROM transitions t, params p WHERE t.rid = acc.rid AND t.day = p.d) AS source_day_d,
         (SELECT t.source_format_used FROM transitions t, params p WHERE t.rid = acc.rid AND t.day = p.d) AS source_format_d,
         (SELECT t.source_unit_ingested_at FROM transitions t, params p WHERE t.rid = acc.rid AND t.day = p.d) AS unit_ingested_d,
         (SELECT t.source_export_ingested_at FROM transitions t, params p WHERE t.rid = acc.rid AND t.day = p.d) AS export_ingested_d,
         EXISTS (SELECT 1 FROM transitions t, params p WHERE t.rid = acc.rid AND t.day <= p.d AND t.transition = 'BREAK') AS has_break,
         EXISTS (SELECT 1 FROM transitions t, params p WHERE t.rid = acc.rid AND t.day <= p.d AND t.transition = 'UNPROVEN') AS has_unproven,
         -- Première journée après D dont une ouverture est connue.
         (SELECT min(o.day) FROM day_openings o, params p WHERE o.rid = acc.rid AND o.day > p.d) AS next_open_day,
         -- D appartient à l'historique du compte : premier relevé, ou période déclarée qui le précède.
         EXISTS (SELECT 1 FROM transitions t, params p WHERE t.rid = acc.rid AND t.day = p.d) AS has_statement,
         (SELECT array_agg(DISTINCT u.unit_currency) FROM units u, params p WHERE u.rid = acc.rid AND u.day <= p.d) AS unit_currencies,
         (SELECT u.source_format FROM units u, params p WHERE u.rid = acc.rid AND u.day <= p.d ORDER BY u.day DESC LIMIT 1) AS last_format,
         (SELECT max(t.day) FROM transitions t, params p WHERE t.rid = acc.rid AND t.day <= p.t AND t.balance_end IS NOT NULL) AS covered_through,
         (SELECT jsonb_build_object('balance', t.balance_end::text, 'date', t.day)
            FROM transitions t, params p
           WHERE t.rid = acc.rid AND t.day < p.d AND t.balance_end IS NOT NULL
           ORDER BY t.day DESC LIMIT 1) AS last_known_before
  FROM acc
),
-- Le solde de D (report compris) est confronté à TOUTE ouverture connue de la
-- première journée suivante qui en porte une, même postérieure à D.
after_d AS (
  SELECT pr.rid,
         pr.balance_d IS NOT NULL AND EXISTS (SELECT 1 FROM day_openings o
           WHERE o.rid = pr.rid AND o.day = pr.next_open_day AND o.opening <> pr.balance_d) AS next_mismatch,
         NOT EXISTS (SELECT 1 FROM transitions t, params p
           WHERE t.rid = pr.rid AND t.day > p.d AND t.day < pr.next_open_day AND t.kind <> 'NOMOV') AS only_nomov_between,
         NOT EXISTS (SELECT 1 FROM transitions t, params p
           WHERE t.rid = pr.rid AND t.day > p.d AND t.day < pr.next_open_day AND t.kind NOT IN ('NOMOV', 'UNPROVEN'))
           AS no_lines_between
  FROM per_rid pr
),
value_dates AS (
  SELECT u.rid, count(l.id) AS total_lines, count(l.id) FILTER (WHERE l.value_date IS NOT NULL) AS lines_with_value_date
  FROM units u
  CROSS JOIN params p
  JOIN public.daily_statement_lines_canonical l ON l.canonical_unit_id = u.unit_id AND l.is_active
  WHERE u.day BETWEEN p.d - 89 AND p.d
  GROUP BY u.rid
),
per_account AS (
  SELECT i.*,
         pr.kind_d, pr.balance_d, pr.source_day_d, pr.source_format_d, pr.unit_ingested_d, pr.export_ingested_d,
         pr.has_break, pr.has_unproven, pr.has_statement, pr.unit_currencies, pr.last_format,
         pr.covered_through, pr.last_known_before,
         q.status AS qualification_status, q.evidence_ref AS qualification_evidence,
         array_remove(ARRAY[
           CASE WHEN i.currency <> 'XOF' THEN 'CURRENCY_OUT_OF_SCOPE' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NULL AND i.bank = 'NSIA' THEN 'BANK_WITHOUT_FORMAT' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NULL AND i.bank <> 'NSIA' THEN 'ACCOUNT_NOT_REGISTERED' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND i.registry_status <> 'active' THEN 'REGISTRY_ACCOUNT_INACTIVE' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL
                 AND (i.registry_currency <> i.currency
                      OR EXISTS (SELECT 1 FROM unnest(coalesce(pr.unit_currencies, ARRAY[]::text[])) c WHERE c <> i.currency))
                THEN 'CURRENCY_CONTRADICTION' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND pr.has_break THEN 'CHAIN_BROKEN' END,
           -- Ouverture suivante différente à travers des journées prouvées sans mouvement : contradiction.
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND ad.next_mismatch AND ad.only_nomov_between
                THEN 'CHAIN_BROKEN_AFTER_DATE' END,
           -- À travers des journées non prouvées mais sans ligne livrée : écart inexpliqué.
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND ad.next_mismatch AND NOT ad.only_nomov_between
                     AND ad.no_lines_between
                THEN 'CHAIN_UNPROVEN_AFTER_DATE' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND pr.has_unproven THEN 'CHAIN_UNPROVEN' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND NOT coalesce(pr.has_statement, false) THEN 'NO_STATEMENT' END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND coalesce(pr.has_statement, false) THEN
             CASE pr.kind_d
               WHEN 'PROVISIONAL' THEN 'PROVISIONAL_DAY'
               WHEN 'UNPROVEN' THEN 'DAY_WITHOUT_PROOF'
               WHEN 'UNIT_NO_BALANCE' THEN 'BALANCE_NOT_DERIVED'
               WHEN 'UNIT_REVIEW' THEN 'UNIT_NEEDS_REVIEW'
               WHEN 'CONFLICT' THEN 'DAY_CONFLICT'
               WHEN 'CONTESTED' THEN 'DAY_CONTESTED'
               WHEN 'UNIT_UNSUPPORTED' THEN 'PARSER_VERSION_UNSUPPORTED'
               WHEN 'NOT_CLOSED' THEN 'DAY_NOT_CLOSED'
               WHEN 'NOMOV' THEN CASE WHEN pr.balance_d IS NULL THEN 'BALANCE_UNKNOWN_AT_DATE' END
               WHEN 'UNIT' THEN NULL
               ELSE 'DAY_WITHOUT_PROOF'
             END END,
           CASE WHEN i.currency = 'XOF' AND i.rid IS NOT NULL AND coalesce(pr.has_statement, false) THEN
             CASE coalesce(q.status, 'NOT_QUALIFIED')
               WHEN 'QUALIFIED' THEN NULL
               WHEN 'PILOT' THEN 'FORMAT_PILOT'
               WHEN 'SUSPENDED' THEN 'FORMAT_SUSPENDED'
               ELSE 'FORMAT_NOT_QUALIFIED'
             END END
         ], NULL) AS reasons,
         vd.total_lines, vd.lines_with_value_date
  FROM inv i
  LEFT JOIN per_rid pr ON pr.rid = i.rid
  LEFT JOIN after_d ad ON ad.rid = i.rid
  LEFT JOIN qual q ON q.bank = i.bank AND q.source_format = coalesce(pr.source_format_d, pr.last_format)
  LEFT JOIN value_dates vd ON vd.rid = i.rid
),
classified AS (
  SELECT pa.*,
         CASE WHEN 'CURRENCY_OUT_OF_SCOPE' = ANY (pa.reasons) THEN 'OUT_OF_SCOPE'
              WHEN pa.reasons && ARRAY['CURRENCY_CONTRADICTION', 'CHAIN_BROKEN', 'CHAIN_BROKEN_AFTER_DATE', 'DAY_CONFLICT']
                THEN 'BLOCKED'
              WHEN cardinality(pa.reasons) > 0 THEN 'NOT_COVERED'
              WHEN pa.balance_d IS NULL THEN 'NOT_COVERED'
              ELSE 'AVAILABLE'
         END AS status
  FROM per_account pa
),
attest AS (
  SELECT a.inventory_fingerprint, a.attested_at, a.accounts_count
  FROM treasury_private.inventory_attestations a ORDER BY a.seq DESC LIMIT 1
),
unlisted AS (
  SELECT r.id, r.bank, r.currency, r.safe_alias
  FROM public.daily_statement_account_registry r
  WHERE r.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM treasury_private.expected_accounts e
                    WHERE e.status = 'ACTIVE' AND e.registry_account_id = r.id)
),
cons AS (
  SELECT count(*) FILTER (WHERE c.currency = 'XOF') AS expected_n,
         count(*) FILTER (WHERE c.currency = 'XOF' AND c.status = 'AVAILABLE') AS available_n,
         count(*) FILTER (WHERE c.currency = 'XOF' AND c.status = 'NOT_COVERED') AS not_covered_n,
         count(*) FILTER (WHERE c.currency = 'XOF' AND c.status = 'BLOCKED') AS blocked_n,
         count(*) FILTER (WHERE c.status = 'OUT_OF_SCOPE') AS out_of_scope_n,
         sum(c.balance_d) FILTER (WHERE c.currency = 'XOF' AND c.status = 'AVAILABLE') AS subtotal
  FROM classified c
),
inventory_state AS (
  SELECT treasury_private.inventory_fingerprint() AS fingerprint,
         (SELECT count(*) FROM treasury_private.expected_accounts e WHERE e.status = 'ACTIVE') AS active_n,
         (SELECT a.inventory_fingerprint FROM attest a) AS attested_fingerprint,
         (SELECT a.attested_at FROM attest a) AS attested_at,
         (SELECT count(*) FROM unlisted u WHERE u.currency = 'XOF'
            AND u.bank IN ('BDK', 'ORA', 'ATB', 'BICIS', 'BIS', 'BRIDGE')) AS unlisted_xof_n
)
SELECT jsonb_build_object(
  'contract', 'treasury_balances_at_v1',
  'as_of', p.d,
  'today', p.t,
  'read_at', p.read_at,
  'timezone', 'Africa/Dakar',
  'basis', 'ACCOUNTING_DATE',
  'value_date_window_days', 90,
  'inventory', jsonb_build_object(
    'fingerprint', s.fingerprint,
    'active_accounts', s.active_n,
    'attested', s.attested_fingerprint IS NOT NULL AND s.attested_fingerprint = s.fingerprint AND s.active_n > 0,
    'attested_at', s.attested_at,
    'unlisted_registry_accounts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('registry_account_id', u.id, 'bank', u.bank, 'currency', u.currency,
                                          'alias', u.safe_alias) ORDER BY u.bank, u.safe_alias, u.id)
      FROM unlisted u), '[]'::jsonb)),
  'accounts', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'expected_account_id', c.expected_id,
      'registry_account_id', c.rid,
      'bank', c.bank,
      'currency', c.currency,
      'alias', coalesce(c.registry_alias, c.safe_alias),
      'status', c.status,
      'reasons', to_jsonb(c.reasons),
      'balance_at_date', CASE WHEN c.status = 'AVAILABLE' THEN c.balance_d::text END,
      'observed_balance', CASE WHEN c.status <> 'AVAILABLE' AND c.balance_d IS NOT NULL
                               THEN jsonb_build_object('balance', c.balance_d::text, 'date', p.d)
                               WHEN c.status <> 'AVAILABLE' THEN c.last_known_before END,
      'source_format', coalesce(c.source_format_d, c.last_format),
      'qualification', coalesce(c.qualification_status, CASE WHEN c.bank = 'NSIA' THEN 'NO_FORMAT' ELSE 'NOT_QUALIFIED' END),
      'qualification_evidence', c.qualification_evidence,
      'dates', jsonb_build_object(
        'bank_date_covered', c.covered_through,
        'age_days', CASE WHEN c.covered_through IS NOT NULL THEN p.t - c.covered_through END,
        'balance_source_day', c.source_day_d),
      'sources', CASE WHEN c.balance_d IS NULL THEN '[]'::jsonb ELSE
        jsonb_build_array(jsonb_build_object(
          'kind', 'CANONICAL_UNIT', 'day', c.source_day_d, 'ingested_at', c.unit_ingested_d,
          'export_ingested_at', c.export_ingested_d, 'source_format', c.source_format_d))
        || coalesce((
          SELECT jsonb_agg(jsonb_build_object(
                   'kind', 'DECLARED_PERIOD', 'period_start', pe.p_start, 'period_end', pe.p_end,
                   'closed_until', pe.closed_until, 'export_ingested_at', pe.export_ingested_at)
                 ORDER BY pe.p_start, pe.export_ingested_at)
          FROM proof_exports pe
          WHERE pe.rid = c.rid AND c.source_day_d <> p.d
            AND pe.p_start <= greatest(c.source_day_d, p.d) AND pe.closed_until >= least(c.source_day_d, p.d)), '[]'::jsonb)
      END,
      'value_dates', jsonb_build_object('total_lines', coalesce(c.total_lines, 0),
                                        'lines_with_value_date', coalesce(c.lines_with_value_date, 0)))
      ORDER BY c.bank, coalesce(c.registry_alias, c.safe_alias), c.expected_id)
    FROM classified c), '[]'::jsonb),
  'consolidation', jsonb_build_object(
    'currency', 'XOF',
    'status', CASE WHEN k.blocked_n > 0 THEN 'BLOCKED'
                   WHEN k.expected_n > 0 AND k.available_n = k.expected_n AND s.unlisted_xof_n = 0
                        AND s.attested_fingerprint IS NOT NULL AND s.attested_fingerprint = s.fingerprint THEN 'COMPLETE'
                   ELSE 'PARTIAL' END,
    'amount', k.subtotal::text,
    'accounts_expected', k.expected_n,
    'accounts_available', k.available_n,
    'accounts_not_covered', k.not_covered_n,
    'accounts_blocked', k.blocked_n,
    'accounts_out_of_scope', k.out_of_scope_n,
    'registry_accounts_outside_inventory', s.unlisted_xof_n,
    'reasons', to_jsonb(array_remove(ARRAY[
      CASE WHEN s.active_n = 0 THEN 'INVENTORY_EMPTY' END,
      CASE WHEN s.attested_fingerprint IS NULL OR s.attested_fingerprint <> s.fingerprint THEN 'INVENTORY_NOT_ATTESTED' END,
      CASE WHEN s.unlisted_xof_n > 0 THEN 'REGISTRY_ACCOUNTS_OUTSIDE_INVENTORY' END,
      CASE WHEN k.not_covered_n > 0 THEN 'ACCOUNTS_NOT_COVERED' END,
      CASE WHEN k.blocked_n > 0 THEN 'ACCOUNTS_BLOCKED' END], NULL)))
)
FROM params p CROSS JOIN inventory_state s CROSS JOIN cons k
$$;

CREATE FUNCTION public.treasury_balances_at_v1(p_as_of date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := treasury_private.require_actor();
  v_today date := treasury_private.today();
BEGIN
  PERFORM treasury_private.require_module_open();
  -- Mécanisme existant, inchangé : READ ou AUDIT, puis BANK_READ.
  PERFORM payables_private.require_bank_read(v_actor);
  IF p_as_of IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_AS_OF_REQUIRED';
  END IF;
  IF p_as_of > v_today THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TREASURY_FUTURE_DATE_FORBIDDEN';
  END IF;
  RETURN treasury_private.balances_snapshot(p_as_of, v_today);
END;
$$;

-- --------------------------------------------------------------------------
-- 8. Privilèges minimaux
-- --------------------------------------------------------------------------
-- Défense en profondeur : RLS active sans aucune politique (seules les
-- fonctions du lot, propriétaires des tables, y accèdent).
ALTER TABLE treasury_private.supported_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_private.bank_format_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_private.module_switch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_private.expected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_private.inventory_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_private.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_private.commands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA treasury_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA treasury_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA treasury_private FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.treasury_balances_at_v1(date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.treasury_admin_add_expected_account_v1(text, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.treasury_admin_link_expected_account_v1(text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.treasury_admin_retire_expected_account_v1(text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.treasury_admin_attest_inventory_v1(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.treasury_balances_at_v1(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.treasury_admin_add_expected_account_v1(text, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.treasury_admin_link_expected_account_v1(text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.treasury_admin_retire_expected_account_v1(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.treasury_admin_attest_inventory_v1(text, text, text) TO authenticated;

COMMENT ON SCHEMA treasury_private IS
  'Trésorerie V1, Lot 1 : inventaire des comptes attendus, qualification par banque et format, lecture des soldes à date. Aucun accès direct.';
COMMENT ON FUNCTION public.treasury_balances_at_v1(date) IS
  'Soldes bancaires à une date comptable D (couche solde seule) ; READ/AUDIT + BANK_READ ; une seule instruction, instantané de l''appelant.';

COMMIT;
