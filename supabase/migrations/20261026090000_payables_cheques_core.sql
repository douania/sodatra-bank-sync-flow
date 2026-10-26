-- ============================================================================
-- PAYABLES-CHEQUES-CORE — factures, engagements et chèques émis (domaine natif)
-- ============================================================================
-- Migration additive CANDIDATE (GO_IMPLEMENT_PAYABLES_CHEQUES_CORE). Ce lot ne
-- l'applique à aucun environnement : staging et production exigent des GO
-- distincts. Référence fonctionnelle : conception canonique Pack 2B R2 et
-- arbitrages CTO du 25 octobre 2026.
--
-- Principes appliqués :
--   - écritures uniquement par fonctions SECURITY DEFINER au chemin épinglé ;
--     aucun privilège d'écriture directe pour les rôles applicatifs ;
--   - lecture par politiques fondées sur les capacités nominatives READ/AUDIT ;
--   - le rôle technique admin ne confère aucune habilitation métier ;
--   - interrupteur serveur dédié, fermé par défaut, deux portées (écritures
--     métier ; export, figé fermé dans ce lot) ;
--   - registre de commandes dédié (idempotence), contrôle de version optimiste,
--     verrouillage transactionnel en ordre fixe facture → paiement → allocation
--     → formule, verrous de traitement d'équipe ;
--   - journal du domaine en ajout seul ; aucune suppression ni réécriture des
--     faits financiers ; codes d'erreur fermés préfixés PAYABLES_ ;
--   - aucune modification de Daily v2, de Collections, d'Auth/RLS existants.
-- Hors périmètre : comptabilité, SAGE, P4, facilités, encaissements, Fund
-- Position, exports officiels, ordres bancaires, reproduction de signature.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. Schéma privé et interrupteur serveur
-- --------------------------------------------------------------------------

CREATE SCHEMA payables_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA payables_private FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA payables_private
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA payables_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE payables_private.runtime_control (
  singleton                boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  business_writes_enabled  boolean NOT NULL DEFAULT false,
  -- Aucune surface d'export n'existe dans ce lot (2B-E requis) : la portée
  -- publication/export reste figée fermée jusqu'à une migration dédiée.
  export_enabled           boolean NOT NULL DEFAULT false CHECK (NOT export_enabled),
  lock_minutes             integer NOT NULL DEFAULT 30 CHECK (lock_minutes BETWEEN 5 AND 480),
  change_reason            text NOT NULL CHECK (
                             char_length(btrim(change_reason)) BETWEEN 8 AND 240
                             AND change_reason !~ '[[:cntrl:]]'),
  changed_at               timestamptz NOT NULL DEFAULT statement_timestamp(),
  session_actor            name NOT NULL DEFAULT session_user,
  effective_actor          name NOT NULL DEFAULT current_user
);

COMMENT ON TABLE payables_private.runtime_control IS
  'Interrupteur PAYABLES-CHEQUES-CORE. false = toute écriture métier refusée. Ouverture opérateur uniquement sous GO d''environnement distinct ; aucun setter RPC.';

INSERT INTO payables_private.runtime_control (change_reason)
VALUES ('Initial closed state of the PAYABLES-CHEQUES-CORE candidate');

CREATE TABLE payables_private.runtime_control_events (
  event_id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at               timestamptz NOT NULL DEFAULT statement_timestamp(),
  previous_business        boolean,
  new_business             boolean NOT NULL,
  previous_lock_minutes    integer,
  new_lock_minutes         integer NOT NULL,
  safe_reason              text NOT NULL,
  session_actor            name NOT NULL,
  effective_actor          name NOT NULL,
  transaction_id           bigint NOT NULL
);

ALTER TABLE payables_private.runtime_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables_private.runtime_control_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE payables_private.runtime_control FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE payables_private.runtime_control_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE payables_private.runtime_control_events_event_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION payables_private.prepare_runtime_control_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_RUNTIME_CONTROL_DELETE_FORBIDDEN';
  END IF;
  IF NEW.singleton IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PAYABLES_RUNTIME_CONTROL_SINGLETON_REQUIRED';
  END IF;
  IF NEW.business_writes_enabled IS NOT DISTINCT FROM OLD.business_writes_enabled
     AND NEW.lock_minutes IS NOT DISTINCT FROM OLD.lock_minutes THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYABLES_RUNTIME_CONTROL_MODE_UNCHANGED';
  END IF;
  IF char_length(btrim(NEW.change_reason)) NOT BETWEEN 8 AND 240
     OR NEW.change_reason ~ '[[:cntrl:]]'
     OR btrim(NEW.change_reason) = btrim(OLD.change_reason) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYABLES_RUNTIME_CONTROL_NEW_SAFE_REASON_REQUIRED';
  END IF;
  NEW.changed_at := statement_timestamp();
  NEW.session_actor := session_user;
  NEW.effective_actor := current_user;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payables_runtime_control_prepare
BEFORE UPDATE OR DELETE ON payables_private.runtime_control
FOR EACH ROW EXECUTE FUNCTION payables_private.prepare_runtime_control_change();

CREATE TRIGGER payables_runtime_control_no_truncate
BEFORE TRUNCATE ON payables_private.runtime_control
FOR EACH STATEMENT EXECUTE FUNCTION payables_private.prepare_runtime_control_change();

CREATE FUNCTION payables_private.append_runtime_control_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO payables_private.runtime_control_events (
    previous_business, new_business, previous_lock_minutes, new_lock_minutes,
    safe_reason, session_actor, effective_actor, transaction_id)
  VALUES (OLD.business_writes_enabled, NEW.business_writes_enabled, OLD.lock_minutes,
    NEW.lock_minutes, NEW.change_reason, NEW.session_actor, NEW.effective_actor, txid_current());
  RETURN NULL;
END;
$$;

CREATE TRIGGER payables_runtime_control_audit
AFTER UPDATE ON payables_private.runtime_control
FOR EACH ROW EXECUTE FUNCTION payables_private.append_runtime_control_event();

-- Protection en ajout seul uniforme (arbitrage CTO 7) : niveau instruction,
-- couvre UPDATE, DELETE et TRUNCATE.
CREATE FUNCTION payables_private.block_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_APPEND_ONLY:' || TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER payables_runtime_control_events_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON payables_private.runtime_control_events
FOR EACH STATEMENT EXECUTE FUNCTION payables_private.block_append_only_mutation();

CREATE SEQUENCE payables_private.decision_seq;

-- --------------------------------------------------------------------------
-- 1. Tables du domaine
-- --------------------------------------------------------------------------

CREATE TABLE public.payables_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  actor_id           uuid REFERENCES auth.users(id),
  command_name       text NOT NULL,
  event_type         text NOT NULL,
  aggregate_type     text NOT NULL,
  aggregate_id       uuid,
  correlation_id     uuid NOT NULL,
  effective_date     date,
  reason             text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE public.payables_command_idempotency (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  completed_at       timestamptz,
  actor_id           uuid NOT NULL REFERENCES auth.users(id),
  command_name       text NOT NULL,
  command_key        text NOT NULL CHECK (char_length(btrim(command_key)) BETWEEN 8 AND 200),
  payload_hash       text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result_payload     jsonb,
  UNIQUE (actor_id, command_name, command_key)
);

CREATE TABLE public.payables_capability_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id),
  capability         text NOT NULL CHECK (capability IN (
                       'READ','AUDIT','INVOICE_MANAGE','SUPPLIER_MANAGE','SUPPLIER_MERGE_VALIDATE',
                       'CHEQUE_PREPARE_PRINT','CHEQUE_CONFIRM_ISSUE','TRANSFER_DECLARE',
                       'EXIT_REQUEST','EXIT_VALIDATE','BANK_FOLLOWUP','BANK_READ','EXCEPTION_INSTRUCT',
                       'PARAM_PROPOSE','PARAM_VALIDATE')),
  action             text NOT NULL CHECK (action IN ('GRANT','REVOKE')),
  origin             text NOT NULL DEFAULT 'PROPOSAL' CHECK (origin IN ('PROPOSAL','BOOTSTRAP')),
  status             text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','VALIDATED','REJECTED')),
  proposed_by        uuid REFERENCES auth.users(id),
  proposed_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  decided_by         uuid REFERENCES auth.users(id),
  decided_at         timestamptz,
  decision_seq       bigint UNIQUE,
  reason             text NOT NULL,
  decision_reason    text,
  CONSTRAINT payables_capability_grants_lifecycle CHECK (
    (origin = 'BOOTSTRAP' AND status = 'VALIDATED' AND action = 'GRANT'
      AND proposed_by IS NULL AND decided_by IS NULL AND decision_seq IS NOT NULL)
    OR (origin = 'PROPOSAL' AND proposed_by IS NOT NULL AND proposed_by <> user_id AND (
         (status = 'PROPOSED' AND decided_by IS NULL AND decided_at IS NULL AND decision_seq IS NULL)
         OR (status = 'REJECTED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
             AND decided_by <> proposed_by AND decision_seq IS NULL)
         OR (status = 'VALIDATED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
             AND decided_by <> proposed_by AND decided_by <> user_id AND decision_seq IS NOT NULL)))
  )
);

CREATE UNIQUE INDEX uq_payables_capability_pending
  ON public.payables_capability_grants (user_id, capability) WHERE status = 'PROPOSED';

CREATE TABLE public.payables_persons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name       text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 120
                       AND display_name !~ '[[:cntrl:]]'),
  status             text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','ACTIVE','REJECTED')),
  proposed_by        uuid NOT NULL REFERENCES auth.users(id),
  proposed_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  decided_by         uuid REFERENCES auth.users(id),
  decided_at         timestamptz,
  reason             text NOT NULL,
  decision_reason    text,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payables_persons_lifecycle CHECK (
    (status = 'PROPOSED' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'PROPOSED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decided_by <> proposed_by))
);

CREATE TABLE public.payables_person_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id          uuid NOT NULL REFERENCES public.payables_persons(id),
  user_id            uuid NOT NULL REFERENCES auth.users(id),
  action             text NOT NULL CHECK (action IN ('LINK','UNLINK')),
  status             text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','VALIDATED','REJECTED')),
  proposed_by        uuid NOT NULL REFERENCES auth.users(id),
  proposed_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  decided_by         uuid REFERENCES auth.users(id),
  decided_at         timestamptz,
  decision_seq       bigint UNIQUE,
  reason             text NOT NULL,
  decision_reason    text,
  CONSTRAINT payables_person_links_lifecycle CHECK (
    proposed_by <> user_id AND (
      (status = 'PROPOSED' AND decided_by IS NULL AND decided_at IS NULL AND decision_seq IS NULL)
      OR (status = 'REJECTED' AND decided_by IS NOT NULL AND decided_by <> proposed_by AND decision_seq IS NULL)
      OR (status = 'VALIDATED' AND decided_by IS NOT NULL AND decided_by <> proposed_by
          AND decided_by <> user_id AND decision_seq IS NOT NULL)))
);

CREATE UNIQUE INDEX uq_payables_person_link_pending_user
  ON public.payables_person_links (user_id) WHERE status = 'PROPOSED';
CREATE UNIQUE INDEX uq_payables_person_link_pending_person
  ON public.payables_person_links (person_id) WHERE status = 'PROPOSED';

CREATE TABLE public.payables_parameter_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL CHECK (kind IN ('SIGNATORY','SIGNATURE_RULE','CATEGORY','PRINT_PROFILE')),
  subject_key        text NOT NULL CHECK (char_length(subject_key) BETWEEN 1 AND 120),
  version_no         integer NOT NULL CHECK (version_no >= 1),
  valid_from         date NOT NULL,
  payload            jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  evidence_ref       text CHECK (evidence_ref IS NULL OR (char_length(btrim(evidence_ref)) BETWEEN 2 AND 200
                       AND evidence_ref !~ '[[:cntrl:]]')),
  status             text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','VALIDATED','REJECTED')),
  proposed_by        uuid NOT NULL REFERENCES auth.users(id),
  proposed_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  decided_by         uuid REFERENCES auth.users(id),
  decided_at         timestamptz,
  decision_seq       bigint UNIQUE,
  reason             text NOT NULL,
  decision_reason    text,
  UNIQUE (kind, subject_key, version_no),
  CONSTRAINT payables_parameter_versions_lifecycle CHECK (
    (status = 'PROPOSED' AND decided_by IS NULL AND decided_at IS NULL AND decision_seq IS NULL)
    OR (status = 'REJECTED' AND decided_by IS NOT NULL AND decided_by <> proposed_by AND decision_seq IS NULL)
    OR (status = 'VALIDATED' AND decided_by IS NOT NULL AND decided_by <> proposed_by AND decision_seq IS NOT NULL))
);

CREATE UNIQUE INDEX uq_payables_parameter_pending
  ON public.payables_parameter_versions (kind, subject_key) WHERE status = 'PROPOSED';

CREATE TABLE public.payables_suppliers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name     text NOT NULL CHECK (char_length(btrim(canonical_name)) BETWEEN 2 AND 160
                       AND canonical_name !~ '[[:cntrl:]]'),
  normalized_name    text NOT NULL CHECK (normalized_name <> ''),
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MERGED')),
  merged_into_id     uuid REFERENCES public.payables_suppliers(id),
  created_by         uuid NOT NULL REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payables_suppliers_merge_coherent CHECK (
    (status = 'ACTIVE' AND merged_into_id IS NULL)
    OR (status = 'MERGED' AND merged_into_id IS NOT NULL AND merged_into_id <> id))
);

CREATE UNIQUE INDEX uq_payables_supplier_active_name
  ON public.payables_suppliers (normalized_name) WHERE status = 'ACTIVE';

CREATE TABLE public.payables_supplier_merges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  absorbed_id        uuid NOT NULL REFERENCES public.payables_suppliers(id),
  kept_id            uuid NOT NULL REFERENCES public.payables_suppliers(id),
  status             text NOT NULL CHECK (status IN ('PROPOSED','APPLIED','REJECTED','PENDING_INSTRUCTION')),
  touches_engagements boolean NOT NULL,
  collision_count    integer NOT NULL DEFAULT 0 CHECK (collision_count >= 0),
  proposed_by        uuid NOT NULL REFERENCES auth.users(id),
  proposed_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  decided_by         uuid REFERENCES auth.users(id),
  decided_at         timestamptz,
  reason             text NOT NULL,
  decision_reason    text,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payables_supplier_merges_distinct CHECK (absorbed_id <> kept_id),
  CONSTRAINT payables_supplier_merges_second_actor CHECK (decided_by IS NULL OR decided_by <> proposed_by)
);

CREATE UNIQUE INDEX uq_payables_supplier_merge_open
  ON public.payables_supplier_merges (absorbed_id) WHERE status IN ('PROPOSED','PENDING_INSTRUCTION');

CREATE TABLE public.payables_invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id        uuid NOT NULL REFERENCES public.payables_suppliers(id),
  reference_exact    text NOT NULL CHECK (char_length(reference_exact) BETWEEN 1 AND 80
                       AND reference_exact = btrim(reference_exact) AND reference_exact !~ '[[:cntrl:]]'),
  collision_ordinal  integer NOT NULL DEFAULT 0 CHECK (collision_ordinal >= 0),
  amount             numeric(18,2) NOT NULL CHECK (amount > 0 AND amount = trunc(amount) AND amount <= 999999999999),
  currency           text NOT NULL CHECK (currency = 'XOF'),
  invoice_date       date,
  due_date           date,
  evidence_ref       text NOT NULL CHECK (char_length(btrim(evidence_ref)) BETWEEN 2 AND 200
                       AND evidence_ref !~ '[[:cntrl:]]'),
  created_by         uuid NOT NULL REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  row_version        integer NOT NULL DEFAULT 1,
  UNIQUE (supplier_id, reference_exact, collision_ordinal)
);

CREATE TABLE public.payables_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid NOT NULL REFERENCES public.payables_invoices(id),
  mode               text NOT NULL CHECK (mode IN ('CHEQUE','TRANSFER')),
  bank_account_id    uuid NOT NULL REFERENCES public.daily_statement_account_registry(id),
  category_code      text NOT NULL CHECK (category_code ~ '^[A-Z0-9_]{2,32}$'),
  amount             numeric(18,2) NOT NULL CHECK (amount > 0 AND amount = trunc(amount) AND amount <= 999999999999),
  currency           text NOT NULL CHECK (currency = 'XOF'),
  is_partial         boolean NOT NULL,
  beneficiary        text CHECK (beneficiary IS NULL OR (char_length(btrim(beneficiary)) BETWEEN 2 AND 120
                       AND beneficiary !~ '[[:cntrl:]]')),
  status             text NOT NULL CHECK (status IN ('OPEN','ISSUED','ABANDONED','CANCELLED','REPLACED','DECLARED')),
  replaces_payment_id uuid REFERENCES public.payables_payments(id),
  created_by         uuid NOT NULL REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payables_payments_mode_status CHECK (
    (mode = 'CHEQUE' AND beneficiary IS NOT NULL AND status IN ('OPEN','ISSUED','ABANDONED','CANCELLED','REPLACED'))
    OR (mode = 'TRANSFER' AND status = 'DECLARED'))
);

CREATE UNIQUE INDEX uq_payables_payment_replacement
  ON public.payables_payments (replaces_payment_id) WHERE replaces_payment_id IS NOT NULL;

CREATE TABLE public.payables_allocations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL UNIQUE REFERENCES public.payables_payments(id),
  invoice_id         uuid NOT NULL REFERENCES public.payables_invoices(id),
  amount             numeric(18,2) NOT NULL CHECK (amount > 0 AND amount = trunc(amount)),
  status             text NOT NULL CHECK (status IN ('RESERVED','ENGAGED','CANCELLED')),
  created_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  row_version        integer NOT NULL DEFAULT 1
);

CREATE INDEX ix_payables_allocations_invoice ON public.payables_allocations (invoice_id, status);

CREATE TABLE public.payables_cheque_forms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id    uuid NOT NULL REFERENCES public.daily_statement_account_registry(id),
  -- Numéro préimprimé conservé tel que saisi, zéros initiaux compris.
  cheque_number      text NOT NULL CHECK (cheque_number ~ '^[0-9]{1,16}$'),
  payment_id         uuid REFERENCES public.payables_payments(id),
  provenance         text NOT NULL CHECK (provenance IN ('NATIVE','TAKEOVER','EXCEPTION','PRESIGNED_INVENTORY')),
  state              text NOT NULL CHECK (state IN (
                       'ASSIGNED','PRINT_PENDING','PRINTED','PRINT_UNCERTAIN','UNUSED','LOST',
                       'PRESIGNED_HELD','ISSUED','CLEARED','CANCELLED','REPLACED')),
  presigned          boolean NOT NULL DEFAULT false,
  unused_reason      text,
  created_by         uuid NOT NULL REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payables_cheque_forms_number_unique UNIQUE (bank_account_id, cheque_number),
  CONSTRAINT payables_cheque_forms_native_payment CHECK (provenance <> 'NATIVE' OR payment_id IS NOT NULL),
  CONSTRAINT payables_cheque_forms_presigned CHECK (provenance <> 'PRESIGNED_INVENTORY' OR presigned)
);

-- Une seule formule vivante par paiement (les formules inutilisées restent).
CREATE UNIQUE INDEX uq_payables_form_active_per_payment
  ON public.payables_cheque_forms (payment_id)
  WHERE payment_id IS NOT NULL
    AND state IN ('ASSIGNED','PRINT_PENDING','PRINTED','PRINT_UNCERTAIN','ISSUED','CLEARED');

CREATE TABLE public.payables_cheque_contents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id            uuid NOT NULL REFERENCES public.payables_cheque_forms(id),
  version_no         integer NOT NULL CHECK (version_no >= 1),
  fields             jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  content_hash       text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  profile_version_id uuid NOT NULL REFERENCES public.payables_parameter_versions(id),
  created_by         uuid NOT NULL REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (form_id, version_no)
);

CREATE TABLE public.payables_print_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id            uuid NOT NULL REFERENCES public.payables_cheque_forms(id),
  content_id         uuid NOT NULL REFERENCES public.payables_cheque_contents(id),
  profile_version_id uuid NOT NULL REFERENCES public.payables_parameter_versions(id),
  kind               text NOT NULL CHECK (kind IN ('INITIAL','REPRINT')),
  status             text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','PRINTED','NOT_PRINTED','SPOILED','UNCERTAIN')),
  requested_by       uuid NOT NULL REFERENCES auth.users(id),
  requested_at       timestamptz NOT NULL DEFAULT statement_timestamp(),
  outcome_by         uuid REFERENCES auth.users(id),
  outcome_at         timestamptz,
  reason             text NOT NULL,
  outcome_reason     text,
  CONSTRAINT payables_print_events_lifecycle CHECK (
    (status = 'PENDING' AND outcome_by IS NULL AND outcome_at IS NULL)
    OR (status <> 'PENDING' AND outcome_by IS NOT NULL AND outcome_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_payables_print_pending
  ON public.payables_print_events (form_id) WHERE status = 'PENDING';

CREATE TABLE public.payables_signatures (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id            uuid NOT NULL REFERENCES public.payables_cheque_forms(id),
  content_id         uuid NOT NULL REFERENCES public.payables_cheque_contents(id),
  person_id          uuid NOT NULL REFERENCES public.payables_persons(id),
  signed_on          date NOT NULL,
  recorded_by        uuid NOT NULL REFERENCES auth.users(id),
  recorded_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  reason             text,
  UNIQUE (content_id, person_id)
);

CREATE TABLE public.payables_issuances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id            uuid NOT NULL REFERENCES public.payables_cheque_forms(id),
  revision_no        integer NOT NULL CHECK (revision_no >= 1),
  path               text NOT NULL CHECK (path IN ('NORMAL','EXCEPTION','TAKEOVER')),
  issue_date         date NOT NULL,
  amount             numeric(18,2) CHECK (amount IS NULL OR (amount > 0 AND amount = trunc(amount))),
  exception_reason_code text CHECK (exception_reason_code IS NULL OR exception_reason_code IN (
                       'SIGNATORY_IS_PREPARER','SIGNATURE_MISSING','SIGNATORY_NOT_ADMISSIBLE',
                       'CONJOINT_INCOMPLETE','PRESIGNED_OUTSIDE_PROTOCOL','OTHER_OUTSIDE_CIRCUIT')),
  applied_versions   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(applied_versions) = 'object'),
  evidence_ref       text,
  recorded_by        uuid NOT NULL REFERENCES auth.users(id),
  recorded_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  reason             text,
  UNIQUE (form_id, revision_no),
  CONSTRAINT payables_issuances_normal_amount CHECK (path <> 'NORMAL' OR amount IS NOT NULL),
  CONSTRAINT payables_issuances_exception_evidence CHECK (
    path <> 'EXCEPTION' OR (exception_reason_code IS NOT NULL AND evidence_ref IS NOT NULL))
);

CREATE TABLE public.payables_deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id            uuid NOT NULL UNIQUE REFERENCES public.payables_cheque_forms(id),
  delivered_on       date NOT NULL,
  note               text,
  recorded_by        uuid NOT NULL REFERENCES auth.users(id),
  recorded_at        timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE public.payables_exits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id            uuid NOT NULL REFERENCES public.payables_cheque_forms(id),
  kind               text NOT NULL CHECK (kind IN ('CANCELLATION','REPLACEMENT','CORRECTION','BANK_MATCH')),
  status             text NOT NULL CHECK (status IN ('REQUESTED','VALIDATED','REJECTED','REVOKED')),
  requested_by       uuid NOT NULL REFERENCES auth.users(id),
  requested_at       timestamptz NOT NULL DEFAULT statement_timestamp(),
  decided_by         uuid REFERENCES auth.users(id),
  decided_at         timestamptz,
  accounting_date    date,
  value_date         date,
  evidence_ref       text,
  reason             text NOT NULL,
  decision_reason    text,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  replacement_payment_id uuid REFERENCES public.payables_payments(id),
  match_id           uuid,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payables_exits_second_actor CHECK (
    kind = 'BANK_MATCH' OR decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT payables_exits_bank_match CHECK (
    kind <> 'BANK_MATCH' OR (status IN ('VALIDATED','REVOKED') AND match_id IS NOT NULL)),
  CONSTRAINT payables_exits_revoked_only_bank CHECK (status <> 'REVOKED' OR kind = 'BANK_MATCH'),
  CONSTRAINT payables_exits_lifecycle CHECK (
    (status = 'REQUESTED' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'REQUESTED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_payables_exit_requested
  ON public.payables_exits (form_id) WHERE status = 'REQUESTED';
CREATE UNIQUE INDEX uq_payables_exit_terminal
  ON public.payables_exits (form_id)
  WHERE status = 'VALIDATED' AND kind IN ('CANCELLATION','REPLACEMENT','BANK_MATCH');

CREATE TABLE public.payables_transfer_declarations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL UNIQUE REFERENCES public.payables_payments(id),
  bank_account_id    uuid NOT NULL REFERENCES public.daily_statement_account_registry(id),
  amount             numeric(18,2) NOT NULL CHECK (amount > 0 AND amount = trunc(amount)),
  bank_reference     text NOT NULL CHECK (char_length(btrim(bank_reference)) BETWEEN 1 AND 80
                       AND bank_reference !~ '[[:cntrl:]]'),
  declared_status    text NOT NULL CHECK (declared_status IN ('EXECUTED','COMMITTED')),
  executed_on        date,
  allocation_outcome text NOT NULL CHECK (allocation_outcome IN ('ALLOCATED','UNALLOCATED')),
  evidence_ref       text NOT NULL,
  declared_by        uuid NOT NULL REFERENCES auth.users(id),
  declared_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT payables_transfer_execution CHECK (
    (declared_status = 'EXECUTED' AND executed_on IS NOT NULL)
    OR (declared_status = 'COMMITTED' AND executed_on IS NULL))
);

CREATE TABLE public.payables_takeover_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id    uuid NOT NULL REFERENCES public.daily_statement_account_registry(id),
  cutoff_date        date NOT NULL,
  source_label       text NOT NULL CHECK (char_length(btrim(source_label)) BETWEEN 2 AND 120
                       AND source_label !~ '[[:cntrl:]]'),
  control_count      integer NOT NULL CHECK (control_count BETWEEN 0 AND 5000),
  control_total      numeric(18,2) NOT NULL CHECK (control_total >= 0 AND control_total = trunc(control_total)),
  status             text NOT NULL DEFAULT 'PREPARED'
                       CHECK (status IN ('PREPARED','INTEGRATED','REJECTED','COLLISION')),
  completeness_attested boolean NOT NULL DEFAULT false,
  prepared_by        uuid NOT NULL REFERENCES auth.users(id),
  prepared_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  decided_by         uuid REFERENCES auth.users(id),
  decided_at         timestamptz,
  reason             text NOT NULL,
  decision_reason    text,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payables_takeover_second_actor CHECK (decided_by IS NULL OR decided_by <> prepared_by),
  CONSTRAINT payables_takeover_attestation CHECK (NOT completeness_attested OR status = 'INTEGRATED')
);

CREATE UNIQUE INDEX uq_payables_takeover_open
  ON public.payables_takeover_batches (bank_account_id) WHERE status = 'PREPARED';

CREATE TABLE public.payables_takeover_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid NOT NULL REFERENCES public.payables_takeover_batches(id),
  line_no            integer NOT NULL CHECK (line_no >= 1),
  cheque_number      text NOT NULL CHECK (cheque_number ~ '^[0-9]{1,16}$'),
  beneficiary        text NOT NULL CHECK (char_length(btrim(beneficiary)) BETWEEN 2 AND 120
                       AND beneficiary !~ '[[:cntrl:]]'),
  amount             numeric(18,2) NOT NULL CHECK (amount > 0 AND amount = trunc(amount)),
  issue_date         date NOT NULL,
  UNIQUE (batch_id, line_no),
  UNIQUE (batch_id, cheque_number)
);

CREATE TABLE public.payables_exceptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL CHECK (kind IN (
                       'INVOICE_COLLISION','FORM_PRINT_UNCERTAIN','TRANSFER_UNALLOCATED',
                       'ISSUED_OUTSIDE_CIRCUIT','ISSUANCE_OVERRUN','CANCELLED_CHEQUE_PRESENTED',
                       'MATCH_EVIDENCE_INACTIVE','MERGE_COLLISION','TAKEOVER_COLLISION',
                       'PRESIGNED_FORM_RISK','FORM_LOST','UNISSUED_FORM_PRESENTED')),
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  invoice_id         uuid REFERENCES public.payables_invoices(id),
  payment_id         uuid REFERENCES public.payables_payments(id),
  form_id            uuid REFERENCES public.payables_cheque_forms(id),
  supplier_merge_id  uuid REFERENCES public.payables_supplier_merges(id),
  takeover_batch_id  uuid REFERENCES public.payables_takeover_batches(id),
  bank_account_id    uuid REFERENCES public.daily_statement_account_registry(id),
  match_id           uuid,
  blocks_invoice     boolean NOT NULL DEFAULT false,
  blocks_account     boolean NOT NULL DEFAULT false,
  opened_by          uuid NOT NULL REFERENCES auth.users(id),
  opened_at          timestamptz NOT NULL DEFAULT statement_timestamp(),
  reason             text NOT NULL,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  resolution_code    text,
  resolution_reason  text,
  resolution_evidence_ref text,
  resolved_by        uuid REFERENCES auth.users(id),
  resolved_at        timestamptz,
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payables_exceptions_invoice_block CHECK (NOT blocks_invoice OR invoice_id IS NOT NULL),
  CONSTRAINT payables_exceptions_account_block CHECK (NOT blocks_account OR bank_account_id IS NOT NULL),
  CONSTRAINT payables_exceptions_lifecycle CHECK (
    (status = 'OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_code IS NULL)
    OR (status = 'RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
        AND resolution_code IS NOT NULL AND resolved_by <> opened_by))
);

CREATE INDEX ix_payables_exceptions_open_invoice
  ON public.payables_exceptions (invoice_id) WHERE status = 'OPEN' AND blocks_invoice;
CREATE INDEX ix_payables_exceptions_open_account
  ON public.payables_exceptions (bank_account_id) WHERE status = 'OPEN' AND blocks_account;

CREATE TABLE public.payables_work_locks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type        text NOT NULL CHECK (object_type IN ('PAYMENT','FORM','INVOICE','EXCEPTION')),
  object_id          uuid NOT NULL,
  holder             uuid NOT NULL REFERENCES auth.users(id),
  acquired_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at         timestamptz NOT NULL,
  released_at        timestamptz,
  released_by        uuid REFERENCES auth.users(id),
  release_kind       text CHECK (release_kind IN ('RELEASED','EXPIRED','FORCED')),
  release_reason     text,
  CONSTRAINT payables_work_locks_release CHECK (
    (released_at IS NULL AND release_kind IS NULL)
    OR (released_at IS NOT NULL AND release_kind IS NOT NULL))
);

CREATE UNIQUE INDEX uq_payables_work_lock_active
  ON public.payables_work_locks (object_type, object_id) WHERE released_at IS NULL;

-- --------------------------------------------------------------------------
-- 2. Protections structurelles : aucune suppression, faits immuables
-- --------------------------------------------------------------------------

CREATE FUNCTION payables_private.block_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_DELETE_FORBIDDEN:' || TG_TABLE_NAME;
END;
$$;

CREATE FUNCTION payables_private.block_decided_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'PROPOSED' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_DECIDED_ROW_IMMUTABLE:' || TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION payables_private.block_print_event_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'PENDING' OR NEW.form_id <> OLD.form_id OR NEW.content_id <> OLD.content_id
     OR NEW.profile_version_id <> OLD.profile_version_id OR NEW.kind <> OLD.kind
     OR NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_PRINT_EVENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'payables_command_idempotency','payables_capability_grants','payables_persons','payables_person_links',
    'payables_parameter_versions','payables_suppliers','payables_supplier_merges','payables_invoices',
    'payables_payments','payables_allocations','payables_cheque_forms','payables_cheque_contents',
    'payables_print_events','payables_signatures','payables_issuances','payables_deliveries',
    'payables_exits','payables_transfer_declarations','payables_takeover_batches','payables_takeover_items',
    'payables_exceptions','payables_work_locks'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION payables_private.block_delete()',
      v_table || '_no_delete', v_table);
  END LOOP;
  -- Faits immuables : contenu signable, signatures, émissions, remises, lignes de reprise.
  FOREACH v_table IN ARRAY ARRAY[
    'payables_cheque_contents','payables_signatures','payables_issuances','payables_deliveries',
    'payables_takeover_items','payables_transfer_declarations'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION payables_private.block_append_only_mutation()',
      v_table || '_immutable', v_table);
  END LOOP;
  -- Versions décidées immuables (proposition → décision une seule fois).
  FOREACH v_table IN ARRAY ARRAY[
    'payables_capability_grants','payables_persons','payables_person_links','payables_parameter_versions'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION payables_private.block_decided_update()',
      v_table || '_decided_immutable', v_table);
  END LOOP;
END $$;

CREATE TRIGGER payables_events_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.payables_events
FOR EACH STATEMENT EXECUTE FUNCTION payables_private.block_append_only_mutation();

CREATE TRIGGER payables_print_events_outcome_once
BEFORE UPDATE ON public.payables_print_events
FOR EACH ROW EXECUTE FUNCTION payables_private.block_print_event_rewrite();

-- --------------------------------------------------------------------------
-- 3. Fonctions internes (non exposées)
-- --------------------------------------------------------------------------

CREATE FUNCTION payables_private.today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT (statement_timestamp() AT TIME ZONE 'Africa/Dakar')::date $$;

CREATE FUNCTION payables_private.require_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'PAYABLES_AUTH_REQUIRED';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE FUNCTION payables_private.assert_business_writes_enabled()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_enabled boolean;
BEGIN
  -- Verrou partagé : une refermeture concurrente attend la fin de l'écriture.
  SELECT rc.business_writes_enabled INTO v_enabled
  FROM payables_private.runtime_control rc WHERE rc.singleton FOR SHARE;
  IF coalesce(v_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_DOMAIN_READ_ONLY';
  END IF;
END;
$$;

CREATE FUNCTION payables_private.has_capability(p_user uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce((
    SELECT g.action = 'GRANT'
    FROM public.payables_capability_grants g
    WHERE g.user_id = p_user AND g.capability = p_capability AND g.status = 'VALIDATED'
    ORDER BY g.decision_seq DESC
    LIMIT 1), false)
$$;

CREATE FUNCTION payables_private.require_capability(p_actor uuid, p_capability text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT payables_private.has_capability(p_actor, p_capability) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_CAPABILITY_REQUIRED:' || p_capability;
  END IF;
END;
$$;

CREATE FUNCTION payables_private.payload_hash(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT encode(sha256(convert_to(coalesce(p_payload, 'null'::jsonb)::text, 'UTF8')), 'hex')
$$;

CREATE FUNCTION payables_private.idem_begin(p_actor uuid, p_command text, p_key text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_hash text := payables_private.payload_hash(p_payload);
  v_row public.payables_command_idempotency%ROWTYPE;
BEGIN
  IF p_key IS NULL OR char_length(btrim(p_key)) NOT BETWEEN 8 AND 200 OR p_key ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'PAYABLES_COMMAND_KEY_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:' || p_actor::text || ':' || p_command || ':' || p_key, 0));
  SELECT * INTO v_row FROM public.payables_command_idempotency
   WHERE actor_id = p_actor AND command_name = p_command AND command_key = p_key FOR UPDATE;
  IF FOUND THEN
    IF v_row.payload_hash <> v_hash THEN RAISE EXCEPTION 'PAYABLES_IDEMPOTENCY_PAYLOAD_MISMATCH'; END IF;
    IF v_row.result_payload IS NULL THEN RAISE EXCEPTION 'PAYABLES_IDEMPOTENCY_INCOMPLETE'; END IF;
    RETURN v_row.result_payload || jsonb_build_object('replayed', true);
  END IF;
  INSERT INTO public.payables_command_idempotency (actor_id, command_name, command_key, payload_hash)
  VALUES (p_actor, p_command, p_key, v_hash);
  RETURN NULL;
END;
$$;

CREATE FUNCTION payables_private.idem_finish(p_actor uuid, p_command text, p_key text, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.payables_command_idempotency
     SET result_payload = p_result, completed_at = statement_timestamp()
   WHERE actor_id = p_actor AND command_name = p_command AND command_key = p_key AND result_payload IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYABLES_IDEMPOTENCY_ROW_MISSING'; END IF;
  RETURN p_result || jsonb_build_object('replayed', false);
END;
$$;

CREATE FUNCTION payables_private.append_event(
  p_actor uuid, p_command text, p_event text, p_aggregate_type text, p_aggregate_id uuid,
  p_correlation uuid, p_reason text, p_effective_date date DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'PAYABLES_EVENT_METADATA_OBJECT_REQUIRED';
  END IF;
  IF p_metadata ?| ARRAY['raw_text','raw_bytes','file_content','account_number','iban','password',
                         'secret','token','label','description','description_sanitized'] THEN
    RAISE EXCEPTION 'PAYABLES_EVENT_SENSITIVE_METADATA_REJECTED';
  END IF;
  INSERT INTO public.payables_events (actor_id, command_name, event_type, aggregate_type, aggregate_id,
    correlation_id, effective_date, reason, metadata)
  VALUES (p_actor, p_command, p_event, p_aggregate_type, p_aggregate_id, p_correlation, p_effective_date,
    nullif(btrim(p_reason), ''), p_metadata);
END;
$$;

CREATE FUNCTION payables_private.safe_text(p_value text, p_code text, p_min integer, p_max integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_value IS NULL OR p_value ~ '[[:cntrl:]]'
     OR char_length(btrim(p_value)) < p_min OR char_length(btrim(p_value)) > p_max THEN
    RAISE EXCEPTION 'PAYABLES_%_INVALID', p_code;
  END IF;
  RETURN btrim(p_value);
END;
$$;

CREATE FUNCTION payables_private.xof_amount(p_value numeric, p_code text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_value IS NULL OR p_value <= 0 OR p_value <> trunc(p_value) OR p_value > 999999999999 THEN
    RAISE EXCEPTION 'PAYABLES_%_INVALID', p_code;
  END IF;
  RETURN p_value;
END;
$$;

CREATE FUNCTION payables_private.assert_version(p_actual integer, p_expected integer)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_expected IS NULL OR p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'PAYABLES_STALE_VERSION';
  END IF;
END;
$$;

CREATE FUNCTION payables_private.assert_not_future(p_date date, p_code text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_date IS NULL THEN RAISE EXCEPTION 'PAYABLES_%_REQUIRED', p_code; END IF;
  IF p_date > payables_private.today() THEN RAISE EXCEPTION 'PAYABLES_FUTURE_DATE_FORBIDDEN:%', p_code; END IF;
END;
$$;

CREATE FUNCTION payables_private.assert_lock_free(p_type text, p_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payables_work_locks l
    WHERE l.object_type = p_type AND l.object_id = p_id AND l.released_at IS NULL
      AND l.expires_at > statement_timestamp() AND l.holder <> p_actor
  ) THEN
    RAISE EXCEPTION 'PAYABLES_LOCKED_BY_OTHER';
  END IF;
END;
$$;

CREATE FUNCTION payables_private.normalize_name(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      translate(upper(coalesce(p_value, '')), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ', 'AAAAAACEEEEIIIINOOOOOUUUUY'),
      '[^A-Z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

CREATE FUNCTION payables_private.person_of_user(p_user uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN l.action = 'LINK' THEN l.person_id END
  FROM public.payables_person_links l
  WHERE l.user_id = p_user AND l.status = 'VALIDATED'
  ORDER BY l.decision_seq DESC
  LIMIT 1
$$;

CREATE FUNCTION payables_private.user_of_person(p_person uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN l.action = 'LINK' THEN l.user_id END
  FROM public.payables_person_links l
  WHERE l.person_id = p_person AND l.status = 'VALIDATED'
  ORDER BY l.decision_seq DESC
  LIMIT 1
$$;

CREATE FUNCTION payables_private.effective_parameter(p_kind text, p_subject text, p_on date)
RETURNS public.payables_parameter_versions
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT v.*
  FROM public.payables_parameter_versions v
  WHERE v.kind = p_kind AND v.subject_key = p_subject AND v.status = 'VALIDATED' AND v.valid_from <= p_on
  ORDER BY v.valid_from DESC, v.version_no DESC
  LIMIT 1
$$;

CREATE FUNCTION payables_private.category_active(p_code text, p_on date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce((payables_private.effective_parameter('CATEGORY', p_code, p_on)).payload->>'state' = 'ACTIVE', false)
$$;

-- Admissibilité d'un signataire (C6.2) : version ACTIVE couvrant la date, catégorie
-- autorisée, plafond explicite compatible. Plafond absent = jamais illimité.
CREATE FUNCTION payables_private.signatory_version_if_admissible(
  p_person uuid, p_account uuid, p_category text, p_amount numeric, p_on date
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v public.payables_parameter_versions;
BEGIN
  v := payables_private.effective_parameter('SIGNATORY', p_person::text || '|' || p_account::text, p_on);
  -- Toute donnée absente ou mal typée vaut refus (aucune logique NULL permissive).
  IF v.id IS NULL OR v.payload->>'state' IS DISTINCT FROM 'ACTIVE' THEN RETURN NULL; END IF;
  IF jsonb_typeof(v.payload->'categories') IS DISTINCT FROM 'array' OR p_category IS NULL
     OR NOT coalesce(v.payload->'categories' ? '*' OR v.payload->'categories' ? p_category, false) THEN
    RETURN NULL;
  END IF;
  IF v.payload #>> '{ceiling,kind}' = 'UNLIMITED' THEN RETURN v.id; END IF;
  IF v.payload #>> '{ceiling,kind}' = 'AMOUNT'
     AND p_amount IS NOT NULL AND p_amount <= (v.payload #>> '{ceiling,amount}')::numeric THEN
    RETURN v.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION payables_private.invoice_blocked(p_invoice uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payables_exceptions e
    WHERE e.invoice_id = p_invoice AND e.status = 'OPEN' AND e.blocks_invoice)
$$;

CREATE FUNCTION payables_private.committed_amount(p_invoice uuid, p_exclude_payment uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(sum(a.amount), 0)
  FROM public.payables_allocations a
  WHERE a.invoice_id = p_invoice AND a.status IN ('RESERVED','ENGAGED')
    AND (p_exclude_payment IS NULL OR a.payment_id <> p_exclude_payment)
$$;

CREATE FUNCTION payables_private.open_exception(
  p_actor uuid, p_kind text, p_reason text, p_invoice uuid, p_payment uuid, p_form uuid,
  p_account uuid, p_blocks_invoice boolean, p_blocks_account boolean,
  p_details jsonb DEFAULT '{}'::jsonb, p_merge uuid DEFAULT NULL, p_batch uuid DEFAULT NULL,
  p_match uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.payables_exceptions (kind, invoice_id, payment_id, form_id, bank_account_id,
    blocks_invoice, blocks_account, opened_by, reason, details, supplier_merge_id, takeover_batch_id, match_id)
  VALUES (p_kind, p_invoice, p_payment, p_form, p_account, p_blocks_invoice, p_blocks_account,
    p_actor, p_reason, coalesce(p_details, '{}'::jsonb), p_merge, p_batch, p_match)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Compte bancaire admissible : registre Daily v2 actif, XOF (V1).
CREATE FUNCTION payables_private.require_account(p_account uuid)
RETURNS public.daily_statement_account_registry
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v public.daily_statement_account_registry;
BEGIN
  SELECT * INTO v FROM public.daily_statement_account_registry r WHERE r.id = p_account;
  IF v.id IS NULL OR v.status <> 'active' THEN RAISE EXCEPTION 'PAYABLES_ACCOUNT_INVALID'; END IF;
  IF v.currency <> 'XOF' THEN RAISE EXCEPTION 'PAYABLES_CURRENCY_NOT_SUPPORTED'; END IF;
  RETURN v;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Montant en lettres (français, XOF entier) et mise en page bornée
-- --------------------------------------------------------------------------

CREATE FUNCTION payables_private.words_below_100(p_n integer, p_final boolean)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_units constant text[] := ARRAY['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
  v_tens constant text[] := ARRAY['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
  v_t integer; v_r integer;
BEGIN
  IF p_n < 0 OR p_n > 99 THEN RAISE EXCEPTION 'PAYABLES_AMOUNT_WORDS_RANGE'; END IF;
  IF p_n <= 16 THEN RETURN v_units[p_n + 1]; END IF;
  IF p_n < 20 THEN RETURN 'dix-' || v_units[p_n - 10 + 1]; END IF;
  v_t := p_n / 10; v_r := p_n % 10;
  IF v_t BETWEEN 2 AND 6 THEN
    IF v_r = 0 THEN RETURN v_tens[v_t + 1]; END IF;
    IF v_r = 1 THEN RETURN v_tens[v_t + 1] || ' et un'; END IF;
    RETURN v_tens[v_t + 1] || '-' || v_units[v_r + 1];
  END IF;
  IF v_t = 7 THEN
    IF v_r = 1 THEN RETURN 'soixante et onze'; END IF;
    RETURN 'soixante-' || payables_private.words_below_100(10 + v_r, p_final);
  END IF;
  IF v_t = 8 THEN
    IF v_r = 0 THEN RETURN CASE WHEN p_final THEN 'quatre-vingts' ELSE 'quatre-vingt' END; END IF;
    RETURN 'quatre-vingt-' || v_units[v_r + 1];
  END IF;
  RETURN 'quatre-vingt-' || payables_private.words_below_100(10 + v_r, p_final);
END;
$$;

CREATE FUNCTION payables_private.words_below_1000(p_n integer, p_final boolean)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_units constant text[] := ARRAY['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
  v_h integer := p_n / 100; v_r integer := p_n % 100; v_head text;
BEGIN
  IF p_n < 0 OR p_n > 999 THEN RAISE EXCEPTION 'PAYABLES_AMOUNT_WORDS_RANGE'; END IF;
  IF v_h = 0 THEN RETURN payables_private.words_below_100(v_r, p_final); END IF;
  IF v_h = 1 THEN v_head := 'cent';
  ELSE v_head := v_units[v_h + 1] || ' cent' || CASE WHEN v_r = 0 AND p_final THEN 's' ELSE '' END;
  END IF;
  IF v_r = 0 THEN RETURN v_head; END IF;
  RETURN v_head || ' ' || payables_private.words_below_100(v_r, p_final);
END;
$$;

CREATE FUNCTION payables_private.amount_in_words_fr(p_amount numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_n bigint; v_billions integer; v_millions integer; v_thousands integer; v_rest integer;
  v_parts text[] := '{}';
BEGIN
  IF p_amount IS NULL OR p_amount < 0 OR p_amount <> trunc(p_amount) OR p_amount > 999999999999 THEN
    RAISE EXCEPTION 'PAYABLES_AMOUNT_WORDS_RANGE';
  END IF;
  v_n := p_amount::bigint;
  IF v_n = 0 THEN RETURN 'zéro'; END IF;
  v_billions := (v_n / 1000000000)::integer;
  v_millions := ((v_n / 1000000) % 1000)::integer;
  v_thousands := ((v_n / 1000) % 1000)::integer;
  v_rest := (v_n % 1000)::integer;
  IF v_billions > 0 THEN
    v_parts := v_parts || CASE WHEN v_billions = 1 THEN 'un milliard'
      ELSE payables_private.words_below_1000(v_billions, true) || ' milliards' END;
  END IF;
  IF v_millions > 0 THEN
    v_parts := v_parts || CASE WHEN v_millions = 1 THEN 'un million'
      ELSE payables_private.words_below_1000(v_millions, true) || ' millions' END;
  END IF;
  IF v_thousands > 0 THEN
    v_parts := v_parts || CASE WHEN v_thousands = 1 THEN 'mille'
      ELSE payables_private.words_below_1000(v_thousands, false) || ' mille' END;
  END IF;
  IF v_rest > 0 THEN
    v_parts := v_parts || payables_private.words_below_1000(v_rest, true);
  END IF;
  RETURN array_to_string(v_parts, ' ');
END;
$$;

CREATE FUNCTION payables_private.group_digits(p_amount numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT regexp_replace(p_amount::bigint::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g')
$$;

-- Découpage glouton par mots, identique au module TypeScript chequeLayout.
-- NULL si un mot dépasse seul la largeur.
CREATE FUNCTION payables_private.wrap_words(p_text text, p_max integer)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_word text; v_current text := ''; v_lines text[] := '{}';
BEGIN
  FOREACH v_word IN ARRAY regexp_split_to_array(btrim(p_text), '\s+') LOOP
    IF char_length(v_word) > p_max THEN RETURN NULL; END IF;
    IF v_current = '' THEN v_current := v_word;
    ELSIF char_length(v_current) + 1 + char_length(v_word) <= p_max THEN v_current := v_current || ' ' || v_word;
    ELSE v_lines := v_lines || v_current; v_current := v_word;
    END IF;
  END LOOP;
  IF v_current <> '' THEN v_lines := v_lines || v_current; END IF;
  RETURN v_lines;
END;
$$;

CREATE FUNCTION payables_private.json_number(p_payload jsonb, p_path text[], p_min numeric, p_max numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v numeric;
BEGIN
  IF jsonb_typeof(p_payload #> p_path) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:%', array_to_string(p_path, '.');
  END IF;
  v := (p_payload #>> p_path)::numeric;
  IF v < p_min OR v > p_max THEN
    RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:%', array_to_string(p_path, '.');
  END IF;
  RETURN v;
END;
$$;

CREATE FUNCTION payables_private.json_text(p_payload jsonb, p_path text[], p_min integer, p_max integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(p_payload #> p_path) IS DISTINCT FROM 'string'
     OR char_length(btrim(p_payload #>> p_path)) NOT BETWEEN p_min AND p_max
     OR (p_payload #>> p_path) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:%', array_to_string(p_path, '.');
  END IF;
  RETURN p_payload #>> p_path;
END;
$$;

-- Liste fermée du contenu signable (arbitrage CTO 11) : aucun profil ne peut en
-- retirer un champ.
CREATE FUNCTION payables_private.signable_fields()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT ARRAY['account','cheque_number','currency','beneficiary','amount_figures','amount_words','issue_date','place']
$$;

CREATE FUNCTION payables_private.validate_parameter_payload(p_kind text, p_subject text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_field text; v_categories jsonb; v_item jsonb; v_signable text[];
BEGIN
  IF p_kind = 'SIGNATORY' THEN
    IF jsonb_typeof(p_payload->'person_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'account_registry_id') IS DISTINCT FROM 'string'
       OR p_subject <> (p_payload->>'person_id') || '|' || (p_payload->>'account_registry_id') THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:subject';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.payables_persons p
                   WHERE p.id::text = p_payload->>'person_id' AND p.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'PAYABLES_PERSON_NOT_ACTIVE';
    END IF;
    PERFORM payables_private.require_account((p_payload->>'account_registry_id')::uuid);
    IF coalesce(p_payload->>'state', '') NOT IN ('ACTIVE','PENDING_CONFIRMATION','SUSPENDED','REVOKED') THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:state';
    END IF;
    v_categories := p_payload->'categories';
    IF jsonb_typeof(v_categories) IS DISTINCT FROM 'array' OR jsonb_array_length(v_categories) = 0 THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:categories';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_categories) LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'string' OR NOT (v_item #>> '{}' = '*' OR v_item #>> '{}' ~ '^[A-Z0-9_]{2,32}$') THEN
        RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:categories';
      END IF;
    END LOOP;
    IF coalesce(p_payload #>> '{ceiling,kind}', '') = 'AMOUNT' THEN
      PERFORM payables_private.json_number(p_payload, ARRAY['ceiling','amount'], 1, 999999999999);
      IF (p_payload #>> '{ceiling,amount}')::numeric <> trunc((p_payload #>> '{ceiling,amount}')::numeric) THEN
        RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:ceiling.amount';
      END IF;
    ELSIF coalesce(p_payload #>> '{ceiling,kind}', '') NOT IN ('UNLIMITED','ABSENT') THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:ceiling';
    END IF;
  ELSIF p_kind = 'SIGNATURE_RULE' THEN
    IF coalesce(p_payload->>'account_registry_id', '') <> p_subject THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:subject';
    END IF;
    PERFORM payables_private.require_account(p_subject::uuid);
    PERFORM payables_private.json_number(p_payload, ARRAY['required_signatures'], 1, 3);
    IF (p_payload->>'required_signatures')::numeric <> trunc((p_payload->>'required_signatures')::numeric) THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:required_signatures';
    END IF;
  ELSIF p_kind = 'CATEGORY' THEN
    IF p_subject !~ '^[A-Z0-9_]{2,32}$' OR coalesce(p_payload->>'code', '') <> p_subject THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:code';
    END IF;
    PERFORM payables_private.json_text(p_payload, ARRAY['label'], 2, 80);
    IF coalesce(p_payload->>'state', '') NOT IN ('ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:state';
    END IF;
  ELSIF p_kind = 'PRINT_PROFILE' THEN
    IF p_subject !~ '^[A-Z0-9_]{3,40}$' OR coalesce(p_payload->>'profile_code', '') <> p_subject THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:profile_code';
    END IF;
    -- Seul le profil ORABANK est ouvert dans ce lot ; aucun repli d'une autre banque.
    IF coalesce(p_payload->>'bank', '') <> 'ORA' THEN
      RAISE EXCEPTION 'PAYABLES_PRINT_PROFILE_BANK_NOT_ENABLED';
    END IF;
    IF coalesce(p_payload->>'state', '') NOT IN ('ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:state';
    END IF;
    PERFORM payables_private.json_number(p_payload, ARRAY['page','width_mm'], 50, 300);
    PERFORM payables_private.json_number(p_payload, ARRAY['page','height_mm'], 30, 300);
    PERFORM payables_private.json_number(p_payload, ARRAY['font','size_pt'], 6, 16);
    PERFORM payables_private.json_text(p_payload, ARRAY['font','family'], 2, 60);
    PERFORM payables_private.json_number(p_payload, ARRAY['offset','x_mm'], -20, 20);
    PERFORM payables_private.json_number(p_payload, ARRAY['offset','y_mm'], -20, 20);
    FOREACH v_field IN ARRAY ARRAY['beneficiary','amount_figures','amount_words','issue_date','place'] LOOP
      PERFORM payables_private.json_number(p_payload, ARRAY['fields', v_field, 'x_mm'], 0, 300);
      PERFORM payables_private.json_number(p_payload, ARRAY['fields', v_field, 'y_mm'], 0, 300);
      PERFORM payables_private.json_number(p_payload, ARRAY['fields', v_field, 'max_chars'], 4, 120);
    END LOOP;
    PERFORM payables_private.json_number(p_payload, ARRAY['fields','amount_words','lines'], 1, 3);
    PERFORM payables_private.json_number(p_payload, ARRAY['fields','amount_words','line_gap_mm'], 2, 15);
    PERFORM payables_private.json_text(p_payload, ARRAY['place_label'], 2, 40);
    PERFORM payables_private.json_text(p_payload, ARRAY['amount_words_suffix'], 2, 30);
    PERFORM payables_private.json_text(p_payload, ARRAY['printer_model'], 2, 80);
    IF coalesce(p_payload->>'amount_words_case', '') NOT IN ('UPPER','AS_IS') THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:amount_words_case';
    END IF;
    IF jsonb_typeof(p_payload->'signable_fields') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID:signable_fields';
    END IF;
    SELECT array_agg(value ORDER BY value) INTO v_signable FROM jsonb_array_elements_text(p_payload->'signable_fields');
    IF v_signable IS DISTINCT FROM (SELECT array_agg(f ORDER BY f) FROM unnest(payables_private.signable_fields()) f) THEN
      RAISE EXCEPTION 'PAYABLES_PRINT_PROFILE_SIGNABLE_FIELDS_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION 'PAYABLES_PARAMETER_KIND_UNKNOWN';
  END IF;
END;
$$;

-- Contenu signable d'une formule : construit uniquement par le serveur, contrôlé
-- contre les capacités de mise en page du profil (aucun débordement imprimé).
CREATE FUNCTION payables_private.build_cheque_content(
  p_form public.payables_cheque_forms, p_payment public.payables_payments,
  p_profile public.payables_parameter_versions, p_issue_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_words text; v_figures text; v_date_text text; v_place text; v_lines text[];
BEGIN
  IF p_issue_date IS NULL THEN RAISE EXCEPTION 'PAYABLES_PRINTED_DATE_REQUIRED'; END IF;
  v_words := payables_private.amount_in_words_fr(p_payment.amount) || ' ' || (p_profile.payload->>'amount_words_suffix');
  IF p_profile.payload->>'amount_words_case' = 'UPPER' THEN v_words := upper(v_words); END IF;
  v_figures := payables_private.group_digits(p_payment.amount);
  v_date_text := to_char(p_issue_date, 'DD/MM/YYYY');
  v_place := p_profile.payload->>'place_label';
  IF char_length(p_payment.beneficiary) > (p_profile.payload #>> '{fields,beneficiary,max_chars}')::integer
     OR char_length(v_figures) > (p_profile.payload #>> '{fields,amount_figures,max_chars}')::integer
     OR char_length(v_date_text) > (p_profile.payload #>> '{fields,issue_date,max_chars}')::integer
     OR char_length(v_place) > (p_profile.payload #>> '{fields,place,max_chars}')::integer THEN
    RAISE EXCEPTION 'PAYABLES_PRINT_LAYOUT_OVERFLOW';
  END IF;
  v_lines := payables_private.wrap_words(v_words, (p_profile.payload #>> '{fields,amount_words,max_chars}')::integer);
  IF v_lines IS NULL OR cardinality(v_lines) > (p_profile.payload #>> '{fields,amount_words,lines}')::integer THEN
    RAISE EXCEPTION 'PAYABLES_PRINT_LAYOUT_OVERFLOW';
  END IF;
  RETURN jsonb_build_object(
    'account', p_form.bank_account_id,
    'cheque_number', p_form.cheque_number,
    'currency', p_payment.currency,
    'beneficiary', p_payment.beneficiary,
    'amount', p_payment.amount::bigint::text,
    'amount_figures', v_figures,
    'amount_words', v_words,
    'amount_words_lines', to_jsonb(v_lines),
    'issue_date', p_issue_date,
    'issue_date_text', v_date_text,
    'place', v_place,
    'profile_code', p_profile.subject_key,
    'profile_version_id', p_profile.id);
END;
$$;

CREATE FUNCTION payables_private.insert_content(
  p_actor uuid, p_form public.payables_cheque_forms, p_fields jsonb, p_profile uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_id uuid; v_version integer;
BEGIN
  SELECT coalesce(max(c.version_no), 0) + 1 INTO v_version
  FROM public.payables_cheque_contents c WHERE c.form_id = p_form.id;
  INSERT INTO public.payables_cheque_contents (form_id, version_no, fields, content_hash, profile_version_id, created_by)
  VALUES (p_form.id, v_version, p_fields, payables_private.payload_hash(p_fields), p_profile, p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION payables_private.current_content(p_form uuid)
RETURNS public.payables_cheque_contents
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c.* FROM public.payables_cheque_contents c WHERE c.form_id = p_form ORDER BY c.version_no DESC LIMIT 1
$$;

CREATE FUNCTION payables_private.current_issuance(p_form uuid)
RETURNS public.payables_issuances
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT i.* FROM public.payables_issuances i WHERE i.form_id = p_form ORDER BY i.revision_no DESC LIMIT 1
$$;

-- Profil d'impression utilisable : version VALIDÉE en vigueur, état ACTIVE,
-- banque identique à celle du compte (aucun repli).
CREATE FUNCTION payables_private.usable_print_profile(p_code text, p_bank text)
RETURNS public.payables_parameter_versions
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v public.payables_parameter_versions;
BEGIN
  v := payables_private.effective_parameter('PRINT_PROFILE', p_code, payables_private.today());
  IF v.id IS NULL OR v.payload->>'state' <> 'ACTIVE' OR v.payload->>'bank' <> p_bank THEN
    RAISE EXCEPTION 'PAYABLES_PRINT_PROFILE_NOT_VALIDATED';
  END IF;
  RETURN v;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Amorçage opérateur de la gouvernance (jamais exposé à l'API)
-- --------------------------------------------------------------------------
-- Première attribution des capacités de paramétrage à deux personnes
-- distinctes, sous GO d'environnement : exécutée par l'opérateur base de
-- données. Refusée dès qu'une capacité de paramétrage existe déjà.
CREATE FUNCTION payables_private.bootstrap_parameter_governance(p_user_a uuid, p_user_b uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_user uuid; v_cap text; v_corr uuid := gen_random_uuid();
BEGIN
  IF p_user_a IS NULL OR p_user_b IS NULL OR p_user_a = p_user_b THEN
    RAISE EXCEPTION 'PAYABLES_BOOTSTRAP_TWO_DISTINCT_USERS_REQUIRED';
  END IF;
  PERFORM payables_private.safe_text(p_reason, 'REASON', 8, 240);
  IF EXISTS (SELECT 1 FROM public.payables_capability_grants g
             WHERE g.capability IN ('PARAM_PROPOSE','PARAM_VALIDATE')) THEN
    RAISE EXCEPTION 'PAYABLES_BOOTSTRAP_ALREADY_DONE';
  END IF;
  FOREACH v_user IN ARRAY ARRAY[p_user_a, p_user_b] LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user) THEN RAISE EXCEPTION 'PAYABLES_USER_UNKNOWN'; END IF;
    FOREACH v_cap IN ARRAY ARRAY['PARAM_PROPOSE','PARAM_VALIDATE','READ'] LOOP
      INSERT INTO public.payables_capability_grants (user_id, capability, action, origin, status, decision_seq, reason, decided_at)
      VALUES (v_user, v_cap, 'GRANT', 'BOOTSTRAP', 'VALIDATED', nextval('payables_private.decision_seq'), p_reason, statement_timestamp());
    END LOOP;
    PERFORM payables_private.append_event(NULL, 'BOOTSTRAP_GOVERNANCE', 'CAPABILITY_BOOTSTRAPPED',
      'USER', v_user, v_corr, p_reason, NULL, jsonb_build_object('session_actor', session_user));
  END LOOP;
END;
$$;

COMMENT ON FUNCTION payables_private.bootstrap_parameter_governance(uuid, uuid, text) IS
  'Opérateur uniquement, sous GO d''environnement : attribue PARAM_PROPOSE, PARAM_VALIDATE et READ à deux utilisateurs distincts, une seule fois.';

-- --------------------------------------------------------------------------
-- 6. API : gouvernance (capacités, personnes, rattachements, paramètres)
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_propose_capability_v1(
  p_command_key text, p_user_id uuid, p_capability text, p_action text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'PROPOSE_CAPABILITY';
  v_replay jsonb; v_id uuid; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'PARAM_PROPOSE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'user_id', p_user_id, 'capability', p_capability, 'action', p_action, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  IF p_capability NOT IN ('READ','AUDIT','INVOICE_MANAGE','SUPPLIER_MANAGE','SUPPLIER_MERGE_VALIDATE',
       'CHEQUE_PREPARE_PRINT','CHEQUE_CONFIRM_ISSUE','TRANSFER_DECLARE','EXIT_REQUEST','EXIT_VALIDATE',
       'BANK_FOLLOWUP','BANK_READ','EXCEPTION_INSTRUCT','PARAM_PROPOSE','PARAM_VALIDATE') OR p_capability IS NULL THEN
    RAISE EXCEPTION 'PAYABLES_CAPABILITY_UNKNOWN';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('GRANT','REVOKE') THEN RAISE EXCEPTION 'PAYABLES_ACTION_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN RAISE EXCEPTION 'PAYABLES_USER_UNKNOWN'; END IF;
  IF p_user_id = v_actor THEN RAISE EXCEPTION 'PAYABLES_SELF_GRANT_FORBIDDEN'; END IF;
  IF EXISTS (SELECT 1 FROM public.payables_capability_grants g
             WHERE g.user_id = p_user_id AND g.capability = p_capability AND g.status = 'PROPOSED') THEN
    RAISE EXCEPTION 'PAYABLES_PROPOSAL_ALREADY_PENDING';
  END IF;
  INSERT INTO public.payables_capability_grants (user_id, capability, action, proposed_by, reason)
  VALUES (p_user_id, p_capability, p_action, v_actor, v_reason) RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'CAPABILITY_PROPOSED', 'CAPABILITY_GRANT', v_id,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('capability', p_capability, 'action', p_action, 'user_id', p_user_id));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('proposal_id', v_id));
END;
$$;

CREATE FUNCTION public.payables_decide_capability_v1(
  p_command_key text, p_proposal_id uuid, p_approve boolean, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'DECIDE_CAPABILITY';
  v_replay jsonb; v_row public.payables_capability_grants; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'PARAM_VALIDATE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'proposal_id', p_proposal_id, 'approve', p_approve, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_row FROM public.payables_capability_grants WHERE id = p_proposal_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'PROPOSED' THEN RAISE EXCEPTION 'PAYABLES_PROPOSAL_STATE_INVALID'; END IF;
  IF v_row.proposed_by = v_actor THEN RAISE EXCEPTION 'PAYABLES_SECOND_ACTOR_REQUIRED'; END IF;
  IF v_row.user_id = v_actor THEN RAISE EXCEPTION 'PAYABLES_SELF_GRANT_FORBIDDEN'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'PAYABLES_DECISION_REQUIRED'; END IF;
  UPDATE public.payables_capability_grants
     SET status = CASE WHEN p_approve THEN 'VALIDATED' ELSE 'REJECTED' END,
         decided_by = v_actor, decided_at = statement_timestamp(), decision_reason = v_reason,
         decision_seq = CASE WHEN p_approve THEN nextval('payables_private.decision_seq') END
   WHERE id = p_proposal_id;
  PERFORM payables_private.append_event(v_actor, v_cmd,
    CASE WHEN p_approve THEN 'CAPABILITY_VALIDATED' ELSE 'CAPABILITY_REJECTED' END,
    'CAPABILITY_GRANT', p_proposal_id, gen_random_uuid(), v_reason, NULL,
    jsonb_build_object('capability', v_row.capability, 'action', v_row.action, 'user_id', v_row.user_id));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('proposal_id', p_proposal_id, 'status', CASE WHEN p_approve THEN 'VALIDATED' ELSE 'REJECTED' END));
END;
$$;

CREATE FUNCTION public.payables_propose_person_v1(p_command_key text, p_display_name text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'PROPOSE_PERSON';
  v_replay jsonb; v_id uuid; v_name text; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'PARAM_PROPOSE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key,
    jsonb_build_object('display_name', p_display_name, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_name := payables_private.safe_text(p_display_name, 'DISPLAY_NAME', 2, 120);
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  INSERT INTO public.payables_persons (display_name, proposed_by, reason)
  VALUES (v_name, v_actor, v_reason) RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PERSON_PROPOSED', 'PERSON', v_id, gen_random_uuid(), v_reason);
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('person_id', v_id));
END;
$$;

CREATE FUNCTION public.payables_decide_person_v1(p_command_key text, p_person_id uuid, p_approve boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'DECIDE_PERSON';
  v_replay jsonb; v_row public.payables_persons; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'PARAM_VALIDATE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key,
    jsonb_build_object('person_id', p_person_id, 'approve', p_approve, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_row FROM public.payables_persons WHERE id = p_person_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'PROPOSED' THEN RAISE EXCEPTION 'PAYABLES_PROPOSAL_STATE_INVALID'; END IF;
  IF v_row.proposed_by = v_actor THEN RAISE EXCEPTION 'PAYABLES_SECOND_ACTOR_REQUIRED'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'PAYABLES_DECISION_REQUIRED'; END IF;
  UPDATE public.payables_persons
     SET status = CASE WHEN p_approve THEN 'ACTIVE' ELSE 'REJECTED' END, decided_by = v_actor,
         decided_at = statement_timestamp(), decision_reason = v_reason, row_version = row_version + 1
   WHERE id = p_person_id;
  PERFORM payables_private.append_event(v_actor, v_cmd,
    CASE WHEN p_approve THEN 'PERSON_ACTIVATED' ELSE 'PERSON_REJECTED' END, 'PERSON', p_person_id, gen_random_uuid(), v_reason);
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('person_id', p_person_id, 'status', CASE WHEN p_approve THEN 'ACTIVE' ELSE 'REJECTED' END));
END;
$$;

CREATE FUNCTION public.payables_propose_person_link_v1(
  p_command_key text, p_person_id uuid, p_user_id uuid, p_action text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'PROPOSE_PERSON_LINK';
  v_replay jsonb; v_id uuid; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'PARAM_PROPOSE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'person_id', p_person_id, 'user_id', p_user_id, 'action', p_action, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  IF p_action IS NULL OR p_action NOT IN ('LINK','UNLINK') THEN RAISE EXCEPTION 'PAYABLES_ACTION_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payables_persons p WHERE p.id = p_person_id AND p.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'PAYABLES_PERSON_NOT_ACTIVE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN RAISE EXCEPTION 'PAYABLES_USER_UNKNOWN'; END IF;
  IF p_user_id = v_actor THEN RAISE EXCEPTION 'PAYABLES_SELF_GRANT_FORBIDDEN'; END IF;
  IF EXISTS (SELECT 1 FROM public.payables_person_links l
             WHERE l.status = 'PROPOSED' AND (l.user_id = p_user_id OR l.person_id = p_person_id)) THEN
    RAISE EXCEPTION 'PAYABLES_PROPOSAL_ALREADY_PENDING';
  END IF;
  INSERT INTO public.payables_person_links (person_id, user_id, action, proposed_by, reason)
  VALUES (p_person_id, p_user_id, p_action, v_actor, v_reason) RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PERSON_LINK_PROPOSED', 'PERSON_LINK', v_id,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('person_id', p_person_id, 'user_id', p_user_id, 'action', p_action));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('link_id', v_id));
END;
$$;

CREATE FUNCTION public.payables_decide_person_link_v1(p_command_key text, p_link_id uuid, p_approve boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'DECIDE_PERSON_LINK';
  v_replay jsonb; v_row public.payables_person_links; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'PARAM_VALIDATE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key,
    jsonb_build_object('link_id', p_link_id, 'approve', p_approve, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_row FROM public.payables_person_links WHERE id = p_link_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'PROPOSED' THEN RAISE EXCEPTION 'PAYABLES_PROPOSAL_STATE_INVALID'; END IF;
  IF v_row.proposed_by = v_actor THEN RAISE EXCEPTION 'PAYABLES_SECOND_ACTOR_REQUIRED'; END IF;
  IF v_row.user_id = v_actor THEN RAISE EXCEPTION 'PAYABLES_SELF_GRANT_FORBIDDEN'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'PAYABLES_DECISION_REQUIRED'; END IF;
  IF p_approve THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('payables:person-link', 0));
    IF v_row.action = 'LINK' AND (payables_private.person_of_user(v_row.user_id) IS NOT NULL
                                  OR payables_private.user_of_person(v_row.person_id) IS NOT NULL) THEN
      RAISE EXCEPTION 'PAYABLES_LINK_CONFLICT';
    END IF;
    IF v_row.action = 'UNLINK' AND payables_private.person_of_user(v_row.user_id) IS DISTINCT FROM v_row.person_id THEN
      RAISE EXCEPTION 'PAYABLES_LINK_STATE_INVALID';
    END IF;
  END IF;
  UPDATE public.payables_person_links
     SET status = CASE WHEN p_approve THEN 'VALIDATED' ELSE 'REJECTED' END, decided_by = v_actor,
         decided_at = statement_timestamp(), decision_reason = v_reason,
         decision_seq = CASE WHEN p_approve THEN nextval('payables_private.decision_seq') END
   WHERE id = p_link_id;
  PERFORM payables_private.append_event(v_actor, v_cmd,
    CASE WHEN p_approve THEN 'PERSON_LINK_VALIDATED' ELSE 'PERSON_LINK_REJECTED' END, 'PERSON_LINK', p_link_id,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('person_id', v_row.person_id, 'user_id', v_row.user_id, 'action', v_row.action));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('link_id', p_link_id, 'status', CASE WHEN p_approve THEN 'VALIDATED' ELSE 'REJECTED' END));
END;
$$;

CREATE FUNCTION public.payables_propose_parameter_v1(
  p_command_key text, p_kind text, p_subject_key text, p_valid_from date, p_payload jsonb,
  p_evidence_ref text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'PROPOSE_PARAMETER';
  v_replay jsonb; v_id uuid; v_version integer; v_reason text; v_evidence text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'PARAM_PROPOSE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'kind', p_kind, 'subject_key', p_subject_key, 'valid_from', p_valid_from, 'payload', p_payload,
    'evidence_ref', p_evidence_ref, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  IF p_valid_from IS NULL THEN RAISE EXCEPTION 'PAYABLES_VALID_FROM_REQUIRED'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID'; END IF;
  PERFORM payables_private.validate_parameter_payload(p_kind, p_subject_key, p_payload);
  IF p_kind IN ('SIGNATORY','PRINT_PROFILE') OR p_evidence_ref IS NOT NULL THEN
    v_evidence := payables_private.safe_text(p_evidence_ref, 'EVIDENCE', 2, 200);
  END IF;
  -- Personne ne s'inscrit comme signataire.
  IF p_kind = 'SIGNATORY' AND payables_private.person_of_user(v_actor)::text = p_payload->>'person_id' THEN
    RAISE EXCEPTION 'PAYABLES_SELF_GRANT_FORBIDDEN';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:param:' || p_kind || ':' || p_subject_key, 0));
  IF EXISTS (SELECT 1 FROM public.payables_parameter_versions v
             WHERE v.kind = p_kind AND v.subject_key = p_subject_key AND v.status = 'PROPOSED') THEN
    RAISE EXCEPTION 'PAYABLES_PROPOSAL_ALREADY_PENDING';
  END IF;
  SELECT coalesce(max(v.version_no), 0) + 1 INTO v_version
  FROM public.payables_parameter_versions v WHERE v.kind = p_kind AND v.subject_key = p_subject_key;
  INSERT INTO public.payables_parameter_versions (kind, subject_key, version_no, valid_from, payload,
    evidence_ref, proposed_by, reason)
  VALUES (p_kind, p_subject_key, v_version, p_valid_from, p_payload, v_evidence, v_actor, v_reason)
  RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PARAMETER_PROPOSED', 'PARAMETER_VERSION', v_id,
    gen_random_uuid(), v_reason, p_valid_from, jsonb_build_object('kind', p_kind, 'version_no', v_version));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('version_id', v_id, 'version_no', v_version));
END;
$$;

CREATE FUNCTION public.payables_decide_parameter_v1(p_command_key text, p_version_id uuid, p_approve boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'DECIDE_PARAMETER';
  v_replay jsonb; v_row public.payables_parameter_versions; v_reason text; v_latest date;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'PARAM_VALIDATE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key,
    jsonb_build_object('version_id', p_version_id, 'approve', p_approve, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_row FROM public.payables_parameter_versions WHERE id = p_version_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'PROPOSED' THEN RAISE EXCEPTION 'PAYABLES_PROPOSAL_STATE_INVALID'; END IF;
  IF v_row.proposed_by = v_actor THEN RAISE EXCEPTION 'PAYABLES_SECOND_ACTOR_REQUIRED'; END IF;
  IF v_row.kind = 'SIGNATORY' AND payables_private.person_of_user(v_actor)::text = v_row.payload->>'person_id' THEN
    RAISE EXCEPTION 'PAYABLES_SELF_GRANT_FORBIDDEN';
  END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'PAYABLES_DECISION_REQUIRED'; END IF;
  IF p_approve THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('payables:param:' || v_row.kind || ':' || v_row.subject_key, 0));
    SELECT max(v.valid_from) INTO v_latest FROM public.payables_parameter_versions v
    WHERE v.kind = v_row.kind AND v.subject_key = v_row.subject_key AND v.status = 'VALIDATED';
    IF v_latest IS NOT NULL AND v_row.valid_from <= v_latest THEN RAISE EXCEPTION 'PAYABLES_VALIDITY_OVERLAP'; END IF;
    -- Revalidation au moment de la décision (personne active, compte actif…).
    PERFORM payables_private.validate_parameter_payload(v_row.kind, v_row.subject_key, v_row.payload);
  END IF;
  UPDATE public.payables_parameter_versions
     SET status = CASE WHEN p_approve THEN 'VALIDATED' ELSE 'REJECTED' END, decided_by = v_actor,
         decided_at = statement_timestamp(), decision_reason = v_reason,
         decision_seq = CASE WHEN p_approve THEN nextval('payables_private.decision_seq') END
   WHERE id = p_version_id;
  PERFORM payables_private.append_event(v_actor, v_cmd,
    CASE WHEN p_approve THEN 'PARAMETER_VALIDATED' ELSE 'PARAMETER_REJECTED' END, 'PARAMETER_VERSION',
    p_version_id, gen_random_uuid(), v_reason, v_row.valid_from,
    jsonb_build_object('kind', v_row.kind, 'version_no', v_row.version_no));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('version_id', p_version_id, 'status', CASE WHEN p_approve THEN 'VALIDATED' ELSE 'REJECTED' END));
END;
$$;

-- --------------------------------------------------------------------------
-- 7. API : fournisseurs et factures
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_create_supplier_v1(p_command_key text, p_name text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'CREATE_SUPPLIER';
  v_replay jsonb; v_id uuid; v_name text; v_norm text; v_reason text; v_existing uuid;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'SUPPLIER_MANAGE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object('name', p_name, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_name := payables_private.safe_text(p_name, 'SUPPLIER_NAME', 2, 160);
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  v_norm := payables_private.normalize_name(v_name);
  IF v_norm = '' THEN RAISE EXCEPTION 'PAYABLES_SUPPLIER_NAME_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:supplier:' || v_norm, 0));
  SELECT s.id INTO v_existing FROM public.payables_suppliers s WHERE s.normalized_name = v_norm AND s.status = 'ACTIVE';
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'PAYABLES_SUPPLIER_DUPLICATE'; END IF;
  INSERT INTO public.payables_suppliers (canonical_name, normalized_name, created_by)
  VALUES (v_name, v_norm, v_actor) RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'SUPPLIER_CREATED', 'SUPPLIER', v_id, gen_random_uuid(), v_reason);
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('supplier_id', v_id));
END;
$$;

-- Applique une fusion déjà contrôlée ; détecte d'abord les collisions de
-- factures (même référence chez le fournisseur conservé). Avec anomalie, la
-- fusion n'est PAS appliquée (arbitrage CTO 4).
CREATE FUNCTION payables_private.try_apply_supplier_merge(p_actor uuid, p_merge public.payables_supplier_merges, p_command text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_pair record; v_count integer := 0; v_corr uuid := gen_random_uuid();
BEGIN
  FOR v_pair IN
    SELECT a.id AS absorbed_invoice, k.id AS kept_invoice
    FROM public.payables_invoices a
    JOIN public.payables_invoices k
      ON k.supplier_id = p_merge.kept_id AND k.reference_exact = a.reference_exact
    WHERE a.supplier_id = p_merge.absorbed_id
    ORDER BY a.id, k.id
  LOOP
    v_count := v_count + 1;
    PERFORM payables_private.open_exception(p_actor, 'MERGE_COLLISION', 'Collision de références révélée par une fusion',
      v_pair.absorbed_invoice, NULL, NULL, NULL, true, false,
      jsonb_build_object('other_invoice_id', v_pair.kept_invoice), p_merge.id);
    PERFORM payables_private.open_exception(p_actor, 'MERGE_COLLISION', 'Collision de références révélée par une fusion',
      v_pair.kept_invoice, NULL, NULL, NULL, true, false,
      jsonb_build_object('other_invoice_id', v_pair.absorbed_invoice), p_merge.id);
  END LOOP;
  IF v_count > 0 THEN
    UPDATE public.payables_supplier_merges
       SET status = 'PENDING_INSTRUCTION', collision_count = v_count, row_version = row_version + 1
     WHERE id = p_merge.id;
    PERFORM payables_private.append_event(p_actor, p_command, 'SUPPLIER_MERGE_PENDING_INSTRUCTION', 'SUPPLIER_MERGE',
      p_merge.id, v_corr, 'Fusion non appliquée : collisions à instruire', NULL, jsonb_build_object('collisions', v_count));
    RETURN 'PENDING_INSTRUCTION';
  END IF;
  UPDATE public.payables_invoices SET supplier_id = p_merge.kept_id, updated_at = statement_timestamp(),
         row_version = row_version + 1
   WHERE supplier_id = p_merge.absorbed_id;
  UPDATE public.payables_suppliers SET status = 'MERGED', merged_into_id = p_merge.kept_id,
         updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = p_merge.absorbed_id;
  UPDATE public.payables_supplier_merges SET status = 'APPLIED', row_version = row_version + 1 WHERE id = p_merge.id;
  PERFORM payables_private.append_event(p_actor, p_command, 'SUPPLIER_MERGE_APPLIED', 'SUPPLIER_MERGE', p_merge.id, v_corr,
    'Fusion appliquée', NULL, jsonb_build_object('absorbed_id', p_merge.absorbed_id, 'kept_id', p_merge.kept_id));
  RETURN 'APPLIED';
END;
$$;

CREATE FUNCTION public.payables_propose_supplier_merge_v1(p_command_key text, p_absorbed_id uuid, p_kept_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'PROPOSE_SUPPLIER_MERGE';
  v_replay jsonb; v_reason text; v_touches boolean; v_merge public.payables_supplier_merges; v_outcome text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'SUPPLIER_MANAGE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key,
    jsonb_build_object('absorbed_id', p_absorbed_id, 'kept_id', p_kept_id, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  IF p_absorbed_id IS NULL OR p_kept_id IS NULL OR p_absorbed_id = p_kept_id THEN RAISE EXCEPTION 'PAYABLES_MERGE_INVALID'; END IF;
  PERFORM 1 FROM public.payables_suppliers s WHERE s.id IN (p_absorbed_id, p_kept_id) ORDER BY s.id FOR UPDATE;
  IF (SELECT count(*) FROM public.payables_suppliers s WHERE s.id IN (p_absorbed_id, p_kept_id) AND s.status = 'ACTIVE') <> 2 THEN
    RAISE EXCEPTION 'PAYABLES_MERGE_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payables_supplier_merges m
             WHERE m.status IN ('PROPOSED','PENDING_INSTRUCTION') AND (m.absorbed_id IN (p_absorbed_id, p_kept_id)
                   OR m.kept_id IN (p_absorbed_id, p_kept_id))) THEN
    RAISE EXCEPTION 'PAYABLES_PROPOSAL_ALREADY_PENDING';
  END IF;
  -- Synchronisation avec les engagements : toute création ou modification
  -- d'allocation verrouille sa facture ; les factures du fournisseur absorbé
  -- sont donc verrouillées AVANT d'évaluer les engagements (ordre fixe
  -- fournisseur → facture). Une réservation en cours est attendue, jamais ignorée.
  PERFORM 1 FROM public.payables_invoices i WHERE i.supplier_id = p_absorbed_id ORDER BY i.id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM public.payables_allocations a JOIN public.payables_invoices i ON i.id = a.invoice_id
                 WHERE i.supplier_id = p_absorbed_id AND a.status IN ('RESERVED','ENGAGED')) INTO v_touches;
  INSERT INTO public.payables_supplier_merges (absorbed_id, kept_id, status, touches_engagements, proposed_by, reason)
  VALUES (p_absorbed_id, p_kept_id, 'PROPOSED', v_touches, v_actor, v_reason) RETURNING * INTO v_merge;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'SUPPLIER_MERGE_PROPOSED', 'SUPPLIER_MERGE', v_merge.id,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('touches_engagements', v_touches));
  IF v_touches THEN
    v_outcome := 'PROPOSED';
  ELSE
    v_outcome := payables_private.try_apply_supplier_merge(v_actor, v_merge, v_cmd);
  END IF;
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('merge_id', v_merge.id, 'outcome', v_outcome));
END;
$$;

CREATE FUNCTION public.payables_decide_supplier_merge_v1(p_command_key text, p_merge_id uuid, p_approve boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'DECIDE_SUPPLIER_MERGE';
  v_replay jsonb; v_reason text; v_merge public.payables_supplier_merges; v_outcome text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'SUPPLIER_MERGE_VALIDATE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key,
    jsonb_build_object('merge_id', p_merge_id, 'approve', p_approve, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_merge FROM public.payables_supplier_merges WHERE id = p_merge_id FOR UPDATE;
  IF v_merge.id IS NULL OR v_merge.status <> 'PROPOSED' THEN RAISE EXCEPTION 'PAYABLES_PROPOSAL_STATE_INVALID'; END IF;
  IF v_merge.proposed_by = v_actor THEN RAISE EXCEPTION 'PAYABLES_SECOND_ACTOR_REQUIRED'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'PAYABLES_DECISION_REQUIRED'; END IF;
  PERFORM 1 FROM public.payables_suppliers s WHERE s.id IN (v_merge.absorbed_id, v_merge.kept_id) ORDER BY s.id FOR UPDATE;
  PERFORM 1 FROM public.payables_invoices i WHERE i.supplier_id = v_merge.absorbed_id ORDER BY i.id FOR UPDATE;
  UPDATE public.payables_supplier_merges SET decided_by = v_actor, decided_at = statement_timestamp(),
         decision_reason = v_reason, status = CASE WHEN p_approve THEN status ELSE 'REJECTED' END,
         row_version = row_version + 1
   WHERE id = p_merge_id RETURNING * INTO v_merge;
  IF p_approve THEN
    IF (SELECT count(*) FROM public.payables_suppliers s WHERE s.id IN (v_merge.absorbed_id, v_merge.kept_id) AND s.status = 'ACTIVE') <> 2 THEN
      RAISE EXCEPTION 'PAYABLES_MERGE_INVALID';
    END IF;
    v_outcome := payables_private.try_apply_supplier_merge(v_actor, v_merge, v_cmd);
  ELSE
    v_outcome := 'REJECTED';
    PERFORM payables_private.append_event(v_actor, v_cmd, 'SUPPLIER_MERGE_REJECTED', 'SUPPLIER_MERGE', p_merge_id,
      gen_random_uuid(), v_reason);
  END IF;
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('merge_id', p_merge_id, 'outcome', v_outcome));
END;
$$;

CREATE FUNCTION public.payables_create_invoice_v1(
  p_command_key text, p_supplier_id uuid, p_reference text, p_amount numeric, p_currency text,
  p_invoice_date date, p_due_date date, p_evidence_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'CREATE_INVOICE';
  v_replay jsonb; v_id uuid; v_amount numeric; v_evidence text; v_existing uuid; v_exception uuid; v_status text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'INVOICE_MANAGE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'supplier_id', p_supplier_id, 'reference', p_reference, 'amount', p_amount, 'currency', p_currency,
    'invoice_date', p_invoice_date, 'due_date', p_due_date, 'evidence_ref', p_evidence_ref));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT s.status INTO v_status FROM public.payables_suppliers s WHERE s.id = p_supplier_id FOR SHARE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'PAYABLES_SUPPLIER_UNKNOWN'; END IF;
  IF v_status <> 'ACTIVE' THEN RAISE EXCEPTION 'PAYABLES_SUPPLIER_MERGED'; END IF;
  IF p_reference IS NULL OR char_length(p_reference) NOT BETWEEN 1 AND 80 OR p_reference <> btrim(p_reference)
     OR p_reference ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'PAYABLES_REFERENCE_INVALID';
  END IF;
  v_amount := payables_private.xof_amount(p_amount, 'AMOUNT');
  IF p_currency IS DISTINCT FROM 'XOF' THEN RAISE EXCEPTION 'PAYABLES_CURRENCY_NOT_SUPPORTED'; END IF;
  v_evidence := payables_private.safe_text(p_evidence_ref, 'EVIDENCE', 2, 200);
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:invoice:' || p_supplier_id::text || ':' || p_reference, 0));
  SELECT i.id INTO v_existing FROM public.payables_invoices i
  WHERE i.supplier_id = p_supplier_id AND i.reference_exact = p_reference ORDER BY i.collision_ordinal LIMIT 1;
  IF v_existing IS NOT NULL THEN
    -- Collision instruite, jamais contournée : aucune facture créée.
    v_exception := payables_private.open_exception(v_actor, 'INVOICE_COLLISION',
      'Même fournisseur canonique et même référence', v_existing, NULL, NULL, NULL, false, false,
      jsonb_build_object('candidate', jsonb_build_object('amount', v_amount::bigint::text, 'invoice_date', p_invoice_date,
        'due_date', p_due_date, 'evidence_ref', v_evidence, 'created_by', v_actor)));
    PERFORM payables_private.append_event(v_actor, v_cmd, 'INVOICE_COLLISION_OPENED', 'EXCEPTION', v_exception,
      gen_random_uuid(), 'Collision de facture', NULL, jsonb_build_object('existing_invoice_id', v_existing));
    RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
      'outcome', 'COLLISION', 'exception_id', v_exception, 'existing_invoice_id', v_existing));
  END IF;
  INSERT INTO public.payables_invoices (supplier_id, reference_exact, amount, currency, invoice_date, due_date,
    evidence_ref, created_by)
  VALUES (p_supplier_id, p_reference, v_amount, 'XOF', p_invoice_date, p_due_date, v_evidence, v_actor)
  RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'INVOICE_CREATED', 'INVOICE', v_id, gen_random_uuid(), NULL,
    p_invoice_date, jsonb_build_object('amount', v_amount::bigint::text, 'due_date', p_due_date));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('outcome', 'CREATED', 'invoice_id', v_id));
END;
$$;

CREATE FUNCTION public.payables_correct_invoice_v1(
  p_command_key text, p_invoice_id uuid, p_expected_version integer, p_amount numeric,
  p_invoice_date date, p_due_date date, p_evidence_ref text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'CORRECT_INVOICE';
  v_replay jsonb; v_row public.payables_invoices; v_amount numeric; v_reason text; v_evidence text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'INVOICE_MANAGE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'invoice_id', p_invoice_id, 'expected_version', p_expected_version, 'amount', p_amount,
    'invoice_date', p_invoice_date, 'due_date', p_due_date, 'evidence_ref', p_evidence_ref, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_row FROM public.payables_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_INVOICE_UNKNOWN'; END IF;
  PERFORM payables_private.assert_version(v_row.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('INVOICE', p_invoice_id, v_actor);
  -- Facture bloquée : seule l'instruction de l'exception la débloque.
  IF payables_private.invoice_blocked(p_invoice_id) THEN RAISE EXCEPTION 'PAYABLES_INVOICE_BLOCKED'; END IF;
  -- Aucun changement d'une facture portant un engagement ou une réservation.
  IF payables_private.committed_amount(p_invoice_id, NULL) > 0 THEN
    RAISE EXCEPTION 'PAYABLES_INVOICE_ENGAGED_CHANGE_FORBIDDEN';
  END IF;
  v_amount := payables_private.xof_amount(p_amount, 'AMOUNT');
  v_evidence := payables_private.safe_text(p_evidence_ref, 'EVIDENCE', 2, 200);
  UPDATE public.payables_invoices
     SET amount = v_amount, invoice_date = p_invoice_date, due_date = p_due_date, evidence_ref = v_evidence,
         updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = p_invoice_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'INVOICE_CORRECTED', 'INVOICE', p_invoice_id, gen_random_uuid(),
    v_reason, NULL, jsonb_build_object(
      'before', jsonb_build_object('amount', v_row.amount::bigint::text, 'invoice_date', v_row.invoice_date, 'due_date', v_row.due_date),
      'after', jsonb_build_object('amount', v_amount::bigint::text, 'invoice_date', p_invoice_date, 'due_date', p_due_date)));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('invoice_id', p_invoice_id, 'row_version', v_row.row_version + 1));
END;
$$;

-- --------------------------------------------------------------------------
-- 8. API : demandes de paiement par chèque, contenu signable, impression
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_create_cheque_request_v1(
  p_command_key text, p_invoice_id uuid, p_bank_account_id uuid, p_category_code text,
  p_amount numeric, p_partial boolean, p_beneficiary text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'CREATE_CHEQUE_REQUEST';
  v_replay jsonb; v_invoice public.payables_invoices; v_remaining numeric; v_amount numeric;
  v_payment uuid; v_allocation uuid; v_beneficiary text; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'invoice_id', p_invoice_id, 'bank_account_id', p_bank_account_id, 'category_code', p_category_code,
    'amount', p_amount, 'partial', p_partial, 'beneficiary', p_beneficiary, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  v_beneficiary := payables_private.safe_text(p_beneficiary, 'BENEFICIARY', 2, 120);
  SELECT * INTO v_invoice FROM public.payables_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_INVOICE_UNKNOWN'; END IF;
  PERFORM payables_private.assert_lock_free('INVOICE', p_invoice_id, v_actor);
  IF payables_private.invoice_blocked(p_invoice_id) THEN RAISE EXCEPTION 'PAYABLES_INVOICE_BLOCKED'; END IF;
  PERFORM payables_private.require_account(p_bank_account_id);
  IF p_category_code IS NULL OR NOT payables_private.category_active(p_category_code, payables_private.today()) THEN
    RAISE EXCEPTION 'PAYABLES_CATEGORY_INACTIVE';
  END IF;
  v_remaining := v_invoice.amount - payables_private.committed_amount(p_invoice_id, NULL);
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'PAYABLES_INVOICE_FULLY_ENGAGED'; END IF;
  IF p_partial IS NULL THEN RAISE EXCEPTION 'PAYABLES_PARTIAL_FLAG_REQUIRED'; END IF;
  IF NOT p_partial THEN
    -- Paiement unique par défaut : montant total restant à engager.
    IF p_amount IS NOT NULL AND p_amount <> v_remaining THEN RAISE EXCEPTION 'PAYABLES_PARTIAL_FLAG_REQUIRED'; END IF;
    v_amount := v_remaining;
  ELSE
    v_amount := payables_private.xof_amount(p_amount, 'AMOUNT');
    IF v_amount > v_remaining THEN RAISE EXCEPTION 'PAYABLES_AMOUNT_EXCEEDS_REMAINING'; END IF;
  END IF;
  INSERT INTO public.payables_payments (invoice_id, mode, bank_account_id, category_code, amount, currency,
    is_partial, beneficiary, status, created_by)
  VALUES (p_invoice_id, 'CHEQUE', p_bank_account_id, p_category_code, v_amount, 'XOF', p_partial, v_beneficiary,
    'OPEN', v_actor)
  RETURNING id INTO v_payment;
  INSERT INTO public.payables_allocations (payment_id, invoice_id, amount, status)
  VALUES (v_payment, p_invoice_id, v_amount, 'RESERVED') RETURNING id INTO v_allocation;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'CHEQUE_REQUESTED', 'PAYMENT', v_payment, gen_random_uuid(),
    v_reason, NULL, jsonb_build_object('invoice_id', p_invoice_id, 'amount', v_amount::bigint::text, 'partial', p_partial));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'payment_id', v_payment, 'allocation_id', v_allocation, 'amount', v_amount::bigint::text));
END;
$$;

CREATE FUNCTION public.payables_adjust_payment_v1(
  p_command_key text, p_payment_id uuid, p_expected_version integer, p_amount numeric,
  p_beneficiary text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'ADJUST_PAYMENT';
  v_replay jsonb; v_payment public.payables_payments; v_invoice public.payables_invoices;
  v_form public.payables_cheque_forms; v_content public.payables_cheque_contents;
  v_profile public.payables_parameter_versions; v_ceiling numeric; v_amount numeric; v_beneficiary text;
  v_reason text; v_content_id uuid;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'payment_id', p_payment_id, 'expected_version', p_expected_version, 'amount', p_amount,
    'beneficiary', p_beneficiary, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT i.* INTO v_invoice FROM public.payables_invoices i
    JOIN public.payables_payments p ON p.invoice_id = i.id WHERE p.id = p_payment_id FOR UPDATE OF i;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_UNKNOWN'; END IF;
  SELECT * INTO v_payment FROM public.payables_payments WHERE id = p_payment_id FOR UPDATE;
  PERFORM payables_private.assert_version(v_payment.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('PAYMENT', p_payment_id, v_actor);
  IF v_payment.mode <> 'CHEQUE' OR v_payment.status <> 'OPEN' THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_STATE_INVALID'; END IF;
  IF payables_private.invoice_blocked(v_invoice.id) THEN RAISE EXCEPTION 'PAYABLES_INVOICE_BLOCKED'; END IF;
  SELECT * INTO v_form FROM public.payables_cheque_forms f
   WHERE f.payment_id = p_payment_id AND f.state IN ('ASSIGNED','PRINT_PENDING','PRINTED','PRINT_UNCERTAIN') FOR UPDATE;
  IF v_form.id IS NOT NULL AND v_form.state <> 'ASSIGNED' THEN RAISE EXCEPTION 'PAYABLES_FORM_STATE_INVALID'; END IF;
  v_amount := payables_private.xof_amount(p_amount, 'AMOUNT');
  v_beneficiary := payables_private.safe_text(p_beneficiary, 'BENEFICIARY', 2, 120);
  v_ceiling := v_invoice.amount - payables_private.committed_amount(v_invoice.id, p_payment_id);
  IF v_amount > v_ceiling THEN RAISE EXCEPTION 'PAYABLES_AMOUNT_EXCEEDS_CEILING'; END IF;
  UPDATE public.payables_payments
     SET amount = v_amount, beneficiary = v_beneficiary, is_partial = (v_amount < v_ceiling),
         updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = p_payment_id RETURNING * INTO v_payment;
  UPDATE public.payables_allocations SET amount = v_amount, updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE payment_id = p_payment_id AND status = 'RESERVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYABLES_ALLOCATION_STATE_INVALID'; END IF;
  IF v_form.id IS NOT NULL THEN
    -- Formule assignée non imprimée : nouvelle version du contenu signable.
    v_content := payables_private.current_content(v_form.id);
    SELECT * INTO v_profile FROM public.payables_parameter_versions WHERE id = v_content.profile_version_id;
    v_profile := payables_private.usable_print_profile(v_profile.subject_key,
      (SELECT r.bank FROM public.daily_statement_account_registry r WHERE r.id = v_form.bank_account_id));
    v_content_id := payables_private.insert_content(v_actor, v_form,
      payables_private.build_cheque_content(v_form, v_payment, v_profile, (v_content.fields->>'issue_date')::date), v_profile.id);
    UPDATE public.payables_cheque_forms SET updated_at = statement_timestamp(), row_version = row_version + 1 WHERE id = v_form.id;
  END IF;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PAYMENT_ADJUSTED', 'PAYMENT', p_payment_id, gen_random_uuid(),
    v_reason, NULL, jsonb_build_object('amount', v_amount::bigint::text, 'content_id', v_content_id));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'payment_id', p_payment_id, 'row_version', v_payment.row_version, 'content_id', v_content_id));
END;
$$;

CREATE FUNCTION public.payables_abandon_payment_v1(p_command_key text, p_payment_id uuid, p_expected_version integer, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'ABANDON_PAYMENT';
  v_replay jsonb; v_payment public.payables_payments; v_invoice uuid; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'payment_id', p_payment_id, 'expected_version', p_expected_version, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT i.id INTO v_invoice FROM public.payables_invoices i
    JOIN public.payables_payments p ON p.invoice_id = i.id WHERE p.id = p_payment_id FOR UPDATE OF i;
  IF v_invoice IS NULL THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_UNKNOWN'; END IF;
  SELECT * INTO v_payment FROM public.payables_payments WHERE id = p_payment_id FOR UPDATE;
  PERFORM payables_private.assert_version(v_payment.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('PAYMENT', p_payment_id, v_actor);
  IF v_payment.mode <> 'CHEQUE' OR v_payment.status <> 'OPEN' THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_STATE_INVALID'; END IF;
  -- Libération seulement si toutes les formules du paiement sont assignées non
  -- imprimées ou enregistrées inutilisées : jamais pour une formule imprimée,
  -- au sort incertain, perdue ou détenue pré-signée (encaissement possible).
  IF EXISTS (SELECT 1 FROM public.payables_cheque_forms f
             WHERE f.payment_id = p_payment_id AND f.state NOT IN ('ASSIGNED','UNUSED')) THEN
    RAISE EXCEPTION 'PAYABLES_RELEASE_FORBIDDEN_FORM_UNCERTAIN';
  END IF;
  UPDATE public.payables_cheque_forms
     SET state = 'UNUSED', unused_reason = 'Demande abandonnée avant impression', updated_at = statement_timestamp(),
         row_version = row_version + 1
   WHERE payment_id = p_payment_id AND state = 'ASSIGNED';
  UPDATE public.payables_allocations SET status = 'CANCELLED', updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE payment_id = p_payment_id AND status = 'RESERVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYABLES_ALLOCATION_STATE_INVALID'; END IF;
  UPDATE public.payables_payments SET status = 'ABANDONED', updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = p_payment_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PAYMENT_ABANDONED', 'PAYMENT', p_payment_id, gen_random_uuid(), v_reason);
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('payment_id', p_payment_id, 'status', 'ABANDONED'));
END;
$$;

CREATE FUNCTION public.payables_assign_cheque_form_v1(
  p_command_key text, p_payment_id uuid, p_expected_version integer, p_cheque_number text,
  p_profile_code text, p_printed_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'ASSIGN_CHEQUE_FORM';
  v_replay jsonb; v_invoice public.payables_invoices; v_payment public.payables_payments;
  v_account public.daily_statement_account_registry; v_profile public.payables_parameter_versions;
  v_form public.payables_cheque_forms; v_fields jsonb; v_content uuid;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'payment_id', p_payment_id, 'expected_version', p_expected_version, 'cheque_number', p_cheque_number,
    'profile_code', p_profile_code, 'printed_date', p_printed_date));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT i.* INTO v_invoice FROM public.payables_invoices i
    JOIN public.payables_payments p ON p.invoice_id = i.id WHERE p.id = p_payment_id FOR UPDATE OF i;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_UNKNOWN'; END IF;
  SELECT * INTO v_payment FROM public.payables_payments WHERE id = p_payment_id FOR UPDATE;
  PERFORM payables_private.assert_version(v_payment.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('PAYMENT', p_payment_id, v_actor);
  IF v_payment.mode <> 'CHEQUE' OR v_payment.status <> 'OPEN' THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_STATE_INVALID'; END IF;
  IF payables_private.invoice_blocked(v_invoice.id) THEN RAISE EXCEPTION 'PAYABLES_INVOICE_BLOCKED'; END IF;
  IF v_payment.amount > v_invoice.amount - payables_private.committed_amount(v_invoice.id, p_payment_id) THEN
    RAISE EXCEPTION 'PAYABLES_AMOUNT_EXCEEDS_CEILING';
  END IF;
  IF p_cheque_number IS NULL OR p_cheque_number !~ '^[0-9]{1,16}$' THEN RAISE EXCEPTION 'PAYABLES_CHEQUE_NUMBER_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM public.payables_cheque_forms f WHERE f.payment_id = p_payment_id
             AND f.state IN ('ASSIGNED','PRINT_PENDING','PRINTED','PRINT_UNCERTAIN','ISSUED','CLEARED')) THEN
    RAISE EXCEPTION 'PAYABLES_FORM_ALREADY_ACTIVE';
  END IF;
  v_account := payables_private.require_account(v_payment.bank_account_id);
  v_profile := payables_private.usable_print_profile(p_profile_code, v_account.bank);
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:form:' || v_payment.bank_account_id::text || ':' || p_cheque_number, 0));
  IF EXISTS (SELECT 1 FROM public.payables_cheque_forms f
             WHERE f.bank_account_id = v_payment.bank_account_id AND f.cheque_number = p_cheque_number) THEN
    RAISE EXCEPTION 'PAYABLES_FORM_ALREADY_USED';
  END IF;
  INSERT INTO public.payables_cheque_forms (bank_account_id, cheque_number, payment_id, provenance, state, created_by)
  VALUES (v_payment.bank_account_id, p_cheque_number, p_payment_id, 'NATIVE', 'ASSIGNED', v_actor)
  RETURNING * INTO v_form;
  v_fields := payables_private.build_cheque_content(v_form, v_payment, v_profile, p_printed_date);
  v_content := payables_private.insert_content(v_actor, v_form, v_fields, v_profile.id);
  PERFORM payables_private.append_event(v_actor, v_cmd, 'CHEQUE_FORM_ASSIGNED', 'CHEQUE_FORM', v_form.id, gen_random_uuid(),
    NULL, p_printed_date, jsonb_build_object('payment_id', p_payment_id, 'content_id', v_content));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', v_form.id, 'content_id', v_content, 'form_version', v_form.row_version));
END;
$$;

CREATE FUNCTION public.payables_revise_cheque_content_v1(
  p_command_key text, p_form_id uuid, p_expected_version integer, p_printed_date date, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'REVISE_CHEQUE_CONTENT';
  v_replay jsonb; v_form public.payables_cheque_forms; v_payment public.payables_payments;
  v_content public.payables_cheque_contents; v_profile public.payables_parameter_versions;
  v_content_id uuid; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', p_form_id, 'expected_version', p_expected_version, 'printed_date', p_printed_date, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  PERFORM 1 FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
    JOIN public.payables_cheque_forms f ON f.payment_id = p.id WHERE f.id = p_form_id FOR UPDATE OF i;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = p_form_id FOR UPDATE;
  IF v_form.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_FORM_UNKNOWN'; END IF;
  PERFORM payables_private.assert_version(v_form.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('FORM', p_form_id, v_actor);
  IF v_form.state <> 'ASSIGNED' OR v_form.provenance <> 'NATIVE' THEN RAISE EXCEPTION 'PAYABLES_FORM_STATE_INVALID'; END IF;
  SELECT * INTO v_payment FROM public.payables_payments WHERE id = v_form.payment_id;
  v_content := payables_private.current_content(p_form_id);
  SELECT * INTO v_profile FROM public.payables_parameter_versions WHERE id = v_content.profile_version_id;
  v_profile := payables_private.usable_print_profile(v_profile.subject_key,
    (SELECT r.bank FROM public.daily_statement_account_registry r WHERE r.id = v_form.bank_account_id));
  v_content_id := payables_private.insert_content(v_actor, v_form,
    payables_private.build_cheque_content(v_form, v_payment, v_profile, p_printed_date), v_profile.id);
  UPDATE public.payables_cheque_forms SET updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = p_form_id RETURNING * INTO v_form;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'CHEQUE_CONTENT_REVISED', 'CHEQUE_FORM', p_form_id,
    gen_random_uuid(), v_reason, p_printed_date, jsonb_build_object('content_id', v_content_id));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', p_form_id, 'content_id', v_content_id, 'form_version', v_form.row_version));
END;
$$;

-- Intention d'impression enregistrée AVANT l'impression physique. Le retour
-- navigateur (afterprint) n'est jamais une preuve : le comptable confirme le
-- résultat par payables_record_print_outcome_v1.
CREATE FUNCTION public.payables_record_print_intent_v1(
  p_command_key text, p_form_id uuid, p_expected_version integer, p_content_id uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'RECORD_PRINT_INTENT';
  v_replay jsonb; v_invoice public.payables_invoices; v_form public.payables_cheque_forms;
  v_payment public.payables_payments; v_content public.payables_cheque_contents;
  v_profile public.payables_parameter_versions; v_event uuid; v_kind text; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', p_form_id, 'expected_version', p_expected_version, 'content_id', p_content_id, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 3, 500);
  SELECT i.* INTO v_invoice FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
    JOIN public.payables_cheque_forms f ON f.payment_id = p.id WHERE f.id = p_form_id FOR UPDATE OF i;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_FORM_UNKNOWN'; END IF;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = p_form_id FOR UPDATE;
  PERFORM payables_private.assert_version(v_form.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('FORM', p_form_id, v_actor);
  IF v_form.state <> 'ASSIGNED' OR v_form.provenance <> 'NATIVE' THEN RAISE EXCEPTION 'PAYABLES_FORM_STATE_INVALID'; END IF;
  SELECT * INTO v_payment FROM public.payables_payments WHERE id = v_form.payment_id FOR UPDATE;
  IF v_payment.status <> 'OPEN' THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_STATE_INVALID'; END IF;
  IF payables_private.invoice_blocked(v_invoice.id) THEN RAISE EXCEPTION 'PAYABLES_INVOICE_BLOCKED'; END IF;
  IF v_payment.amount > v_invoice.amount - payables_private.committed_amount(v_invoice.id, v_payment.id) THEN
    RAISE EXCEPTION 'PAYABLES_AMOUNT_EXCEEDS_CEILING';
  END IF;
  v_content := payables_private.current_content(p_form_id);
  IF v_content.id IS DISTINCT FROM p_content_id THEN RAISE EXCEPTION 'PAYABLES_CONTENT_VERSION_STALE'; END IF;
  SELECT * INTO v_profile FROM public.payables_parameter_versions WHERE id = v_content.profile_version_id;
  -- Le profil en vigueur doit être exactement la version ayant produit le contenu.
  IF (payables_private.usable_print_profile(v_profile.subject_key,
        (SELECT r.bank FROM public.daily_statement_account_registry r WHERE r.id = v_form.bank_account_id))).id <> v_profile.id THEN
    RAISE EXCEPTION 'PAYABLES_CONTENT_VERSION_STALE';
  END IF;
  v_kind := CASE WHEN EXISTS (SELECT 1 FROM public.payables_print_events e WHERE e.form_id = p_form_id)
                 THEN 'REPRINT' ELSE 'INITIAL' END;
  INSERT INTO public.payables_print_events (form_id, content_id, profile_version_id, kind, requested_by, reason)
  VALUES (p_form_id, v_content.id, v_profile.id, v_kind, v_actor, v_reason) RETURNING id INTO v_event;
  UPDATE public.payables_cheque_forms SET state = 'PRINT_PENDING', updated_at = statement_timestamp(),
         row_version = row_version + 1
   WHERE id = p_form_id RETURNING * INTO v_form;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PRINT_INTENT_RECORDED', 'CHEQUE_FORM', p_form_id,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('print_event_id', v_event, 'kind', v_kind,
    'content_id', v_content.id, 'profile_version_id', v_profile.id));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'print_event_id', v_event, 'kind', v_kind, 'form_version', v_form.row_version,
    'fields', v_content.fields, 'layout', v_profile.payload, 'profile_version_id', v_profile.id));
END;
$$;

CREATE FUNCTION public.payables_record_print_outcome_v1(
  p_command_key text, p_print_event_id uuid, p_outcome text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'RECORD_PRINT_OUTCOME';
  v_replay jsonb; v_event public.payables_print_events; v_form public.payables_cheque_forms;
  v_state text; v_exception uuid; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'print_event_id', p_print_event_id, 'outcome', p_outcome, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('PRINTED','NOT_PRINTED','SPOILED','UNCERTAIN') THEN
    RAISE EXCEPTION 'PAYABLES_PRINT_OUTCOME_INVALID';
  END IF;
  v_reason := CASE WHEN p_outcome = 'PRINTED' AND p_reason IS NULL THEN NULL
                   ELSE payables_private.safe_text(p_reason, 'REASON', 3, 500) END;
  SELECT * INTO v_event FROM public.payables_print_events WHERE id = p_print_event_id;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_PRINT_EVENT_UNKNOWN'; END IF;
  PERFORM 1 FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
    JOIN public.payables_cheque_forms f ON f.payment_id = p.id WHERE f.id = v_event.form_id FOR UPDATE OF i;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = v_event.form_id FOR UPDATE;
  SELECT * INTO v_event FROM public.payables_print_events WHERE id = p_print_event_id FOR UPDATE;
  IF v_event.status <> 'PENDING' OR v_form.state <> 'PRINT_PENDING' THEN RAISE EXCEPTION 'PAYABLES_PRINT_EVENT_STATE_INVALID'; END IF;
  PERFORM payables_private.assert_lock_free('FORM', v_form.id, v_actor);
  UPDATE public.payables_print_events SET status = p_outcome, outcome_by = v_actor, outcome_at = statement_timestamp(),
         outcome_reason = v_reason
   WHERE id = p_print_event_id;
  v_state := CASE p_outcome WHEN 'PRINTED' THEN 'PRINTED' WHEN 'NOT_PRINTED' THEN 'ASSIGNED'
                            WHEN 'SPOILED' THEN 'UNUSED' ELSE 'PRINT_UNCERTAIN' END;
  UPDATE public.payables_cheque_forms
     SET state = v_state,
         unused_reason = CASE WHEN p_outcome = 'SPOILED' THEN 'Formule gâchée : ' || v_reason ELSE unused_reason END,
         updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = v_form.id RETURNING * INTO v_form;
  IF p_outcome = 'UNCERTAIN' THEN
    v_exception := payables_private.open_exception(v_actor, 'FORM_PRINT_UNCERTAIN', v_reason, NULL, v_form.payment_id,
      v_form.id, v_form.bank_account_id, false, false);
  END IF;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PRINT_OUTCOME_RECORDED', 'CHEQUE_FORM', v_form.id,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('print_event_id', p_print_event_id, 'outcome', p_outcome,
    'exception_id', v_exception));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', v_form.id, 'form_state', v_state, 'form_version', v_form.row_version, 'exception_id', v_exception));
END;
$$;

CREATE FUNCTION public.payables_record_unused_form_v1(p_command_key text, p_form_id uuid, p_expected_version integer, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'RECORD_UNUSED_FORM';
  v_replay jsonb; v_form public.payables_cheque_forms; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', p_form_id, 'expected_version', p_expected_version, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  PERFORM 1 FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
    JOIN public.payables_cheque_forms f ON f.payment_id = p.id WHERE f.id = p_form_id FOR UPDATE OF i;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = p_form_id FOR UPDATE;
  IF v_form.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_FORM_UNKNOWN'; END IF;
  PERFORM payables_private.assert_version(v_form.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('FORM', p_form_id, v_actor);
  -- Formule retrouvée (imprimée non émise, ou assignée) : inutilisée, numéro jamais réaffecté.
  IF v_form.state NOT IN ('ASSIGNED','PRINTED') OR v_form.provenance <> 'NATIVE' THEN
    RAISE EXCEPTION 'PAYABLES_FORM_STATE_INVALID';
  END IF;
  UPDATE public.payables_cheque_forms SET state = 'UNUSED', unused_reason = v_reason, updated_at = statement_timestamp(),
         row_version = row_version + 1
   WHERE id = p_form_id RETURNING * INTO v_form;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'FORM_RECORDED_UNUSED', 'CHEQUE_FORM', p_form_id, gen_random_uuid(), v_reason);
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('form_id', p_form_id, 'form_version', v_form.row_version));
END;
$$;

-- --------------------------------------------------------------------------
-- 9. API : signatures, émission (deux voies exclusives), remise
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_record_signature_v1(
  p_command_key text, p_form_id uuid, p_content_id uuid, p_person_id uuid, p_signed_on date, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'RECORD_SIGNATURE';
  v_replay jsonb; v_form public.payables_cheque_forms; v_content public.payables_cheque_contents; v_id uuid;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_CONFIRM_ISSUE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', p_form_id, 'content_id', p_content_id, 'person_id', p_person_id, 'signed_on', p_signed_on, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = p_form_id FOR UPDATE;
  IF v_form.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_FORM_UNKNOWN'; END IF;
  PERFORM payables_private.assert_lock_free('FORM', p_form_id, v_actor);
  IF v_form.state <> 'PRINTED' THEN RAISE EXCEPTION 'PAYABLES_FORM_STATE_INVALID'; END IF;
  v_content := payables_private.current_content(p_form_id);
  IF v_content.id IS DISTINCT FROM p_content_id THEN RAISE EXCEPTION 'PAYABLES_SIGNATURE_VERSION_MISMATCH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payables_persons p WHERE p.id = p_person_id AND p.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'PAYABLES_SIGNATORY_NOT_ADMISSIBLE';
  END IF;
  PERFORM payables_private.assert_not_future(p_signed_on, 'SIGNED_ON');
  -- Aucune signature antérieure à l'impression de cette version signable : la
  -- borne est l'intention enregistrée juste avant l'impression (le résultat peut
  -- être déclaré plus tard sans décaler la date réelle).
  IF p_signed_on < (SELECT max((e.requested_at AT TIME ZONE 'Africa/Dakar')::date) FROM public.payables_print_events e
                    WHERE e.content_id = p_content_id AND e.status IN ('PRINTED','UNCERTAIN')) THEN
    RAISE EXCEPTION 'PAYABLES_SIGNATURE_BEFORE_PRINT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payables_signatures s WHERE s.content_id = p_content_id AND s.person_id = p_person_id) THEN
    RAISE EXCEPTION 'PAYABLES_SIGNATURE_ALREADY_RECORDED';
  END IF;
  INSERT INTO public.payables_signatures (form_id, content_id, person_id, signed_on, recorded_by, reason)
  VALUES (p_form_id, p_content_id, p_person_id, p_signed_on, v_actor, nullif(btrim(coalesce(p_reason, '')), ''))
  RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'SIGNATURE_RECORDED', 'CHEQUE_FORM', p_form_id, gen_random_uuid(),
    NULL, p_signed_on, jsonb_build_object('signature_id', v_id, 'person_id', p_person_id, 'content_id', p_content_id));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('signature_id', v_id));
END;
$$;

-- Voie normale : approbation refusée si un contrôle échoue ; le fait réel ne
-- peut alors être enregistré que comme émission déclarée en exception.
CREATE FUNCTION public.payables_confirm_issuance_v1(
  p_command_key text, p_form_id uuid, p_expected_version integer, p_issue_date date, p_presigned_form boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'CONFIRM_ISSUANCE';
  v_replay jsonb; v_form public.payables_cheque_forms; v_payment public.payables_payments;
  v_content public.payables_cheque_contents; v_rule public.payables_parameter_versions;
  v_required integer; v_preparers uuid[]; v_preparer_persons uuid[]; v_sig record; v_sig_version_a uuid;
  v_sig_version_b uuid; v_admissible integer := 0; v_applied jsonb := '[]'::jsonb; v_issuance uuid;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_CONFIRM_ISSUE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', p_form_id, 'expected_version', p_expected_version, 'issue_date', p_issue_date, 'presigned_form', p_presigned_form));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM 1 FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
    JOIN public.payables_cheque_forms f ON f.payment_id = p.id WHERE f.id = p_form_id FOR UPDATE OF i;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = p_form_id FOR UPDATE;
  IF v_form.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_FORM_UNKNOWN'; END IF;
  PERFORM payables_private.assert_version(v_form.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('FORM', p_form_id, v_actor);
  IF EXISTS (SELECT 1 FROM public.payables_issuances i WHERE i.form_id = p_form_id) THEN
    RAISE EXCEPTION 'PAYABLES_ISSUE_ALREADY_RECORDED';
  END IF;
  IF v_form.state <> 'PRINTED' OR v_form.provenance <> 'NATIVE' THEN RAISE EXCEPTION 'PAYABLES_FORM_STATE_INVALID'; END IF;
  -- Formules pré-signées : utilisation désactivée sans protocole validé.
  IF coalesce(p_presigned_form, false) OR v_form.presigned THEN RAISE EXCEPTION 'PAYABLES_PRESIGNED_FORM_USE_DISABLED'; END IF;
  PERFORM payables_private.assert_not_future(p_issue_date, 'ISSUE_DATE');
  SELECT * INTO v_payment FROM public.payables_payments WHERE id = v_form.payment_id FOR UPDATE;
  IF v_payment.status <> 'OPEN' THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_STATE_INVALID'; END IF;
  -- Arbitrage CTO : sur facture bloquée, des signatures n'attestent pas une
  -- émission. Le fait réel s'enregistre par la voie déclarée en exception
  -- (justificatif exigé), sans augmenter l'allocation ni lever le blocage.
  IF payables_private.invoice_blocked(v_payment.invoice_id) THEN RAISE EXCEPTION 'PAYABLES_INVOICE_BLOCKED'; END IF;
  v_content := payables_private.current_content(p_form_id);
  v_rule := payables_private.effective_parameter('SIGNATURE_RULE', v_form.bank_account_id::text, p_issue_date);
  IF v_rule.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_SIGNATURE_RULE_NOT_MET'; END IF;
  v_required := (v_rule.payload->>'required_signatures')::integer;
  -- Préparateurs : auteur de la demande, auteur de l'assignation de la formule,
  -- auteurs de toute version du contenu signable (ajustements compris) et
  -- demandeurs ou déclarants de toute impression réussie ou incertaine.
  SELECT array_agg(DISTINCT u) INTO v_preparers FROM (
    SELECT v_payment.created_by AS u
    UNION SELECT v_form.created_by
    UNION SELECT c.created_by FROM public.payables_cheque_contents c WHERE c.form_id = p_form_id
    UNION SELECT e.requested_by FROM public.payables_print_events e
           WHERE e.form_id = p_form_id AND e.status IN ('PRINTED','UNCERTAIN')
    UNION SELECT e.outcome_by FROM public.payables_print_events e
           WHERE e.form_id = p_form_id AND e.status IN ('PRINTED','UNCERTAIN')
  ) x;
  SELECT array_agg(payables_private.person_of_user(u)) INTO v_preparer_persons FROM unnest(v_preparers) u;
  IF EXISTS (SELECT 1 FROM unnest(v_preparer_persons) p WHERE p IS NULL) THEN
    RAISE EXCEPTION 'PAYABLES_PREPARER_NOT_LINKED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payables_signatures s WHERE s.content_id = v_content.id) THEN
    IF EXISTS (SELECT 1 FROM public.payables_signatures s WHERE s.form_id = p_form_id) THEN
      RAISE EXCEPTION 'PAYABLES_SIGNATURE_VERSION_MISMATCH';
    END IF;
    RAISE EXCEPTION 'PAYABLES_SIGNATURE_RULE_NOT_MET';
  END IF;
  FOR v_sig IN SELECT s.* FROM public.payables_signatures s WHERE s.content_id = v_content.id ORDER BY s.recorded_at, s.id LOOP
    IF v_sig.person_id = ANY (v_preparer_persons) THEN RAISE EXCEPTION 'PAYABLES_SIGNATORY_IS_PREPARER'; END IF;
    IF v_sig.signed_on > p_issue_date THEN RAISE EXCEPTION 'PAYABLES_SIGNATURE_AFTER_ISSUE'; END IF;
    v_sig_version_a := payables_private.signatory_version_if_admissible(v_sig.person_id, v_form.bank_account_id,
      v_payment.category_code, v_payment.amount, v_sig.signed_on);
    v_sig_version_b := payables_private.signatory_version_if_admissible(v_sig.person_id, v_form.bank_account_id,
      v_payment.category_code, v_payment.amount, p_issue_date);
    IF v_sig_version_a IS NULL OR v_sig_version_b IS NULL THEN RAISE EXCEPTION 'PAYABLES_SIGNATORY_NOT_ADMISSIBLE'; END IF;
    v_admissible := v_admissible + 1;
    v_applied := v_applied || jsonb_build_object('signature_id', v_sig.id, 'person_id', v_sig.person_id,
      'version_at_signature', v_sig_version_a, 'version_at_issue', v_sig_version_b);
  END LOOP;
  IF v_admissible < v_required THEN RAISE EXCEPTION 'PAYABLES_SIGNATURE_RULE_NOT_MET'; END IF;
  INSERT INTO public.payables_issuances (form_id, revision_no, path, issue_date, amount, applied_versions, recorded_by)
  VALUES (p_form_id, 1, 'NORMAL', p_issue_date, v_payment.amount, jsonb_build_object(
    'rule_version_id', v_rule.id, 'required_signatures', v_required, 'signatures', v_applied,
    'content_id', v_content.id, 'profile_version_id', v_content.profile_version_id), v_actor)
  RETURNING id INTO v_issuance;
  -- RÉSERVÉ → ENGAGÉ sur la même allocation : aucun double comptage.
  UPDATE public.payables_allocations SET status = 'ENGAGED', updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE payment_id = v_payment.id AND status = 'RESERVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYABLES_ALLOCATION_STATE_INVALID'; END IF;
  UPDATE public.payables_payments SET status = 'ISSUED', updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = v_payment.id;
  UPDATE public.payables_cheque_forms SET state = 'ISSUED', updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = p_form_id RETURNING * INTO v_form;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'ISSUANCE_CONFIRMED', 'CHEQUE_FORM', p_form_id, gen_random_uuid(),
    NULL, p_issue_date, jsonb_build_object('issuance_id', v_issuance, 'rule_version_id', v_rule.id));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'issuance_id', v_issuance, 'form_version', v_form.row_version));
END;
$$;

-- Voie exceptionnelle : enregistrer un fait n'est pas approuver un paiement.
CREATE FUNCTION public.payables_declare_issuance_exception_v1(
  p_command_key text, p_bank_account_id uuid, p_cheque_number text, p_amount numeric, p_issue_date date,
  p_payment_id uuid, p_reason_code text, p_evidence_ref text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'DECLARE_ISSUANCE_EXCEPTION';
  v_replay jsonb; v_form public.payables_cheque_forms; v_payment public.payables_payments;
  v_invoice public.payables_invoices; v_amount numeric; v_evidence text; v_reason text; v_issuance uuid;
  v_exception uuid; v_overrun_exception uuid; v_ceiling numeric;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_CONFIRM_ISSUE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'bank_account_id', p_bank_account_id, 'cheque_number', p_cheque_number, 'amount', p_amount,
    'issue_date', p_issue_date, 'payment_id', p_payment_id, 'reason_code', p_reason_code,
    'evidence_ref', p_evidence_ref, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  v_evidence := payables_private.safe_text(p_evidence_ref, 'EVIDENCE', 2, 200);
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('SIGNATORY_IS_PREPARER','SIGNATURE_MISSING','SIGNATORY_NOT_ADMISSIBLE',
       'CONJOINT_INCOMPLETE','PRESIGNED_OUTSIDE_PROTOCOL','OTHER_OUTSIDE_CIRCUIT') THEN
    RAISE EXCEPTION 'PAYABLES_EXCEPTION_REASON_CODE_INVALID';
  END IF;
  IF p_cheque_number IS NULL OR p_cheque_number !~ '^[0-9]{1,16}$' THEN RAISE EXCEPTION 'PAYABLES_CHEQUE_NUMBER_INVALID'; END IF;
  PERFORM payables_private.require_account(p_bank_account_id);
  PERFORM payables_private.assert_not_future(p_issue_date, 'ISSUE_DATE');
  -- Montant inconnu admis : il reste INDISPONIBLE, jamais zéro.
  v_amount := CASE WHEN p_amount IS NULL THEN NULL ELSE payables_private.xof_amount(p_amount, 'AMOUNT') END;
  IF p_payment_id IS NOT NULL THEN
    SELECT i.* INTO v_invoice FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
      WHERE p.id = p_payment_id FOR UPDATE OF i;
    IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_UNKNOWN'; END IF;
    SELECT * INTO v_payment FROM public.payables_payments WHERE id = p_payment_id FOR UPDATE;
    IF v_payment.status = 'ISSUED' THEN RAISE EXCEPTION 'PAYABLES_ISSUE_ALREADY_RECORDED'; END IF;
    IF v_payment.mode <> 'CHEQUE' OR v_payment.status <> 'OPEN' OR v_payment.bank_account_id <> p_bank_account_id THEN
      RAISE EXCEPTION 'PAYABLES_PAYMENT_STATE_INVALID';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:form:' || p_bank_account_id::text || ':' || p_cheque_number, 0));
  SELECT * INTO v_form FROM public.payables_cheque_forms f
   WHERE f.bank_account_id = p_bank_account_id AND f.cheque_number = p_cheque_number FOR UPDATE;
  IF v_form.id IS NOT NULL THEN
    -- Rattachement à l'instrument existant : jamais deux enregistrements.
    IF EXISTS (SELECT 1 FROM public.payables_issuances i WHERE i.form_id = v_form.id)
       OR v_form.state IN ('ISSUED','CLEARED','CANCELLED','REPLACED') THEN
      RAISE EXCEPTION 'PAYABLES_ISSUE_ALREADY_RECORDED';
    END IF;
    IF v_form.payment_id IS DISTINCT FROM p_payment_id THEN
      -- Formule d'un paiement abandonné, annulé ou remplacé mais réellement émise :
      -- le fait est enregistré sans allocation et sa facture est bloquée pour
      -- empêcher un second paiement.
      SELECT i.* INTO v_invoice FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
        WHERE p.id = v_form.payment_id AND p.status IN ('ABANDONED','CANCELLED','REPLACED') FOR UPDATE OF i;
      IF p_payment_id IS NOT NULL OR v_invoice.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_PAYMENT_FORM_MISMATCH'; END IF;
      v_overrun_exception := payables_private.open_exception(v_actor, 'ISSUANCE_OVERRUN',
        'Formule d''un paiement non ouvert réellement émise', v_invoice.id, v_form.payment_id, v_form.id,
        p_bank_account_id, true, false);
    END IF;
    UPDATE public.payables_cheque_forms SET state = 'ISSUED', updated_at = statement_timestamp(), row_version = row_version + 1
     WHERE id = v_form.id RETURNING * INTO v_form;
  ELSE
    IF p_payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.payables_cheque_forms f WHERE f.payment_id = p_payment_id
         AND f.state IN ('ASSIGNED','PRINT_PENDING','PRINTED','PRINT_UNCERTAIN','ISSUED','CLEARED')) THEN
      RAISE EXCEPTION 'PAYABLES_PAYMENT_FORM_MISMATCH';
    END IF;
    INSERT INTO public.payables_cheque_forms (bank_account_id, cheque_number, payment_id, provenance, state, created_by)
    VALUES (p_bank_account_id, p_cheque_number, p_payment_id, 'EXCEPTION', 'ISSUED', v_actor) RETURNING * INTO v_form;
  END IF;
  INSERT INTO public.payables_issuances (form_id, revision_no, path, issue_date, amount, exception_reason_code,
    evidence_ref, recorded_by, reason)
  VALUES (v_form.id, 1, 'EXCEPTION', p_issue_date, v_amount, p_reason_code, v_evidence, v_actor, v_reason)
  RETURNING id INTO v_issuance;
  -- Plafond d'engagement automatique : sur facture bloquée (arbitrage CTO),
  -- jamais au-delà de la réservation existante du paiement ; sinon le restant.
  IF v_payment.id IS NOT NULL THEN
    v_ceiling := CASE WHEN payables_private.invoice_blocked(v_invoice.id)
      THEN (SELECT a.amount FROM public.payables_allocations a WHERE a.payment_id = v_payment.id AND a.status = 'RESERVED')
      ELSE v_invoice.amount - payables_private.committed_amount(v_invoice.id, v_payment.id) END;
  END IF;
  -- Montant inconnu sur un paiement rattaché : la facture est bloquée tant que
  -- le montant n'est pas établi (la réservation n'en est pas une preuve).
  v_exception := payables_private.open_exception(v_actor, 'ISSUED_OUTSIDE_CIRCUIT', v_reason, v_invoice.id,
    p_payment_id, v_form.id, p_bank_account_id, (v_payment.id IS NOT NULL AND v_amount IS NULL), true,
    jsonb_build_object('reason_code', p_reason_code, 'amount_known', v_amount IS NOT NULL));
  IF v_payment.id IS NOT NULL THEN
    IF v_amount IS NOT NULL AND v_amount <= v_ceiling THEN
      UPDATE public.payables_allocations SET amount = v_amount, status = 'ENGAGED', updated_at = statement_timestamp(),
             row_version = row_version + 1
       WHERE payment_id = v_payment.id AND status = 'RESERVED';
      UPDATE public.payables_payments SET amount = v_amount, status = 'ISSUED', updated_at = statement_timestamp(),
             row_version = row_version + 1
       WHERE id = v_payment.id;
    ELSIF v_amount IS NOT NULL THEN
      -- Dépassement : aucune allocation automatique, facture bloquée.
      v_overrun_exception := payables_private.open_exception(v_actor, 'ISSUANCE_OVERRUN',
        'Émission déclarée au-delà du plafond du paiement', v_invoice.id, v_payment.id, v_form.id, p_bank_account_id,
        true, false);
      UPDATE public.payables_payments SET status = 'ISSUED', updated_at = statement_timestamp(), row_version = row_version + 1
       WHERE id = v_payment.id;
    ELSE
      UPDATE public.payables_payments SET status = 'ISSUED', updated_at = statement_timestamp(), row_version = row_version + 1
       WHERE id = v_payment.id;
    END IF;
  END IF;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'ISSUANCE_DECLARED_EXCEPTION', 'CHEQUE_FORM', v_form.id,
    gen_random_uuid(), v_reason, p_issue_date, jsonb_build_object('issuance_id', v_issuance, 'exception_id', v_exception,
    'reason_code', p_reason_code, 'amount_known', v_amount IS NOT NULL, 'overrun_exception_id', v_overrun_exception));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', v_form.id, 'issuance_id', v_issuance, 'exception_id', v_exception,
    'overrun_exception_id', v_overrun_exception));
END;
$$;

CREATE FUNCTION public.payables_record_delivery_v1(p_command_key text, p_form_id uuid, p_delivered_on date, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'RECORD_DELIVERY';
  v_replay jsonb; v_form public.payables_cheque_forms; v_issuance public.payables_issuances; v_id uuid;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_CONFIRM_ISSUE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', p_form_id, 'delivered_on', p_delivered_on, 'note', p_note));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = p_form_id FOR UPDATE;
  IF v_form.id IS NULL OR v_form.state NOT IN ('ISSUED','CLEARED') THEN RAISE EXCEPTION 'PAYABLES_FORM_STATE_INVALID'; END IF;
  PERFORM payables_private.assert_not_future(p_delivered_on, 'DELIVERED_ON');
  v_issuance := payables_private.current_issuance(p_form_id);
  IF p_delivered_on < v_issuance.issue_date THEN RAISE EXCEPTION 'PAYABLES_DELIVERY_BEFORE_ISSUE'; END IF;
  IF EXISTS (SELECT 1 FROM public.payables_deliveries d WHERE d.form_id = p_form_id) THEN
    RAISE EXCEPTION 'PAYABLES_DELIVERY_ALREADY_RECORDED';
  END IF;
  INSERT INTO public.payables_deliveries (form_id, delivered_on, note, recorded_by)
  VALUES (p_form_id, p_delivered_on, CASE WHEN p_note IS NULL THEN NULL ELSE payables_private.safe_text(p_note, 'NOTE', 1, 300) END, v_actor)
  RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'DELIVERY_RECORDED', 'CHEQUE_FORM', p_form_id, gen_random_uuid(),
    NULL, p_delivered_on, jsonb_build_object('delivery_id', v_id));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('delivery_id', v_id));
END;
$$;

-- --------------------------------------------------------------------------
-- 10. API : sorties hors banque (annulation, remplacement, correction)
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_request_exit_v1(
  p_command_key text, p_form_id uuid, p_expected_version integer, p_kind text, p_details jsonb,
  p_evidence_ref text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'REQUEST_EXIT';
  v_replay jsonb; v_form public.payables_cheque_forms; v_id uuid; v_reason text; v_evidence text;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'EXIT_REQUEST');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'form_id', p_form_id, 'expected_version', p_expected_version, 'kind', p_kind, 'details', p_details,
    'evidence_ref', p_evidence_ref, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  v_evidence := payables_private.safe_text(p_evidence_ref, 'EVIDENCE', 2, 200);
  IF p_kind IS NULL OR p_kind NOT IN ('CANCELLATION','REPLACEMENT','CORRECTION') THEN RAISE EXCEPTION 'PAYABLES_EXIT_KIND_INVALID'; END IF;
  IF jsonb_typeof(v_details) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'PAYABLES_EXIT_DETAILS_INVALID'; END IF;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = p_form_id FOR UPDATE;
  IF v_form.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_FORM_UNKNOWN'; END IF;
  PERFORM payables_private.assert_version(v_form.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('FORM', p_form_id, v_actor);
  IF v_form.state <> 'ISSUED' THEN RAISE EXCEPTION 'PAYABLES_EXIT_STATE_INVALID'; END IF;
  IF p_kind = 'REPLACEMENT' THEN
    IF v_form.payment_id IS NULL THEN RAISE EXCEPTION 'PAYABLES_EXIT_STATE_INVALID'; END IF;
    IF v_details ? 'amount' THEN PERFORM payables_private.xof_amount((v_details->>'amount')::numeric, 'AMOUNT'); END IF;
    IF v_details ? 'beneficiary' THEN PERFORM payables_private.safe_text(v_details->>'beneficiary', 'BENEFICIARY', 2, 120); END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_details) k WHERE k NOT IN ('amount','beneficiary')) THEN
      RAISE EXCEPTION 'PAYABLES_EXIT_DETAILS_INVALID';
    END IF;
  ELSIF p_kind = 'CORRECTION' THEN
    IF NOT (v_details ? 'issue_date') OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_details) k WHERE k <> 'issue_date') THEN
      RAISE EXCEPTION 'PAYABLES_EXIT_DETAILS_INVALID';
    END IF;
    PERFORM payables_private.assert_not_future((v_details->>'issue_date')::date, 'ISSUE_DATE');
  ELSIF v_details <> '{}'::jsonb THEN
    RAISE EXCEPTION 'PAYABLES_EXIT_DETAILS_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payables_exits e WHERE e.form_id = p_form_id AND e.status = 'REQUESTED') THEN
    RAISE EXCEPTION 'PAYABLES_PROPOSAL_ALREADY_PENDING';
  END IF;
  INSERT INTO public.payables_exits (form_id, kind, status, requested_by, evidence_ref, reason, details)
  VALUES (p_form_id, p_kind, 'REQUESTED', v_actor, v_evidence, v_reason, v_details) RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'EXIT_REQUESTED', 'CHEQUE_FORM', p_form_id, gen_random_uuid(),
    v_reason, NULL, jsonb_build_object('exit_id', v_id, 'kind', p_kind));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('exit_id', v_id));
END;
$$;

CREATE FUNCTION public.payables_validate_exit_v1(
  p_command_key text, p_exit_id uuid, p_expected_version integer, p_approve boolean, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'VALIDATE_EXIT';
  v_replay jsonb; v_exit public.payables_exits; v_form public.payables_cheque_forms;
  v_payment public.payables_payments; v_invoice public.payables_invoices; v_issuance public.payables_issuances;
  v_new_payment uuid; v_new_amount numeric; v_ceiling numeric; v_reason text; v_today date := payables_private.today();
  v_outcome text; v_new_date date; v_rule public.payables_parameter_versions; v_sig jsonb; v_signed_on date;
  v_revalidated jsonb := '[]'::jsonb; v_version uuid;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'EXIT_VALIDATE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'exit_id', p_exit_id, 'expected_version', p_expected_version, 'approve', p_approve, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_exit FROM public.payables_exits WHERE id = p_exit_id;
  IF v_exit.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_EXIT_UNKNOWN'; END IF;
  -- Ordre fixe : facture → paiement → formule → sortie.
  SELECT i.* INTO v_invoice FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
    JOIN public.payables_cheque_forms f ON f.payment_id = p.id WHERE f.id = v_exit.form_id FOR UPDATE OF i;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = v_exit.form_id FOR UPDATE;
  SELECT * INTO v_exit FROM public.payables_exits WHERE id = p_exit_id FOR UPDATE;
  PERFORM payables_private.assert_version(v_exit.row_version, p_expected_version);
  IF v_exit.status <> 'REQUESTED' THEN RAISE EXCEPTION 'PAYABLES_PROPOSAL_STATE_INVALID'; END IF;
  IF v_exit.requested_by = v_actor THEN RAISE EXCEPTION 'PAYABLES_SECOND_ACTOR_REQUIRED'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'PAYABLES_DECISION_REQUIRED'; END IF;
  IF NOT p_approve THEN
    UPDATE public.payables_exits SET status = 'REJECTED', decided_by = v_actor, decided_at = statement_timestamp(),
           decision_reason = v_reason, row_version = row_version + 1 WHERE id = p_exit_id;
    PERFORM payables_private.append_event(v_actor, v_cmd, 'EXIT_REJECTED', 'CHEQUE_FORM', v_form.id, gen_random_uuid(), v_reason);
    RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('exit_id', p_exit_id, 'outcome', 'REJECTED'));
  END IF;
  IF v_form.state <> 'ISSUED' THEN RAISE EXCEPTION 'PAYABLES_EXIT_STATE_INVALID'; END IF;
  IF v_form.payment_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM public.payables_payments WHERE id = v_form.payment_id FOR UPDATE;
  END IF;
  IF v_exit.kind = 'CANCELLATION' THEN
    UPDATE public.payables_cheque_forms SET state = 'CANCELLED', updated_at = statement_timestamp(), row_version = row_version + 1
     WHERE id = v_form.id;
    IF v_payment.id IS NOT NULL THEN
      UPDATE public.payables_allocations SET status = 'CANCELLED', updated_at = statement_timestamp(), row_version = row_version + 1
       WHERE payment_id = v_payment.id AND status IN ('RESERVED','ENGAGED');
      UPDATE public.payables_payments SET status = 'CANCELLED', updated_at = statement_timestamp(), row_version = row_version + 1
       WHERE id = v_payment.id;
    END IF;
    UPDATE public.payables_exits SET status = 'VALIDATED', decided_by = v_actor, decided_at = statement_timestamp(),
           decision_reason = v_reason, accounting_date = v_today, value_date = v_today, row_version = row_version + 1
     WHERE id = p_exit_id;
    v_outcome := 'CANCELLED';
  ELSIF v_exit.kind = 'REPLACEMENT' THEN
    IF v_payment.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_EXIT_STATE_INVALID'; END IF;
    -- Facture bloquée : aucun nouveau paiement, y compris un remplaçant.
    IF payables_private.invoice_blocked(v_invoice.id) THEN RAISE EXCEPTION 'PAYABLES_INVOICE_BLOCKED'; END IF;
    -- Transfert atomique : ancien chèque annulé, remplaçant RÉSERVÉ, sans intervalle.
    UPDATE public.payables_allocations SET status = 'CANCELLED', updated_at = statement_timestamp(), row_version = row_version + 1
     WHERE payment_id = v_payment.id AND status IN ('RESERVED','ENGAGED');
    v_new_amount := coalesce((v_exit.details->>'amount')::numeric, v_payment.amount);
    v_ceiling := v_invoice.amount - payables_private.committed_amount(v_invoice.id, NULL);
    IF v_new_amount > v_ceiling THEN RAISE EXCEPTION 'PAYABLES_REPLACEMENT_EXCEEDS_CEILING'; END IF;
    INSERT INTO public.payables_payments (invoice_id, mode, bank_account_id, category_code, amount, currency, is_partial,
      beneficiary, status, replaces_payment_id, created_by)
    VALUES (v_invoice.id, 'CHEQUE', v_payment.bank_account_id, v_payment.category_code, v_new_amount, 'XOF',
      v_new_amount < v_ceiling, coalesce(v_exit.details->>'beneficiary', v_payment.beneficiary), 'OPEN', v_payment.id,
      v_exit.requested_by)
    RETURNING id INTO v_new_payment;
    INSERT INTO public.payables_allocations (payment_id, invoice_id, amount, status)
    VALUES (v_new_payment, v_invoice.id, v_new_amount, 'RESERVED');
    UPDATE public.payables_payments SET status = 'REPLACED', updated_at = statement_timestamp(), row_version = row_version + 1
     WHERE id = v_payment.id;
    UPDATE public.payables_cheque_forms SET state = 'REPLACED', updated_at = statement_timestamp(), row_version = row_version + 1
     WHERE id = v_form.id;
    UPDATE public.payables_exits SET status = 'VALIDATED', decided_by = v_actor, decided_at = statement_timestamp(),
           decision_reason = v_reason, accounting_date = v_today, value_date = v_today,
           replacement_payment_id = v_new_payment, row_version = row_version + 1
     WHERE id = p_exit_id;
    v_outcome := 'REPLACED';
  ELSE
    -- Correction de la date réelle d'émission : nouvelle révision, ancienne conservée.
    v_issuance := payables_private.current_issuance(v_form.id);
    v_new_date := (v_exit.details->>'issue_date')::date;
    PERFORM payables_private.assert_not_future(v_new_date, 'ISSUE_DATE');
    IF v_issuance.path = 'NORMAL' THEN
      -- Voie normale : la date corrigée doit rester compatible avec les
      -- signatures enregistrées, la règle et l'habilitation à cette date ;
      -- sinon le fait relève d'une émission déclarée en exception.
      v_rule := payables_private.effective_parameter('SIGNATURE_RULE', v_form.bank_account_id::text, v_new_date);
      IF v_rule.id IS NULL
         OR jsonb_array_length(coalesce(v_issuance.applied_versions->'signatures', '[]'::jsonb))
            < (v_rule.payload->>'required_signatures')::integer THEN
        RAISE EXCEPTION 'PAYABLES_SIGNATURE_RULE_NOT_MET';
      END IF;
      FOR v_sig IN SELECT value FROM jsonb_array_elements(coalesce(v_issuance.applied_versions->'signatures', '[]'::jsonb)) LOOP
        SELECT s.signed_on INTO v_signed_on FROM public.payables_signatures s WHERE s.id = (v_sig->>'signature_id')::uuid;
        IF v_signed_on IS NULL OR v_signed_on > v_new_date THEN RAISE EXCEPTION 'PAYABLES_SIGNATURE_AFTER_ISSUE'; END IF;
        v_version := payables_private.signatory_version_if_admissible((v_sig->>'person_id')::uuid, v_form.bank_account_id,
          v_payment.category_code, v_issuance.amount, v_new_date);
        IF v_version IS NULL THEN RAISE EXCEPTION 'PAYABLES_SIGNATORY_NOT_ADMISSIBLE'; END IF;
        v_revalidated := v_revalidated || jsonb_build_object('signature_id', v_sig->>'signature_id', 'version_at_issue', v_version);
      END LOOP;
    END IF;
    INSERT INTO public.payables_issuances (form_id, revision_no, path, issue_date, amount, exception_reason_code,
      applied_versions, evidence_ref, recorded_by, reason)
    VALUES (v_form.id, v_issuance.revision_no + 1, v_issuance.path, v_new_date,
      v_issuance.amount, v_issuance.exception_reason_code, v_issuance.applied_versions || jsonb_build_object(
        'corrects_issuance_id', v_issuance.id, 'exit_id', p_exit_id, 'rule_version_at_corrected_date', v_rule.id,
        'revalidated_signatures', v_revalidated), v_exit.evidence_ref, v_actor, v_exit.reason);
    UPDATE public.payables_exits SET status = 'VALIDATED', decided_by = v_actor, decided_at = statement_timestamp(),
           decision_reason = v_reason, row_version = row_version + 1
     WHERE id = p_exit_id;
    UPDATE public.payables_cheque_forms SET updated_at = statement_timestamp(), row_version = row_version + 1 WHERE id = v_form.id;
    v_outcome := 'CORRECTED';
  END IF;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'EXIT_VALIDATED', 'CHEQUE_FORM', v_form.id, gen_random_uuid(),
    v_reason, v_today, jsonb_build_object('exit_id', p_exit_id, 'kind', v_exit.kind, 'replacement_payment_id', v_new_payment));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'exit_id', p_exit_id, 'outcome', v_outcome, 'replacement_payment_id', v_new_payment));
END;
$$;

-- --------------------------------------------------------------------------
-- 11. API : virements déclarés (écriture unique, aucun ordre bancaire)
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_declare_transfer_v1(
  p_command_key text, p_invoice_id uuid, p_bank_account_id uuid, p_category_code text, p_amount numeric,
  p_bank_reference text, p_declared_status text, p_executed_on date, p_evidence_ref text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'DECLARE_TRANSFER';
  v_replay jsonb; v_invoice public.payables_invoices; v_amount numeric; v_remaining numeric; v_payment uuid;
  v_outcome text; v_exception uuid; v_reason text; v_evidence text; v_reference text; v_blocked boolean;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'TRANSFER_DECLARE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'invoice_id', p_invoice_id, 'bank_account_id', p_bank_account_id, 'category_code', p_category_code,
    'amount', p_amount, 'bank_reference', p_bank_reference, 'declared_status', p_declared_status,
    'executed_on', p_executed_on, 'evidence_ref', p_evidence_ref, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  v_evidence := payables_private.safe_text(p_evidence_ref, 'EVIDENCE', 2, 200);
  v_reference := payables_private.safe_text(p_bank_reference, 'BANK_REFERENCE', 1, 80);
  v_amount := payables_private.xof_amount(p_amount, 'AMOUNT');
  IF p_declared_status IS NULL OR p_declared_status NOT IN ('EXECUTED','COMMITTED') THEN
    RAISE EXCEPTION 'PAYABLES_TRANSFER_STATUS_INVALID';
  END IF;
  IF p_declared_status = 'EXECUTED' THEN PERFORM payables_private.assert_not_future(p_executed_on, 'EXECUTED_ON');
  ELSIF p_executed_on IS NOT NULL THEN RAISE EXCEPTION 'PAYABLES_TRANSFER_STATUS_INVALID'; END IF;
  PERFORM payables_private.require_account(p_bank_account_id);
  IF p_category_code IS NULL OR NOT payables_private.category_active(p_category_code, payables_private.today()) THEN
    RAISE EXCEPTION 'PAYABLES_CATEGORY_INACTIVE';
  END IF;
  SELECT * INTO v_invoice FROM public.payables_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_INVOICE_UNKNOWN'; END IF;
  -- Une même référence bancaire sur un même compte n'est jamais déclarée deux
  -- fois (comparaison sans casse ni blancs de bord ; idempotence par clé à part).
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:transfer:' || p_bank_account_id::text || ':'
    || upper(btrim(v_reference)), 0));
  IF EXISTS (SELECT 1 FROM public.payables_transfer_declarations t
             WHERE t.bank_account_id = p_bank_account_id AND upper(btrim(t.bank_reference)) = upper(btrim(v_reference))) THEN
    RAISE EXCEPTION 'PAYABLES_TRANSFER_REFERENCE_DUPLICATE';
  END IF;
  v_remaining := v_invoice.amount - payables_private.committed_amount(p_invoice_id, NULL);
  v_blocked := payables_private.invoice_blocked(p_invoice_id);
  INSERT INTO public.payables_payments (invoice_id, mode, bank_account_id, category_code, amount, currency, is_partial,
    status, created_by)
  VALUES (p_invoice_id, 'TRANSFER', p_bank_account_id, p_category_code, v_amount, 'XOF', v_amount < v_remaining,
    'DECLARED', v_actor)
  RETURNING id INTO v_payment;
  IF NOT v_blocked AND v_amount <= v_remaining THEN
    INSERT INTO public.payables_allocations (payment_id, invoice_id, amount, status)
    VALUES (v_payment, p_invoice_id, v_amount, 'ENGAGED');
    v_outcome := 'ALLOCATED';
  ELSE
    -- Fait conservé intégralement, sans allocation ni preuve inventée ; facture bloquée.
    v_outcome := 'UNALLOCATED';
    v_exception := payables_private.open_exception(v_actor, 'TRANSFER_UNALLOCATED',
      CASE WHEN v_blocked THEN 'Virement déclaré sur facture bloquée' ELSE 'Virement déclaré au-delà du restant à engager' END,
      p_invoice_id, v_payment, NULL, p_bank_account_id, true, false,
      jsonb_build_object('cause', CASE WHEN v_blocked THEN 'INVOICE_BLOCKED' ELSE 'OVERRUN' END));
  END IF;
  INSERT INTO public.payables_transfer_declarations (payment_id, bank_account_id, amount, bank_reference, declared_status,
    executed_on, allocation_outcome, evidence_ref, declared_by)
  VALUES (v_payment, p_bank_account_id, v_amount, v_reference, p_declared_status, p_executed_on, v_outcome, v_evidence, v_actor);
  PERFORM payables_private.append_event(v_actor, v_cmd, 'TRANSFER_DECLARED', 'PAYMENT', v_payment, gen_random_uuid(),
    v_reason, p_executed_on, jsonb_build_object('invoice_id', p_invoice_id, 'amount', v_amount::bigint::text,
    'allocation_outcome', v_outcome, 'exception_id', v_exception));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'payment_id', v_payment, 'allocation_outcome', v_outcome, 'exception_id', v_exception));
END;
$$;

-- --------------------------------------------------------------------------
-- 12. API : reprise initiale des chèques en circulation
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_prepare_takeover_v1(
  p_command_key text, p_bank_account_id uuid, p_cutoff_date date, p_source_label text,
  p_control_count integer, p_control_total numeric, p_items jsonb, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'PREPARE_TAKEOVER';
  v_replay jsonb; v_batch uuid; v_item jsonb; v_line integer := 0; v_total numeric := 0; v_reason text; v_label text;
  v_number text; v_amount numeric; v_date date; v_beneficiary text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'bank_account_id', p_bank_account_id, 'cutoff_date', p_cutoff_date, 'source_label', p_source_label,
    'control_count', p_control_count, 'control_total', p_control_total, 'items', p_items, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  v_label := payables_private.safe_text(p_source_label, 'SOURCE_LABEL', 2, 120);
  PERFORM payables_private.require_account(p_bank_account_id);
  PERFORM payables_private.assert_not_future(p_cutoff_date, 'CUTOFF_DATE');
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 5000 THEN
    RAISE EXCEPTION 'PAYABLES_TAKEOVER_ITEMS_INVALID';
  END IF;
  IF p_control_count IS NULL OR p_control_total IS NULL OR p_control_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'PAYABLES_TAKEOVER_CONTROL_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payables_takeover_batches b WHERE b.bank_account_id = p_bank_account_id AND b.status = 'PREPARED') THEN
    RAISE EXCEPTION 'PAYABLES_PROPOSAL_ALREADY_PENDING';
  END IF;
  INSERT INTO public.payables_takeover_batches (bank_account_id, cutoff_date, source_label, control_count, control_total,
    prepared_by, reason)
  VALUES (p_bank_account_id, p_cutoff_date, v_label, p_control_count, p_control_total, v_actor, v_reason)
  RETURNING id INTO v_batch;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_line := v_line + 1;
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k
         WHERE k NOT IN ('cheque_number','beneficiary','amount','issue_date')) THEN
      RAISE EXCEPTION 'PAYABLES_TAKEOVER_ITEMS_INVALID';
    END IF;
    v_number := v_item->>'cheque_number';
    IF jsonb_typeof(v_item->'cheque_number') IS DISTINCT FROM 'string' OR v_number !~ '^[0-9]{1,16}$' THEN
      RAISE EXCEPTION 'PAYABLES_CHEQUE_NUMBER_INVALID';
    END IF;
    IF jsonb_typeof(v_item->'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'PAYABLES_TAKEOVER_ITEMS_INVALID'; END IF;
    v_amount := payables_private.xof_amount((v_item->>'amount')::numeric, 'AMOUNT');
    v_beneficiary := payables_private.safe_text(v_item->>'beneficiary', 'BENEFICIARY', 2, 120);
    IF coalesce(v_item->>'issue_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'PAYABLES_TAKEOVER_ITEMS_INVALID'; END IF;
    v_date := (v_item->>'issue_date')::date;
    IF v_date > p_cutoff_date THEN RAISE EXCEPTION 'PAYABLES_TAKEOVER_ITEM_AFTER_CUTOFF'; END IF;
    IF EXISTS (SELECT 1 FROM public.payables_takeover_items t WHERE t.batch_id = v_batch AND t.cheque_number = v_number) THEN
      RAISE EXCEPTION 'PAYABLES_TAKEOVER_DUPLICATE_ITEM';
    END IF;
    INSERT INTO public.payables_takeover_items (batch_id, line_no, cheque_number, beneficiary, amount, issue_date)
    VALUES (v_batch, v_line, v_number, v_beneficiary, v_amount, v_date);
    v_total := v_total + v_amount;
  END LOOP;
  IF v_total <> p_control_total THEN RAISE EXCEPTION 'PAYABLES_TAKEOVER_CONTROL_MISMATCH'; END IF;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'TAKEOVER_PREPARED', 'TAKEOVER_BATCH', v_batch, gen_random_uuid(),
    v_reason, p_cutoff_date, jsonb_build_object('control_count', p_control_count, 'control_total', p_control_total::bigint::text));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('batch_id', v_batch));
END;
$$;

CREATE FUNCTION public.payables_decide_takeover_v1(
  p_command_key text, p_batch_id uuid, p_expected_version integer, p_approve boolean,
  p_attest_complete boolean, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'DECIDE_TAKEOVER';
  v_replay jsonb; v_batch public.payables_takeover_batches; v_item record; v_form uuid; v_collisions integer;
  v_exception uuid; v_reason text; v_outcome text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'EXIT_VALIDATE');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'batch_id', p_batch_id, 'expected_version', p_expected_version, 'approve', p_approve,
    'attest_complete', p_attest_complete, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_batch FROM public.payables_takeover_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_TAKEOVER_UNKNOWN'; END IF;
  PERFORM payables_private.assert_version(v_batch.row_version, p_expected_version);
  IF v_batch.status <> 'PREPARED' THEN RAISE EXCEPTION 'PAYABLES_PROPOSAL_STATE_INVALID'; END IF;
  IF v_batch.prepared_by = v_actor THEN RAISE EXCEPTION 'PAYABLES_SECOND_ACTOR_REQUIRED'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'PAYABLES_DECISION_REQUIRED'; END IF;
  IF NOT p_approve THEN
    UPDATE public.payables_takeover_batches SET status = 'REJECTED', decided_by = v_actor, decided_at = statement_timestamp(),
           decision_reason = v_reason, row_version = row_version + 1 WHERE id = p_batch_id;
    v_outcome := 'REJECTED';
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('payables:takeover:' || v_batch.bank_account_id::text, 0));
    SELECT count(*) INTO v_collisions FROM public.payables_takeover_items t
      JOIN public.payables_cheque_forms f ON f.bank_account_id = v_batch.bank_account_id AND f.cheque_number = t.cheque_number
     WHERE t.batch_id = p_batch_id;
    IF v_collisions > 0 THEN
      -- Collision reprise ↔ saisie courante : intégration refusée, instruction requise.
      UPDATE public.payables_takeover_batches SET status = 'COLLISION', decided_by = v_actor, decided_at = statement_timestamp(),
             decision_reason = v_reason, row_version = row_version + 1 WHERE id = p_batch_id;
      v_exception := payables_private.open_exception(v_actor, 'TAKEOVER_COLLISION', 'Numéros déjà présents au registre',
        NULL, NULL, NULL, v_batch.bank_account_id, false, true, jsonb_build_object('collisions', v_collisions),
        NULL, p_batch_id);
      v_outcome := 'COLLISION';
    ELSE
      FOR v_item IN SELECT * FROM public.payables_takeover_items t WHERE t.batch_id = p_batch_id ORDER BY t.line_no LOOP
        INSERT INTO public.payables_cheque_forms (bank_account_id, cheque_number, provenance, state, created_by)
        VALUES (v_batch.bank_account_id, v_item.cheque_number, 'TAKEOVER', 'ISSUED', v_actor) RETURNING id INTO v_form;
        INSERT INTO public.payables_issuances (form_id, revision_no, path, issue_date, amount, applied_versions, recorded_by, reason)
        VALUES (v_form, 1, 'TAKEOVER', v_item.issue_date, v_item.amount,
          jsonb_build_object('takeover_batch_id', p_batch_id, 'line_no', v_item.line_no), v_actor, 'Reprise initiale');
      END LOOP;
      UPDATE public.payables_takeover_batches SET status = 'INTEGRATED', decided_by = v_actor, decided_at = statement_timestamp(),
             decision_reason = v_reason, completeness_attested = coalesce(p_attest_complete, false),
             row_version = row_version + 1
       WHERE id = p_batch_id;
      v_outcome := 'INTEGRATED';
    END IF;
  END IF;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'TAKEOVER_' || v_outcome, 'TAKEOVER_BATCH', p_batch_id,
    gen_random_uuid(), v_reason, v_batch.cutoff_date, jsonb_build_object('attested', coalesce(p_attest_complete, false),
    'exception_id', v_exception));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'batch_id', p_batch_id, 'outcome', v_outcome, 'exception_id', v_exception));
END;
$$;

-- --------------------------------------------------------------------------
-- 13. API : inventaire des formules pré-signées (risque, jamais utilisation)
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_record_presigned_form_v1(
  p_command_key text, p_bank_account_id uuid, p_cheque_number text, p_signer_person_id uuid,
  p_holder_note text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'RECORD_PRESIGNED_FORM';
  v_replay jsonb; v_form uuid; v_exception uuid; v_reason text; v_note text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'CHEQUE_PREPARE_PRINT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'bank_account_id', p_bank_account_id, 'cheque_number', p_cheque_number, 'signer_person_id', p_signer_person_id,
    'holder_note', p_holder_note, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  v_note := payables_private.safe_text(p_holder_note, 'HOLDER_NOTE', 2, 200);
  IF p_cheque_number IS NULL OR p_cheque_number !~ '^[0-9]{1,16}$' THEN RAISE EXCEPTION 'PAYABLES_CHEQUE_NUMBER_INVALID'; END IF;
  PERFORM payables_private.require_account(p_bank_account_id);
  IF p_signer_person_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.payables_persons p WHERE p.id = p_signer_person_id) THEN
    RAISE EXCEPTION 'PAYABLES_PERSON_NOT_ACTIVE';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:form:' || p_bank_account_id::text || ':' || p_cheque_number, 0));
  IF EXISTS (SELECT 1 FROM public.payables_cheque_forms f WHERE f.bank_account_id = p_bank_account_id AND f.cheque_number = p_cheque_number) THEN
    RAISE EXCEPTION 'PAYABLES_FORM_ALREADY_USED';
  END IF;
  INSERT INTO public.payables_cheque_forms (bank_account_id, cheque_number, provenance, state, presigned, unused_reason, created_by)
  VALUES (p_bank_account_id, p_cheque_number, 'PRESIGNED_INVENTORY', 'PRESIGNED_HELD', true, v_note, v_actor)
  RETURNING id INTO v_form;
  v_exception := payables_private.open_exception(v_actor, 'PRESIGNED_FORM_RISK', v_reason, NULL, NULL, v_form,
    p_bank_account_id, false, false, jsonb_build_object('signer_person_id', p_signer_person_id));
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PRESIGNED_FORM_INVENTORIED', 'CHEQUE_FORM', v_form,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('exception_id', v_exception));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('form_id', v_form, 'exception_id', v_exception));
END;
$$;

-- --------------------------------------------------------------------------
-- 14. API : instruction des exceptions
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_resolve_exception_v1(
  p_command_key text, p_exception_id uuid, p_expected_version integer, p_resolution_code text,
  p_details jsonb, p_evidence_ref text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'RESOLVE_EXCEPTION';
  v_replay jsonb; v_exc public.payables_exceptions; v_reason text; v_evidence text; v_allowed text[];
  v_new_invoice uuid; v_candidate jsonb; v_invoice public.payables_invoices; v_issuance public.payables_issuances;
  v_amount numeric; v_payment public.payables_payments; v_followup uuid; v_form public.payables_cheque_forms;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'EXCEPTION_INSTRUCT');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'exception_id', p_exception_id, 'expected_version', p_expected_version, 'resolution_code', p_resolution_code,
    'details', p_details, 'evidence_ref', p_evidence_ref, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  v_evidence := payables_private.safe_text(p_evidence_ref, 'EVIDENCE', 2, 200);
  SELECT * INTO v_exc FROM public.payables_exceptions WHERE id = p_exception_id;
  IF v_exc.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_EXCEPTION_UNKNOWN'; END IF;
  IF v_exc.invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM public.payables_invoices WHERE id = v_exc.invoice_id FOR UPDATE;
  END IF;
  SELECT * INTO v_exc FROM public.payables_exceptions WHERE id = p_exception_id FOR UPDATE;
  PERFORM payables_private.assert_version(v_exc.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('EXCEPTION', p_exception_id, v_actor);
  IF v_exc.status <> 'OPEN' THEN RAISE EXCEPTION 'PAYABLES_EXCEPTION_STATE_INVALID'; END IF;
  -- Instruction par un autre que l'auteur de l'exception.
  IF v_exc.opened_by = v_actor THEN RAISE EXCEPTION 'PAYABLES_SECOND_ACTOR_REQUIRED'; END IF;
  v_allowed := CASE v_exc.kind
    WHEN 'FORM_PRINT_UNCERTAIN' THEN ARRAY['FOUND_UNUSED','FOUND_PRINTED','FORM_LOST']
    WHEN 'INVOICE_COLLISION' THEN ARRAY['AUTHORIZE_DISTINCT','REJECT_DUPLICATE']
    WHEN 'TRANSFER_UNALLOCATED' THEN ARRAY['ALLOCATE_REMAINING','DOCUMENTED_NO_ALLOCATION']
    WHEN 'ISSUANCE_OVERRUN' THEN ARRAY['ALLOCATE_REMAINING','DOCUMENTED_NO_ALLOCATION']
    WHEN 'ISSUED_OUTSIDE_CIRCUIT' THEN ARRAY['REGULARIZED','AMOUNT_ESTABLISHED']
    WHEN 'CANCELLED_CHEQUE_PRESENTED' THEN ARRAY['INSTRUCTED_DOCUMENTED']
    WHEN 'MATCH_EVIDENCE_INACTIVE' THEN ARRAY['MATCH_REVOKED','REBOUND_VERIFIED']
    WHEN 'MERGE_COLLISION' THEN ARRAY['MERGE_ABANDONED']
    WHEN 'TAKEOVER_COLLISION' THEN ARRAY['BATCH_ABANDONED']
    WHEN 'PRESIGNED_FORM_RISK' THEN ARRAY['DESTROYED_DOCUMENTED','FORM_LOST']
    WHEN 'FORM_LOST' THEN ARRAY['INSTRUCTED_DOCUMENTED']
    WHEN 'UNISSUED_FORM_PRESENTED' THEN ARRAY['INSTRUCTED_DOCUMENTED']
    ELSE ARRAY[]::text[] END;
  IF p_resolution_code IS NULL OR NOT (p_resolution_code = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'PAYABLES_RESOLUTION_CODE_INVALID';
  END IF;

  IF v_exc.kind = 'FORM_PRINT_UNCERTAIN' THEN
    SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = v_exc.form_id FOR UPDATE;
    IF v_form.state <> 'PRINT_UNCERTAIN' THEN RAISE EXCEPTION 'PAYABLES_FORM_STATE_INVALID'; END IF;
    UPDATE public.payables_cheque_forms
       SET state = CASE p_resolution_code WHEN 'FOUND_UNUSED' THEN 'UNUSED' WHEN 'FOUND_PRINTED' THEN 'PRINTED' ELSE 'LOST' END,
           unused_reason = CASE WHEN p_resolution_code = 'FOUND_PRINTED' THEN unused_reason ELSE v_reason END,
           updated_at = statement_timestamp(), row_version = row_version + 1
     WHERE id = v_exc.form_id;
    IF p_resolution_code = 'FORM_LOST' THEN
      v_followup := payables_private.open_exception(v_actor, 'FORM_LOST', v_reason, NULL, v_exc.payment_id, v_exc.form_id,
        v_form.bank_account_id, false, true);
    END IF;
  ELSIF v_exc.kind IN ('TRANSFER_UNALLOCATED','ISSUANCE_OVERRUN') AND p_resolution_code = 'ALLOCATE_REMAINING' THEN
    -- Décision instruite (jamais automatique) : le fait réalisé consomme au plus
    -- le restant de la facture ; l'excédent reste documenté, jamais réaffecté.
    SELECT * INTO v_payment FROM public.payables_payments WHERE id = v_exc.payment_id FOR UPDATE;
    IF v_exc.kind = 'TRANSFER_UNALLOCATED' THEN
      v_amount := least(v_payment.amount, v_invoice.amount - payables_private.committed_amount(v_invoice.id, NULL));
      IF v_amount <= 0 THEN RAISE EXCEPTION 'PAYABLES_NOTHING_TO_ALLOCATE'; END IF;
      INSERT INTO public.payables_allocations (payment_id, invoice_id, amount, status)
      VALUES (v_payment.id, v_invoice.id, v_amount, 'ENGAGED');
    ELSE
      v_issuance := payables_private.current_issuance(v_exc.form_id);
      v_amount := least(v_issuance.amount, v_invoice.amount - payables_private.committed_amount(v_invoice.id, v_payment.id));
      IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'PAYABLES_NOTHING_TO_ALLOCATE'; END IF;
      UPDATE public.payables_allocations SET amount = v_amount, status = 'ENGAGED', updated_at = statement_timestamp(),
             row_version = row_version + 1
       WHERE payment_id = v_payment.id AND status = 'RESERVED';
      IF NOT FOUND THEN RAISE EXCEPTION 'PAYABLES_ALLOCATION_STATE_INVALID'; END IF;
    END IF;
  ELSIF v_exc.kind = 'INVOICE_COLLISION' AND p_resolution_code = 'AUTHORIZE_DISTINCT' THEN
    v_candidate := v_exc.details->'candidate';
    INSERT INTO public.payables_invoices (supplier_id, reference_exact, collision_ordinal, amount, currency, invoice_date,
      due_date, evidence_ref, created_by)
    SELECT v_invoice.supplier_id, v_invoice.reference_exact,
           (SELECT max(i.collision_ordinal) + 1 FROM public.payables_invoices i
             WHERE i.supplier_id = v_invoice.supplier_id AND i.reference_exact = v_invoice.reference_exact),
           (v_candidate->>'amount')::numeric, 'XOF', (v_candidate->>'invoice_date')::date,
           (v_candidate->>'due_date')::date, v_candidate->>'evidence_ref', (v_candidate->>'created_by')::uuid
    RETURNING id INTO v_new_invoice;
  ELSIF v_exc.kind = 'ISSUED_OUTSIDE_CIRCUIT' THEN
    v_issuance := payables_private.current_issuance(v_exc.form_id);
    IF p_resolution_code = 'REGULARIZED' AND v_issuance.amount IS NULL THEN
      RAISE EXCEPTION 'PAYABLES_AMOUNT_STILL_UNKNOWN';
    END IF;
    IF p_resolution_code = 'AMOUNT_ESTABLISHED' THEN
      IF v_issuance.amount IS NOT NULL OR NOT (v_details ? 'amount') THEN RAISE EXCEPTION 'PAYABLES_RESOLUTION_DETAILS_INVALID'; END IF;
      v_amount := payables_private.xof_amount((v_details->>'amount')::numeric, 'AMOUNT');
      INSERT INTO public.payables_issuances (form_id, revision_no, path, issue_date, amount, exception_reason_code,
        applied_versions, evidence_ref, recorded_by, reason)
      VALUES (v_exc.form_id, v_issuance.revision_no + 1, v_issuance.path, v_issuance.issue_date, v_amount,
        v_issuance.exception_reason_code, v_issuance.applied_versions || jsonb_build_object('amount_established_by', p_exception_id),
        v_evidence, v_actor, v_reason);
      IF v_exc.payment_id IS NOT NULL THEN
        SELECT i.* INTO v_invoice FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
          WHERE p.id = v_exc.payment_id FOR UPDATE OF i;
        SELECT * INTO v_payment FROM public.payables_payments WHERE id = v_exc.payment_id FOR UPDATE;
        -- Facture bloquée (y compris par cette exception) : jamais au-delà de la
        -- réservation existante (arbitrage CTO) ; sinon le restant de la facture.
        IF v_amount <= (CASE WHEN payables_private.invoice_blocked(v_invoice.id)
             THEN (SELECT a.amount FROM public.payables_allocations a WHERE a.payment_id = v_payment.id AND a.status = 'RESERVED')
             ELSE v_invoice.amount - payables_private.committed_amount(v_invoice.id, v_payment.id) END) THEN
          UPDATE public.payables_allocations SET amount = v_amount, status = 'ENGAGED', updated_at = statement_timestamp(),
                 row_version = row_version + 1
           WHERE payment_id = v_payment.id AND status = 'RESERVED';
          UPDATE public.payables_payments SET amount = v_amount, updated_at = statement_timestamp(), row_version = row_version + 1
           WHERE id = v_payment.id;
        ELSE
          v_followup := payables_private.open_exception(v_actor, 'ISSUANCE_OVERRUN',
            'Montant établi au-delà du plafond du paiement', v_invoice.id, v_payment.id, v_exc.form_id,
            v_exc.bank_account_id, true, false);
        END IF;
      END IF;
      -- Le montant est désormais connu ; l'exception d'émission reste ouverte
      -- jusqu'à régularisation documentée. Le blocage de la facture lié au
      -- montant inconnu est levé ; un dépassement reste bloqué par sa propre
      -- exception.
      UPDATE public.payables_exceptions SET details = details || jsonb_build_object('amount_known', true),
             blocks_invoice = false, row_version = row_version + 1 WHERE id = p_exception_id;
      PERFORM payables_private.append_event(v_actor, v_cmd, 'ISSUANCE_AMOUNT_ESTABLISHED', 'EXCEPTION', p_exception_id,
        gen_random_uuid(), v_reason, NULL, jsonb_build_object('followup_exception_id', v_followup));
      RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
        'exception_id', p_exception_id, 'status', 'OPEN', 'followup_exception_id', v_followup));
    END IF;
  ELSIF v_exc.kind = 'MATCH_EVIDENCE_INACTIVE' THEN
    -- Objets définis par la migration de suivi bancaire (résolution à l'exécution).
    IF p_resolution_code = 'MATCH_REVOKED' THEN
      PERFORM payables_private.revoke_bank_match(v_actor, v_exc.match_id, v_cmd, v_reason);
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.payables_bank_match_proposals m
      JOIN public.daily_statement_lines_canonical l ON l.id = m.line_id
      WHERE m.supersedes_id = v_exc.match_id AND m.status = 'CONFIRMED' AND l.is_active) THEN
      RAISE EXCEPTION 'PAYABLES_REBIND_NOT_FOUND';
    END IF;
  ELSIF v_exc.kind = 'MERGE_COLLISION' THEN
    UPDATE public.payables_supplier_merges SET status = 'REJECTED', row_version = row_version + 1
     WHERE id = v_exc.supplier_merge_id AND status = 'PENDING_INSTRUCTION';
    UPDATE public.payables_exceptions SET status = 'RESOLVED', resolution_code = p_resolution_code,
           resolution_reason = v_reason, resolution_evidence_ref = v_evidence, resolved_by = v_actor,
           resolved_at = statement_timestamp(), row_version = row_version + 1
     WHERE supplier_merge_id = v_exc.supplier_merge_id AND status = 'OPEN' AND id <> p_exception_id
       AND opened_by <> v_actor;
  ELSIF v_exc.kind = 'TAKEOVER_COLLISION' THEN
    UPDATE public.payables_takeover_batches SET status = 'REJECTED', row_version = row_version + 1
     WHERE id = v_exc.takeover_batch_id AND status = 'COLLISION';
  ELSIF v_exc.kind = 'PRESIGNED_FORM_RISK' THEN
    SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = v_exc.form_id FOR UPDATE;
    IF v_form.state <> 'PRESIGNED_HELD' THEN RAISE EXCEPTION 'PAYABLES_FORM_STATE_INVALID'; END IF;
    UPDATE public.payables_cheque_forms
       SET state = CASE WHEN p_resolution_code = 'FORM_LOST' THEN 'LOST' ELSE 'UNUSED' END,
           unused_reason = v_reason, updated_at = statement_timestamp(), row_version = row_version + 1
     WHERE id = v_exc.form_id;
    IF p_resolution_code = 'FORM_LOST' THEN
      v_followup := payables_private.open_exception(v_actor, 'FORM_LOST', v_reason, NULL, NULL, v_exc.form_id,
        v_form.bank_account_id, false, true);
    END IF;
  END IF;

  UPDATE public.payables_exceptions SET status = 'RESOLVED', resolution_code = p_resolution_code,
         resolution_reason = v_reason, resolution_evidence_ref = v_evidence, resolved_by = v_actor,
         resolved_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = p_exception_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'EXCEPTION_RESOLVED', 'EXCEPTION', p_exception_id,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('kind', v_exc.kind, 'resolution_code', p_resolution_code,
    'new_invoice_id', v_new_invoice, 'followup_exception_id', v_followup));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'exception_id', p_exception_id, 'status', 'RESOLVED', 'new_invoice_id', v_new_invoice,
    'followup_exception_id', v_followup));
END;
$$;

-- --------------------------------------------------------------------------
-- 15. API : verrous de traitement (confort d'équipe, jamais l'intégrité)
-- --------------------------------------------------------------------------

CREATE FUNCTION payables_private.require_any_work_capability(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT (payables_private.has_capability(p_actor, 'CHEQUE_PREPARE_PRINT')
       OR payables_private.has_capability(p_actor, 'CHEQUE_CONFIRM_ISSUE')
       OR payables_private.has_capability(p_actor, 'EXIT_REQUEST')
       OR payables_private.has_capability(p_actor, 'EXIT_VALIDATE')
       OR payables_private.has_capability(p_actor, 'EXCEPTION_INSTRUCT')
       OR payables_private.has_capability(p_actor, 'INVOICE_MANAGE')
       OR payables_private.has_capability(p_actor, 'BANK_FOLLOWUP')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_CAPABILITY_REQUIRED:WORK';
  END IF;
END;
$$;

CREATE FUNCTION public.payables_acquire_lock_v1(p_object_type text, p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_lock public.payables_work_locks; v_minutes integer;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_any_work_capability(v_actor);
  IF p_object_type IS NULL OR p_object_type NOT IN ('PAYMENT','FORM','INVOICE','EXCEPTION') OR p_object_id IS NULL THEN
    RAISE EXCEPTION 'PAYABLES_LOCK_TARGET_INVALID';
  END IF;
  IF NOT (CASE p_object_type
       WHEN 'PAYMENT' THEN EXISTS (SELECT 1 FROM public.payables_payments x WHERE x.id = p_object_id)
       WHEN 'FORM' THEN EXISTS (SELECT 1 FROM public.payables_cheque_forms x WHERE x.id = p_object_id)
       WHEN 'INVOICE' THEN EXISTS (SELECT 1 FROM public.payables_invoices x WHERE x.id = p_object_id)
       ELSE EXISTS (SELECT 1 FROM public.payables_exceptions x WHERE x.id = p_object_id) END) THEN
    RAISE EXCEPTION 'PAYABLES_LOCK_TARGET_INVALID';
  END IF;
  SELECT rc.lock_minutes INTO v_minutes FROM payables_private.runtime_control rc WHERE rc.singleton;
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:lock:' || p_object_type || ':' || p_object_id::text, 0));
  SELECT * INTO v_lock FROM public.payables_work_locks l
   WHERE l.object_type = p_object_type AND l.object_id = p_object_id AND l.released_at IS NULL FOR UPDATE;
  IF v_lock.id IS NOT NULL AND v_lock.expires_at <= statement_timestamp() THEN
    UPDATE public.payables_work_locks SET released_at = statement_timestamp(), release_kind = 'EXPIRED' WHERE id = v_lock.id;
    PERFORM payables_private.append_event(v_actor, 'ACQUIRE_LOCK', 'LOCK_EXPIRED', 'WORK_LOCK', v_lock.id, gen_random_uuid(),
      NULL, NULL, jsonb_build_object('previous_holder', v_lock.holder));
    v_lock := NULL;
  END IF;
  IF v_lock.id IS NOT NULL AND v_lock.holder <> v_actor THEN
    RETURN jsonb_build_object('outcome', 'HELD_BY_OTHER', 'lock_id', v_lock.id, 'holder', v_lock.holder,
      'expires_at', v_lock.expires_at);
  END IF;
  IF v_lock.id IS NOT NULL THEN
    UPDATE public.payables_work_locks SET expires_at = statement_timestamp() + make_interval(mins => v_minutes)
     WHERE id = v_lock.id RETURNING * INTO v_lock;
    RETURN jsonb_build_object('outcome', 'EXTENDED', 'lock_id', v_lock.id, 'holder', v_actor, 'expires_at', v_lock.expires_at);
  END IF;
  INSERT INTO public.payables_work_locks (object_type, object_id, holder, expires_at)
  VALUES (p_object_type, p_object_id, v_actor, statement_timestamp() + make_interval(mins => v_minutes))
  RETURNING * INTO v_lock;
  PERFORM payables_private.append_event(v_actor, 'ACQUIRE_LOCK', 'LOCK_ACQUIRED', 'WORK_LOCK', v_lock.id, gen_random_uuid(),
    NULL, NULL, jsonb_build_object('object_type', p_object_type, 'object_id', p_object_id));
  RETURN jsonb_build_object('outcome', 'ACQUIRED', 'lock_id', v_lock.id, 'holder', v_actor, 'expires_at', v_lock.expires_at);
END;
$$;

CREATE FUNCTION public.payables_release_lock_v1(p_lock_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid := payables_private.require_actor(); v_lock public.payables_work_locks;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  SELECT * INTO v_lock FROM public.payables_work_locks WHERE id = p_lock_id FOR UPDATE;
  IF v_lock.id IS NULL OR v_lock.released_at IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'NOT_HELD'); END IF;
  IF v_lock.holder <> v_actor THEN RAISE EXCEPTION 'PAYABLES_LOCKED_BY_OTHER'; END IF;
  UPDATE public.payables_work_locks SET released_at = statement_timestamp(), released_by = v_actor, release_kind = 'RELEASED'
   WHERE id = p_lock_id;
  PERFORM payables_private.append_event(v_actor, 'RELEASE_LOCK', 'LOCK_RELEASED', 'WORK_LOCK', p_lock_id, gen_random_uuid(), NULL);
  RETURN jsonb_build_object('outcome', 'RELEASED');
END;
$$;

CREATE FUNCTION public.payables_force_release_lock_v1(p_command_key text, p_lock_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'FORCE_RELEASE_LOCK';
  v_replay jsonb; v_lock public.payables_work_locks; v_reason text;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_any_work_capability(v_actor);
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object('lock_id', p_lock_id, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_lock FROM public.payables_work_locks WHERE id = p_lock_id FOR UPDATE;
  IF v_lock.id IS NULL OR v_lock.released_at IS NOT NULL THEN RAISE EXCEPTION 'PAYABLES_LOCK_STATE_INVALID'; END IF;
  -- Levée par un autre comptable habilité, toujours tracée.
  IF v_lock.holder = v_actor THEN RAISE EXCEPTION 'PAYABLES_SECOND_ACTOR_REQUIRED'; END IF;
  UPDATE public.payables_work_locks SET released_at = statement_timestamp(), released_by = v_actor,
         release_kind = 'FORCED', release_reason = v_reason
   WHERE id = p_lock_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'LOCK_FORCED_RELEASE', 'WORK_LOCK', p_lock_id, gen_random_uuid(),
    v_reason, NULL, jsonb_build_object('previous_holder', v_lock.holder));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('lock_id', p_lock_id, 'outcome', 'FORCED'));
END;
$$;

-- --------------------------------------------------------------------------
-- 16. Lecture : capacités courantes, état de l'interrupteur, aperçus
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_current_actor_has_capability(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT auth.uid() IS NOT NULL AND payables_private.has_capability(auth.uid(), upper(p_capability)) $$;

CREATE FUNCTION public.payables_current_actor_can_read()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (payables_private.has_capability(auth.uid(), 'READ') OR payables_private.has_capability(auth.uid(), 'AUDIT'))
$$;

CREATE FUNCTION public.payables_my_access_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid := payables_private.require_actor(); v_caps text[]; v_enabled boolean;
BEGIN
  SELECT array_agg(c ORDER BY c) INTO v_caps
  FROM unnest(ARRAY['READ','AUDIT','INVOICE_MANAGE','SUPPLIER_MANAGE','SUPPLIER_MERGE_VALIDATE','CHEQUE_PREPARE_PRINT',
    'CHEQUE_CONFIRM_ISSUE','TRANSFER_DECLARE','EXIT_REQUEST','EXIT_VALIDATE','BANK_FOLLOWUP','BANK_READ',
    'EXCEPTION_INSTRUCT','PARAM_PROPOSE','PARAM_VALIDATE']) c
  WHERE payables_private.has_capability(v_actor, c);
  SELECT rc.business_writes_enabled INTO v_enabled FROM payables_private.runtime_control rc WHERE rc.singleton;
  RETURN jsonb_build_object('user_id', v_actor, 'capabilities', coalesce(to_jsonb(v_caps), '[]'::jsonb),
    'person_id', payables_private.person_of_user(v_actor), 'business_writes_enabled', coalesce(v_enabled, false),
    'export_enabled', false);
END;
$$;

CREATE FUNCTION public.payables_invoice_overview_v1()
RETURNS TABLE (
  invoice_id uuid, supplier_id uuid, supplier_name text, reference_exact text, collision_ordinal integer,
  amount numeric, currency text, invoice_date date, due_date date, reserved_amount numeric, engaged_amount numeric,
  remaining_amount numeric, blocked boolean, row_version integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid := payables_private.require_actor();
BEGIN
  IF NOT (payables_private.has_capability(v_actor, 'READ') OR payables_private.has_capability(v_actor, 'AUDIT')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_CAPABILITY_REQUIRED:READ';
  END IF;
  RETURN QUERY
  SELECT i.id, s.id, s.canonical_name, i.reference_exact, i.collision_ordinal, i.amount, i.currency, i.invoice_date,
         i.due_date,
         coalesce(sum(a.amount) FILTER (WHERE a.status = 'RESERVED'), 0),
         coalesce(sum(a.amount) FILTER (WHERE a.status = 'ENGAGED'), 0),
         -- Restant indisponible (NULL) tant qu'une exception bloque la facture.
         CASE WHEN bool_or(e.id IS NOT NULL) THEN NULL
              ELSE i.amount - coalesce(sum(a.amount) FILTER (WHERE a.status IN ('RESERVED','ENGAGED')), 0) END,
         bool_or(e.id IS NOT NULL),
         i.row_version
  FROM public.payables_invoices i
  JOIN public.payables_suppliers s ON s.id = i.supplier_id
  LEFT JOIN public.payables_allocations a ON a.invoice_id = i.id
  LEFT JOIN LATERAL (SELECT x.id FROM public.payables_exceptions x
                     WHERE x.invoice_id = i.id AND x.status = 'OPEN' AND x.blocks_invoice LIMIT 1) e ON true
  GROUP BY i.id, s.id
  -- Ordre total : la lecture paginée côté client reste déterministe.
  ORDER BY i.due_date NULLS LAST, i.created_at, i.id;
END;
$$;

-- Comptes du registre Daily v2 (métadonnées seules : banque, alias, devise) :
-- aucune donnée bancaire (solde, relevé, ligne) n'est exposée par cette lecture.
CREATE FUNCTION public.payables_accounts_v1()
RETURNS TABLE (account_id uuid, bank text, account_alias text, currency text, bank_qualified boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid := payables_private.require_actor();
BEGIN
  IF NOT (payables_private.has_capability(v_actor, 'READ') OR payables_private.has_capability(v_actor, 'AUDIT')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_CAPABILITY_REQUIRED:READ';
  END IF;
  RETURN QUERY
  SELECT r.id, r.bank, r.safe_alias, r.currency, r.bank IN ('BDK','ORA','ATB','BICIS')
  FROM public.daily_statement_account_registry r
  WHERE r.status = 'active'
  ORDER BY r.bank, r.safe_alias, r.id;
END;
$$;

-- --------------------------------------------------------------------------
-- 17. RLS, droits et surface d'API
-- --------------------------------------------------------------------------

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'payables_persons','payables_person_links','payables_parameter_versions','payables_suppliers',
    'payables_supplier_merges','payables_invoices','payables_payments','payables_allocations',
    'payables_cheque_forms','payables_cheque_contents','payables_print_events','payables_signatures',
    'payables_issuances','payables_deliveries','payables_transfer_declarations',
    'payables_takeover_batches','payables_takeover_items','payables_exceptions','payables_work_locks'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.payables_current_actor_can_read())',
      v_table || '_read', v_table);
  END LOOP;
END $$;

-- Une sortie par rapprochement porte des dates de relevé bancaire : lisible
-- seulement avec la capacité bancaire explicite du domaine (BANK_READ).
ALTER TABLE public.payables_exits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payables_exits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.payables_exits TO authenticated;
CREATE POLICY payables_exits_read ON public.payables_exits
  FOR SELECT TO authenticated
  USING (public.payables_current_actor_can_read()
         AND (kind <> 'BANK_MATCH' OR public.payables_current_actor_has_capability('BANK_READ')));

ALTER TABLE public.payables_capability_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payables_capability_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.payables_capability_grants TO authenticated;
CREATE POLICY payables_capability_grants_read ON public.payables_capability_grants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR public.payables_current_actor_has_capability('PARAM_PROPOSE')
         OR public.payables_current_actor_has_capability('PARAM_VALIDATE')
         OR public.payables_current_actor_has_capability('AUDIT'));

ALTER TABLE public.payables_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payables_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.payables_events TO authenticated;
CREATE POLICY payables_events_audit_read ON public.payables_events
  FOR SELECT TO authenticated USING (public.payables_current_actor_has_capability('AUDIT'));

ALTER TABLE public.payables_command_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payables_command_idempotency FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.payables_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE payables_private.decision_seq FROM PUBLIC, anon, authenticated, service_role;

-- Toute fonction du domaine est d'abord fermée (y compris le privilège
-- service_role accordé par défaut par la plateforme), puis seule l'API utile
-- est ouverte au rôle authenticated.
DO $$
DECLARE v_proc record;
BEGIN
  FOR v_proc IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'public' AND p.proname LIKE 'payables\_%' ESCAPE '\') OR n.nspname = 'payables_private'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_proc.signature);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.payables_propose_capability_v1(text,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_decide_capability_v1(text,uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_propose_person_v1(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_decide_person_v1(text,uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_propose_person_link_v1(text,uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_decide_person_link_v1(text,uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_propose_parameter_v1(text,text,text,date,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_decide_parameter_v1(text,uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_create_supplier_v1(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_propose_supplier_merge_v1(text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_decide_supplier_merge_v1(text,uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_create_invoice_v1(text,uuid,text,numeric,text,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_correct_invoice_v1(text,uuid,integer,numeric,date,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_create_cheque_request_v1(text,uuid,uuid,text,numeric,boolean,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_adjust_payment_v1(text,uuid,integer,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_abandon_payment_v1(text,uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_assign_cheque_form_v1(text,uuid,integer,text,text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_revise_cheque_content_v1(text,uuid,integer,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_record_print_intent_v1(text,uuid,integer,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_record_print_outcome_v1(text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_record_unused_form_v1(text,uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_record_signature_v1(text,uuid,uuid,uuid,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_confirm_issuance_v1(text,uuid,integer,date,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_declare_issuance_exception_v1(text,uuid,text,numeric,date,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_record_delivery_v1(text,uuid,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_request_exit_v1(text,uuid,integer,text,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_validate_exit_v1(text,uuid,integer,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_declare_transfer_v1(text,uuid,uuid,text,numeric,text,text,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_prepare_takeover_v1(text,uuid,date,text,integer,numeric,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_decide_takeover_v1(text,uuid,integer,boolean,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_record_presigned_form_v1(text,uuid,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_resolve_exception_v1(text,uuid,integer,text,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_acquire_lock_v1(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_release_lock_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_force_release_lock_v1(text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_current_actor_has_capability(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_current_actor_can_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_my_access_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_invoice_overview_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_accounts_v1() TO authenticated;

COMMIT;
