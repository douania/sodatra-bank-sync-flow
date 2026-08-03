-- ============================================================================
-- 0Z1B — Collections et Remises : noyau opérationnel additif
-- ============================================================================
-- LOCAL CANDIDATE ONLY. Ne pas appliquer sur Supabase sans GO environnement.
-- Le module prépare, contrôle et justifie les flux. Il ne passe aucune
-- écriture comptable et n'exécute aucun paiement.
--
-- Principes :
--   * collection_report et Daily v2 restent intacts ;
--   * aucune DML directe pour les rôles applicatifs ;
--   * commandes SECURITY DEFINER, session/capacité/idempotence/version ;
--   * événements et audit append-only ;
--   * preuve bancaire = ligne canonical Daily v2 active ;
--   * nominal, agios attendus et agios observés restent distincts.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Habilitations et idempotence
-- --------------------------------------------------------------------------

CREATE TABLE public.collection_domain_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  capability    text NOT NULL CHECK (capability IN (
                  'ENTRY','PROPOSE_MATCH','CONFIRM_MATCH',
                  'APPROVE_PROROGATION','ISSUE_FUNDING_CHEQUE',
                  'CONFIRM_DELIVERY','CORRECT_EVENT','AUDIT','MANAGE_CONFIG'
                )),
  scope_type    text NOT NULL DEFAULT 'GLOBAL' CHECK (scope_type IN ('GLOBAL','ACCOUNT')),
  scope_id      uuid,
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_until   timestamptz,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  granted_by    uuid NOT NULL REFERENCES auth.users (id),
  reason        text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 500),
  CONSTRAINT collection_assignment_scope_coherent CHECK (
    (scope_type = 'GLOBAL' AND scope_id IS NULL)
    OR (scope_type = 'ACCOUNT' AND scope_id IS NOT NULL)
  ),
  CONSTRAINT collection_assignment_validity CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  UNIQUE NULLS NOT DISTINCT (actor_id, capability, scope_type, scope_id, valid_from)
);

CREATE INDEX idx_collection_assignments_actor_active
  ON public.collection_domain_assignments (actor_id, capability, valid_from, valid_until);

CREATE TABLE public.collection_command_idempotency (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id          uuid NOT NULL REFERENCES auth.users (id),
  command_name      text NOT NULL CHECK (char_length(command_name) BETWEEN 3 AND 100),
  idempotency_key   text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_payload   jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  result_payload    jsonb CHECK (result_payload IS NULL OR jsonb_typeof(result_payload) = 'object'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  CONSTRAINT collection_idempotency_completion_coherent CHECK (
    (result_payload IS NULL AND completed_at IS NULL)
    OR (result_payload IS NOT NULL AND completed_at IS NOT NULL)
  ),
  UNIQUE (actor_id, command_name, idempotency_key)
);

-- --------------------------------------------------------------------------
-- 2. Remises, origines, titres et factures
-- --------------------------------------------------------------------------

CREATE TABLE public.collection_receipts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type                text NOT NULL CHECK (source_type IN ('EXCEL','MANUAL','API','MIGRATION')),
  client_reference           text,
  client_name_snapshot       text NOT NULL CHECK (char_length(btrim(client_name_snapshot)) BETWEEN 1 AND 200),
  method                     text NOT NULL CHECK (method IN ('CHEQUE','EFFECT','TRANSFER','CASH')),
  business_nature            text NOT NULL CHECK (business_nature IN ('INVOICE_SETTLEMENT','PROROGATION','OTHER')),
  amount                     numeric(18,2) NOT NULL CHECK (amount > 0),
  currency                   text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  bank_submission_date       date NOT NULL,
  counterparty_bank_snapshot text,
  deposit_account_registry_id uuid REFERENCES public.daily_statement_account_registry (id),
  declared_bank_credit_date  date,
  routing_state              text NOT NULL DEFAULT 'DRAFT' CHECK (routing_state IN (
                               'DRAFT','RECEIVED','SUBMITTED','ACCEPTED','REJECTED','CANCELLED'
                             )),
  settlement_state           text NOT NULL DEFAULT 'UNMATCHED' CHECK (settlement_state IN (
                               'UNMATCHED','PROPOSED','PARTIALLY_MATCHED','CONFIRMED','REVERSED'
                             )),
  recourse_state             text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (recourse_state IN (
                               'NOT_APPLICABLE','UNMATURED_EXPOSURE','SETTLED',
                               'UNPAID','RECOURSE_OPEN','RECOURSE_CLOSED'
                             )),
  version                    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL REFERENCES auth.users (id),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid NOT NULL REFERENCES auth.users (id),
  CONSTRAINT collection_receipt_prorogation_not_invoice CHECK (
    business_nature <> 'PROROGATION' OR method = 'EFFECT'
  )
);

CREATE INDEX idx_collection_receipts_states
  ON public.collection_receipts (routing_state, settlement_state, recourse_state);
CREATE INDEX idx_collection_receipts_account_date
  ON public.collection_receipts (deposit_account_registry_id, bank_submission_date);

CREATE TABLE public.collection_import_origins (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id                 uuid NOT NULL UNIQUE REFERENCES public.collection_receipts (id),
  source_system              text NOT NULL CHECK (char_length(btrim(source_system)) BETWEEN 1 AND 80),
  excel_filename             text NOT NULL CHECK (char_length(btrim(excel_filename)) BETWEEN 1 AND 255),
  excel_source_row           integer NOT NULL CHECK (excel_source_row > 0),
  excel_processed_at         timestamptz,
  unique_excel_traceability  text,
  legacy_collection_report_id uuid REFERENCES public.collection_report (id),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, excel_filename, excel_source_row)
);

CREATE UNIQUE INDEX uq_collection_import_legacy_trace_nonnull
  ON public.collection_import_origins (unique_excel_traceability)
  WHERE unique_excel_traceability IS NOT NULL;

CREATE TABLE public.collection_instruments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id            uuid NOT NULL UNIQUE REFERENCES public.collection_receipts (id),
  instrument_type       text NOT NULL CHECK (instrument_type IN ('CHEQUE','EFFECT')),
  nominal_amount        numeric(18,2) NOT NULL CHECK (nominal_amount > 0),
  currency              text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  cheque_number         text,
  effect_reference      text,
  maturity_date         date,
  drawee_bank_snapshot  text,
  received_at           date,
  quality_state         text NOT NULL DEFAULT 'COMPLETE' CHECK (quality_state IN (
                          'COMPLETE','INCOMPLETE_LEGACY','DISPUTED'
                        )),
  settlement_state      text NOT NULL DEFAULT 'UNSETTLED' CHECK (settlement_state IN (
                          'UNSETTLED','PARTIALLY_SETTLED','SETTLED','UNPAID','RECOURSE_OPEN','RECOURSE_CLOSED'
                        )),
  settled_amount        numeric(18,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users (id),
  CONSTRAINT collection_instrument_shape CHECK (
    (instrument_type = 'CHEQUE' AND char_length(btrim(cheque_number)) >= 1 AND maturity_date IS NULL)
    OR
    (instrument_type = 'EFFECT' AND cheque_number IS NULL AND maturity_date IS NOT NULL)
  ),
  CONSTRAINT collection_instrument_settlement_bound CHECK (settled_amount <= nominal_amount)
);

CREATE TABLE public.collection_instrument_identities (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id            uuid NOT NULL REFERENCES public.collection_instruments (id),
  identity_namespace       text NOT NULL CHECK (char_length(btrim(identity_namespace)) BETWEEN 1 AND 100),
  normalized_identity_hash text NOT NULL CHECK (normalized_identity_hash ~ '^[0-9a-f]{64}$'),
  identity_strength        text NOT NULL CHECK (identity_strength IN ('STRONG_VERIFIED','PROBABILISTIC')),
  verified_at              timestamptz,
  verified_by              uuid REFERENCES auth.users (id),
  CONSTRAINT collection_identity_verification_coherent CHECK (
    (identity_strength = 'STRONG_VERIFIED' AND verified_at IS NOT NULL AND verified_by IS NOT NULL)
    OR identity_strength = 'PROBABILISTIC'
  )
);

CREATE UNIQUE INDEX uq_collection_instrument_identity_strong
  ON public.collection_instrument_identities (identity_namespace, normalized_identity_hash)
  WHERE identity_strength = 'STRONG_VERIFIED';

CREATE TABLE public.collection_invoice_allocations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id              uuid NOT NULL REFERENCES public.collection_receipts (id),
  invoice_reference       text NOT NULL CHECK (char_length(btrim(invoice_reference)) BETWEEN 1 AND 120),
  invoice_amount_snapshot numeric(18,2) CHECK (invoice_amount_snapshot > 0),
  allocated_amount        numeric(18,2) NOT NULL CHECK (allocated_amount > 0),
  currency                text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  review_required         boolean NOT NULL,
  allocation_state        text NOT NULL DEFAULT 'DECLARED' CHECK (allocation_state IN ('DECLARED','VALIDATED','REVERSED')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL REFERENCES auth.users (id),
  CONSTRAINT collection_invoice_review_coherent CHECK (
    invoice_amount_snapshot IS NOT NULL OR review_required
  )
);

CREATE INDEX idx_collection_invoice_allocations_reference
  ON public.collection_invoice_allocations (invoice_reference, allocation_state);

-- --------------------------------------------------------------------------
-- 3. Bordereaux et frais
-- --------------------------------------------------------------------------

CREATE TABLE public.collection_bank_remittances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_reference  text NOT NULL UNIQUE CHECK (char_length(btrim(remittance_reference)) BETWEEN 1 AND 120),
  method_scope          text NOT NULL CHECK (method_scope IN ('CHEQUE','EFFECT','CASH')),
  effect_mode           text CHECK (effect_mode IN ('COLLECTION','DISCOUNT')),
  account_registry_id   uuid NOT NULL REFERENCES public.daily_statement_account_registry (id),
  bank_submission_date  date NOT NULL,
  currency              text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                          'DRAFT','SUBMITTED','PARTIALLY_ACCEPTED','ACCEPTED','REJECTED','CLOSED','CANCELLED'
                        )),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users (id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NOT NULL REFERENCES auth.users (id),
  CONSTRAINT collection_remittance_effect_mode_coherent CHECK (
    (method_scope = 'EFFECT' AND effect_mode IS NOT NULL)
    OR (method_scope <> 'EFFECT' AND effect_mode IS NULL)
  )
);

CREATE TABLE public.collection_bank_remittance_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id         uuid NOT NULL REFERENCES public.collection_bank_remittances (id),
  receipt_id            uuid NOT NULL REFERENCES public.collection_receipts (id),
  instrument_id         uuid REFERENCES public.collection_instruments (id),
  presented_amount      numeric(18,2) NOT NULL CHECK (presented_amount > 0),
  accepted_amount       numeric(18,2) CHECK (accepted_amount >= 0),
  acceptance_state      text NOT NULL DEFAULT 'PENDING' CHECK (acceptance_state IN (
                          'PENDING','ACCEPTED','PARTIALLY_ACCEPTED','REJECTED','WITHDRAWN'
                        )),
  presentation_attempt  integer NOT NULL DEFAULT 1 CHECK (presentation_attempt >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users (id),
  CONSTRAINT collection_remittance_item_acceptance_bound CHECK (
    accepted_amount IS NULL OR accepted_amount <= presented_amount
  ),
  UNIQUE (remittance_id, receipt_id, presentation_attempt)
);

CREATE UNIQUE INDEX uq_collection_instrument_active_presentation
  ON public.collection_bank_remittance_items (instrument_id)
  WHERE instrument_id IS NOT NULL AND acceptance_state IN ('PENDING','ACCEPTED','PARTIALLY_ACCEPTED');

CREATE TABLE public.collection_charge_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_registry_id   uuid NOT NULL REFERENCES public.daily_statement_account_registry (id),
  product_code          text NOT NULL CHECK (char_length(btrim(product_code)) BETWEEN 1 AND 80),
  effective_from        date NOT NULL,
  effective_until       date,
  annual_rate           numeric(12,8) NOT NULL DEFAULT 0 CHECK (annual_rate >= 0),
  day_count_basis       integer NOT NULL CHECK (day_count_basis IN (360,365)),
  fixed_commission      numeric(18,2) NOT NULL DEFAULT 0 CHECK (fixed_commission >= 0),
  percent_commission    numeric(12,8) NOT NULL DEFAULT 0 CHECK (percent_commission >= 0),
  minimum_commission    numeric(18,2) NOT NULL DEFAULT 0 CHECK (minimum_commission >= 0),
  tax_rate              numeric(12,8) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  rounding_scale        integer NOT NULL DEFAULT 0 CHECK (rounding_scale BETWEEN 0 AND 2),
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users (id),
  approved_at           timestamptz,
  approved_by           uuid REFERENCES auth.users (id),
  reason                text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 500),
  CONSTRAINT collection_charge_rule_period CHECK (
    effective_until IS NULL OR effective_until >= effective_from
  ),
  CONSTRAINT collection_charge_rule_approval_coherent CHECK (
    (status = 'DRAFT' AND approved_at IS NULL AND approved_by IS NULL)
    OR (status <> 'DRAFT' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND created_by <> approved_by)
  )
);

CREATE UNIQUE INDEX uq_collection_charge_rules_open_period
  ON public.collection_charge_rules (account_registry_id, product_code)
  WHERE effective_until IS NULL AND status = 'ACTIVE';

CREATE TABLE public.collection_remittance_charges (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id         uuid REFERENCES public.collection_bank_remittances (id),
  remittance_item_id    uuid REFERENCES public.collection_bank_remittance_items (id),
  charge_type           text NOT NULL CHECK (charge_type IN ('INTEREST','COMMISSION','TAX','OTHER')),
  expected_amount       numeric(18,2) CHECK (expected_amount >= 0),
  observed_amount       numeric(18,2) CHECK (observed_amount >= 0),
  currency              text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  calculation_basis     jsonb CHECK (calculation_basis IS NULL OR jsonb_typeof(calculation_basis) = 'object'),
  verification_state    text NOT NULL DEFAULT 'ESTIMATED' CHECK (verification_state IN (
                          'ESTIMATED','OBSERVED','RECONCILED','DISPUTED'
                        )),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users (id),
  CONSTRAINT collection_charge_scope CHECK (
    remittance_id IS NOT NULL OR remittance_item_id IS NOT NULL
  )
);

-- --------------------------------------------------------------------------
-- 4. Prorogations et registre de chèques sortants
-- --------------------------------------------------------------------------

CREATE TABLE public.collection_prorogations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_reference         text NOT NULL CHECK (char_length(btrim(client_reference)) BETWEEN 1 AND 120),
  target_nominal           numeric(18,2) NOT NULL CHECK (target_nominal > 0),
  currency                 text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  earliest_effect_maturity date,
  funding_deadline         date,
  status                   text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                             'DRAFT','EFFECTS_PARTIAL','EFFECTS_COMPLETE','FUNDING_PARTIAL',
                             'FUNDING_COMPLETE','MATURITY_MONITORING','CLOSED','CANCELLED','EXCEPTION'
                           )),
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES auth.users (id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NOT NULL REFERENCES auth.users (id),
  CONSTRAINT collection_prorogation_deadline CHECK (
    funding_deadline IS NULL OR earliest_effect_maturity IS NULL
    OR funding_deadline <= earliest_effect_maturity
  )
);

CREATE TABLE public.collection_prorogation_source_allocations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prorogation_id           uuid NOT NULL REFERENCES public.collection_prorogations (id),
  source_reference_type    text NOT NULL CHECK (source_reference_type IN ('INVOICE','EFFECT','RECEIVABLE')),
  source_reference         text NOT NULL CHECK (char_length(btrim(source_reference)) BETWEEN 1 AND 160),
  allocated_amount         numeric(18,2) NOT NULL CHECK (allocated_amount > 0),
  currency                 text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  accounting_review_state  text NOT NULL DEFAULT 'PENDING' CHECK (accounting_review_state IN ('PENDING','VALIDATED','DISPUTED')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES auth.users (id),
  UNIQUE (prorogation_id, source_reference_type, source_reference)
);

CREATE TABLE public.collection_prorogation_replacement_effects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prorogation_id     uuid NOT NULL REFERENCES public.collection_prorogations (id),
  instrument_id      uuid NOT NULL UNIQUE REFERENCES public.collection_instruments (id),
  allocated_nominal  numeric(18,2) NOT NULL CHECK (allocated_nominal > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES auth.users (id)
);

CREATE TABLE public.collection_outbound_cheques (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose               text NOT NULL CHECK (purpose IN ('PROROGATION_FUNDING')),
  account_registry_id   uuid NOT NULL REFERENCES public.daily_statement_account_registry (id),
  beneficiary_snapshot  text NOT NULL CHECK (char_length(btrim(beneficiary_snapshot)) BETWEEN 1 AND 200),
  cheque_number         text NOT NULL CHECK (char_length(btrim(cheque_number)) BETWEEN 1 AND 80),
  amount                numeric(18,2) NOT NULL CHECK (amount > 0),
  currency              text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  issue_date            date NOT NULL,
  delivery_date         date,
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                          'DRAFT','ISSUED','DELIVERED','PRESENTED',
                          'PARTIALLY_DEBITED','DEBITED','CANCELLED','REPLACED'
                        )),
  debited_amount        numeric(18,2) NOT NULL DEFAULT 0 CHECK (debited_amount >= 0),
  delivery_evidence_ref text,
  replacement_for_id    uuid REFERENCES public.collection_outbound_cheques (id),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users (id),
  approved_at           timestamptz,
  approved_by           uuid REFERENCES auth.users (id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NOT NULL REFERENCES auth.users (id),
  CONSTRAINT collection_outbound_cheque_approval_coherent CHECK (
    (status = 'DRAFT' AND approved_at IS NULL AND approved_by IS NULL)
    OR (status <> 'DRAFT' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND created_by <> approved_by)
  ),
  CONSTRAINT collection_outbound_cheque_debit_bound CHECK (debited_amount <= amount),
  CONSTRAINT collection_outbound_cheque_delivery_coherent CHECK (
    (status IN ('DRAFT','ISSUED','CANCELLED','REPLACED') AND delivery_date IS NULL)
    OR (status IN ('DELIVERED','PRESENTED','PARTIALLY_DEBITED','DEBITED') AND delivery_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_collection_outbound_cheque_active_number
  ON public.collection_outbound_cheques (account_registry_id, lower(btrim(cheque_number)))
  WHERE status NOT IN ('CANCELLED','REPLACED');

CREATE TABLE public.collection_prorogation_funding_cheques (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prorogation_id   uuid NOT NULL REFERENCES public.collection_prorogations (id),
  outbound_cheque_id uuid NOT NULL UNIQUE REFERENCES public.collection_outbound_cheques (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES auth.users (id)
);

-- --------------------------------------------------------------------------
-- 5. Événements, rapprochements et préparation d'export
-- --------------------------------------------------------------------------

CREATE TABLE public.collection_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type      text NOT NULL CHECK (aggregate_type IN (
                        'RECEIPT','INSTRUMENT','REMITTANCE','PROROGATION','OUTBOUND_CHEQUE','CHARGE'
                      )),
  aggregate_id        uuid NOT NULL,
  event_type          text NOT NULL CHECK (event_type IN (
                        'RECEIPT_CREATED','INVOICE_ALLOCATED','REMITTANCE_SUBMITTED',
                        'PROROGATION_CREATED','PROROGATION_SOURCE_ATTACHED',
                        'REPLACEMENT_EFFECT_ATTACHED','REPLACEMENT_EFFECTS_COMPLETE',
                        'FUNDING_CHEQUE_ISSUED','FUNDING_CHEQUE_DELIVERED','FUNDING_EXCEPTION_RECORDED',
                        'BANK_COLLECTION_CREDIT_CONFIRMED','BANK_DISCOUNT_CREDIT_CONFIRMED',
                        'BANK_TRANSFER_CREDIT_CONFIRMED','BANK_CASH_DEPOSIT_CREDIT_CONFIRMED',
                        'BANK_FUNDING_CHEQUE_DEBIT_CONFIRMED','BANK_CHARGE_CONFIRMED',
                        'EFFECT_SETTLEMENT_CONFIRMED','EFFECT_PARTIAL_SETTLEMENT_CONFIRMED',
                        'EFFECT_UNPAID_CONFIRMED','BANK_RECOURSE_DEBIT_CONFIRMED',
                        'BANK_EVENT_REVERSED','BANK_EVIDENCE_SUPERSEDED','BANK_EVIDENCE_REBOUND',
                        'CORRECTION_RECORDED'
                      )),
  effective_date      date NOT NULL,
  amount              numeric(18,2) CHECK (amount > 0),
  direction           text CHECK (direction IN ('DEBIT','CREDIT','NONE')),
  currency            text CHECK (currency ~ '^[A-Z]{3}$'),
  actor_id            uuid NOT NULL REFERENCES auth.users (id),
  reason              text,
  causation_id        uuid REFERENCES public.collection_events (id),
  correlation_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  supersedes_event_id uuid REFERENCES public.collection_events (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_event_reason_for_sensitive CHECK (
    event_type NOT IN ('BANK_EVENT_REVERSED','CORRECTION_RECORDED','FUNDING_EXCEPTION_RECORDED')
    OR char_length(btrim(reason)) BETWEEN 8 AND 500
  )
);

CREATE INDEX idx_collection_events_aggregate
  ON public.collection_events (aggregate_type, aggregate_id, created_at);

CREATE TABLE public.collection_match_proposals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type        text NOT NULL CHECK (aggregate_type IN (
                          'RECEIPT','INSTRUMENT','REMITTANCE','OUTBOUND_CHEQUE','CHARGE'
                        )),
  aggregate_id          uuid NOT NULL,
  daily_line_id         uuid NOT NULL REFERENCES public.daily_statement_lines_canonical (id),
  proposed_event_type   text NOT NULL,
  proposed_amount       numeric(18,2) NOT NULL CHECK (proposed_amount > 0),
  score                 numeric(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  reason_codes          text[] NOT NULL CHECK (cardinality(reason_codes) > 0),
  algorithm_version     text NOT NULL CHECK (char_length(btrim(algorithm_version)) BETWEEN 1 AND 40),
  tolerance_snapshot    jsonb NOT NULL CHECK (jsonb_typeof(tolerance_snapshot) = 'object'),
  status                text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN (
                          'PROPOSED','CONFIRMED','REJECTED','EXPIRED','EVIDENCE_SUPERSEDED'
                        )),
  proposed_at           timestamptz NOT NULL DEFAULT now(),
  proposed_by           uuid NOT NULL REFERENCES auth.users (id),
  reviewed_at           timestamptz,
  reviewed_by           uuid REFERENCES auth.users (id),
  review_reason         text,
  CONSTRAINT collection_match_review_coherent CHECK (
    (status = 'PROPOSED' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status <> 'PROPOSED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE INDEX idx_collection_match_proposals_queue
  ON public.collection_match_proposals (status, proposed_at);

CREATE TABLE public.collection_bank_line_allocations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 uuid NOT NULL REFERENCES public.collection_events (id),
  daily_line_id            uuid NOT NULL REFERENCES public.daily_statement_lines_canonical (id),
  allocated_amount         numeric(18,2) NOT NULL CHECK (allocated_amount > 0),
  currency                 text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  allocation_nature        text NOT NULL CHECK (allocation_nature IN ('CREDIT','DEBIT','CHARGE','RECOURSE')),
  evidence_state           text NOT NULL DEFAULT 'ACTIVE' CHECK (evidence_state IN (
                             'ACTIVE','EVIDENCE_SUPERSEDED','REBOUND','REJECTED'
                           )),
  supersedes_allocation_id uuid REFERENCES public.collection_bank_line_allocations (id),
  confirmed_at             timestamptz NOT NULL DEFAULT now(),
  confirmed_by             uuid NOT NULL REFERENCES auth.users (id)
);

CREATE INDEX idx_collection_allocations_daily_line
  ON public.collection_bank_line_allocations (daily_line_id, evidence_state);

CREATE TABLE public.collection_accounting_export_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_nature      text NOT NULL CHECK (operation_nature IN (
                          'CLIENT_RECEIVABLE','EFFECT_RECEIVABLE','DISCOUNT_EXPOSURE',
                          'PROROGATION_ADVANCE','BANK_ACCOUNT','BANK_CHARGE','CHARGE_REBILLING','TAX'
                        )),
  account_registry_id   uuid REFERENCES public.daily_statement_account_registry (id),
  account_code          text NOT NULL CHECK (char_length(btrim(account_code)) BETWEEN 1 AND 40),
  account_label         text NOT NULL CHECK (char_length(btrim(account_label)) BETWEEN 1 AND 160),
  effective_from        date NOT NULL,
  effective_until       date,
  export_only           boolean NOT NULL DEFAULT true CHECK (export_only),
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users (id),
  approved_at           timestamptz,
  approved_by           uuid REFERENCES auth.users (id),
  reason                text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 500),
  CONSTRAINT collection_export_mapping_period CHECK (
    effective_until IS NULL OR effective_until >= effective_from
  ),
  CONSTRAINT collection_export_mapping_approval_coherent CHECK (
    (status = 'DRAFT' AND approved_at IS NULL AND approved_by IS NULL)
    OR (status <> 'DRAFT' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND created_by <> approved_by)
  )
);

CREATE UNIQUE INDEX uq_collection_export_mapping_open
  ON public.collection_accounting_export_mappings (
    operation_nature, coalesce(account_registry_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE effective_until IS NULL AND status = 'ACTIVE';

CREATE TABLE public.collection_audit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid REFERENCES auth.users (id),
  action_name     text NOT NULL CHECK (char_length(btrim(action_name)) BETWEEN 3 AND 100),
  aggregate_type  text,
  aggregate_id    uuid,
  outcome         text NOT NULL CHECK (outcome IN ('ACCEPTED','REJECTED')),
  correlation_id  uuid NOT NULL DEFAULT gen_random_uuid(),
  safe_details    jsonb CHECK (
                    safe_details IS NULL OR (
                      jsonb_typeof(safe_details) = 'object'
                      AND NOT (safe_details ?| ARRAY[
                        'password','token','secret','iban','account_number','raw_file','raw_content'
                      ])
                    )
                  )
);

-- --------------------------------------------------------------------------
-- 6. Invariants transverses et helpers internes
-- --------------------------------------------------------------------------

CREATE FUNCTION public.collection_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'COLLECTION_APPEND_ONLY_OBJECT';
END;
$$;

CREATE TRIGGER trg_collection_events_append_only
BEFORE UPDATE OR DELETE ON public.collection_events
FOR EACH ROW EXECUTE FUNCTION public.collection_reject_mutation();

CREATE TRIGGER trg_collection_audit_events_append_only
BEFORE UPDATE OR DELETE ON public.collection_audit_events
FOR EACH ROW EXECUTE FUNCTION public.collection_reject_mutation();

CREATE FUNCTION public.collection_assert_reason(p_reason text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION 'COLLECTION_REASON_REQUIRED';
  END IF;
  RETURN btrim(p_reason);
END;
$$;

CREATE FUNCTION public.collection_has_capability(
  p_actor_id uuid,
  p_capability text,
  p_scope_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_actor_id IS NOT NULL
    AND (
      public.has_role(p_actor_id, 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1
        FROM public.collection_domain_assignments a
        WHERE a.actor_id = p_actor_id
          AND a.capability = p_capability
          AND a.valid_from <= now()
          AND (a.valid_until IS NULL OR a.valid_until > now())
          AND (
            a.scope_type = 'GLOBAL'
            OR (a.scope_type = 'ACCOUNT' AND a.scope_id = p_scope_id)
          )
      )
    );
$$;

CREATE FUNCTION public.collection_assert_actor(
  p_capability text,
  p_scope_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_AUTHENTICATION_REQUIRED';
  END IF;
  IF NOT public.collection_has_capability(v_actor, p_capability, p_scope_id) THEN
    RAISE EXCEPTION 'COLLECTION_CAPABILITY_REQUIRED:%', p_capability;
  END IF;
  RETURN v_actor;
END;
$$;

CREATE FUNCTION public.collection_idempotency_claim(
  p_actor_id uuid,
  p_command_name text,
  p_idempotency_key text,
  p_request_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.collection_command_idempotency%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NULL
     OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'COLLECTION_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  IF jsonb_typeof(p_request_payload) <> 'object' THEN
    RAISE EXCEPTION 'COLLECTION_REQUEST_MUST_BE_OBJECT';
  END IF;

  INSERT INTO public.collection_command_idempotency (
    actor_id, command_name, idempotency_key, request_payload
  ) VALUES (
    p_actor_id, p_command_name, btrim(p_idempotency_key), p_request_payload
  )
  ON CONFLICT (actor_id, command_name, idempotency_key) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.collection_command_idempotency
  WHERE actor_id = p_actor_id
    AND command_name = p_command_name
    AND idempotency_key = btrim(p_idempotency_key)
  FOR UPDATE;

  IF v_existing.request_payload IS DISTINCT FROM p_request_payload THEN
    RAISE EXCEPTION 'COLLECTION_IDEMPOTENCY_PAYLOAD_MISMATCH';
  END IF;
  RETURN v_existing.result_payload;
END;
$$;

CREATE FUNCTION public.collection_idempotency_complete(
  p_actor_id uuid,
  p_command_name text,
  p_idempotency_key text,
  p_result_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.collection_command_idempotency
  SET result_payload = p_result_payload,
      completed_at = now()
  WHERE actor_id = p_actor_id
    AND command_name = p_command_name
    AND idempotency_key = btrim(p_idempotency_key)
    AND result_payload IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_IDEMPOTENCY_COMPLETION_FAILED';
  END IF;
END;
$$;

CREATE FUNCTION public.collection_write_audit(
  p_actor_id uuid,
  p_action_name text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_correlation_id uuid,
  p_safe_details jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.collection_audit_events (
    actor_id, action_name, aggregate_type, aggregate_id,
    outcome, correlation_id, safe_details
  ) VALUES (
    p_actor_id, p_action_name, p_aggregate_type, p_aggregate_id,
    'ACCEPTED', p_correlation_id, p_safe_details
  );
$$;

-- --------------------------------------------------------------------------
-- 7. Commandes de capture et d'allocation
-- --------------------------------------------------------------------------

CREATE FUNCTION public.create_collection_receipt_v1(
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('ENTRY');
  v_existing jsonb;
  v_result jsonb;
  v_receipt_id uuid := gen_random_uuid();
  v_instrument_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_method text := upper(btrim(p_payload->>'method'));
  v_currency text := upper(btrim(p_payload->>'currency'));
  v_amount numeric(18,2) := (p_payload->>'amount')::numeric;
  v_source_type text := upper(coalesce(nullif(btrim(p_payload->>'source_type'), ''), 'MANUAL'));
  v_business_nature text := upper(coalesce(nullif(btrim(p_payload->>'business_nature'), ''), 'INVOICE_SETTLEMENT'));
  v_account_id uuid := nullif(p_payload->>'deposit_account_registry_id', '')::uuid;
  v_instrument jsonb := p_payload->'instrument';
  v_origin jsonb := p_payload->'origin';
BEGIN
  v_existing := public.collection_idempotency_claim(
    v_actor, 'create_collection_receipt_v1', p_idempotency_key, p_payload
  );
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF v_method NOT IN ('CHEQUE','EFFECT','TRANSFER','CASH')
     OR v_currency !~ '^[A-Z]{3}$'
     OR v_amount IS NULL OR v_amount <= 0
     OR p_payload->>'bank_submission_date' IS NULL
     OR nullif(btrim(p_payload->>'client_name_snapshot'), '') IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_RECEIPT_INVALID';
  END IF;
  IF v_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.daily_statement_account_registry
    WHERE id = v_account_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'COLLECTION_ACTIVE_DEPOSIT_ACCOUNT_REQUIRED';
  END IF;
  IF (v_method IN ('CHEQUE','EFFECT')) <> (v_instrument IS NOT NULL) THEN
    RAISE EXCEPTION 'COLLECTION_INSTRUMENT_SHAPE_REQUIRED';
  END IF;
  IF v_source_type = 'EXCEL' AND v_origin IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_EXCEL_ORIGIN_REQUIRED';
  END IF;

  INSERT INTO public.collection_receipts (
    id, source_type, client_reference, client_name_snapshot, method,
    business_nature, amount, currency, bank_submission_date,
    counterparty_bank_snapshot, deposit_account_registry_id,
    declared_bank_credit_date, routing_state, created_by, updated_by
  ) VALUES (
    v_receipt_id, v_source_type, nullif(btrim(p_payload->>'client_reference'), ''),
    btrim(p_payload->>'client_name_snapshot'), v_method, v_business_nature,
    v_amount, v_currency, (p_payload->>'bank_submission_date')::date,
    nullif(btrim(p_payload->>'counterparty_bank_snapshot'), ''), v_account_id,
    nullif(p_payload->>'declared_bank_credit_date', '')::date, 'RECEIVED', v_actor, v_actor
  );

  IF v_origin IS NOT NULL THEN
    INSERT INTO public.collection_import_origins (
      receipt_id, source_system, excel_filename, excel_source_row,
      excel_processed_at, unique_excel_traceability, legacy_collection_report_id
    ) VALUES (
      v_receipt_id, btrim(v_origin->>'source_system'), btrim(v_origin->>'excel_filename'),
      (v_origin->>'excel_source_row')::integer,
      nullif(v_origin->>'excel_processed_at', '')::timestamptz,
      nullif(btrim(v_origin->>'unique_excel_traceability'), ''),
      nullif(v_origin->>'legacy_collection_report_id', '')::uuid
    );
  END IF;

  IF v_instrument IS NOT NULL THEN
    v_instrument_id := gen_random_uuid();
    IF upper(btrim(v_instrument->>'instrument_type')) <> v_method THEN
      RAISE EXCEPTION 'COLLECTION_INSTRUMENT_METHOD_MISMATCH';
    END IF;
    INSERT INTO public.collection_instruments (
      id, receipt_id, instrument_type, nominal_amount, currency,
      cheque_number, effect_reference, maturity_date, drawee_bank_snapshot,
      received_at, quality_state, created_by
    ) VALUES (
      v_instrument_id, v_receipt_id, v_method, v_amount, v_currency,
      nullif(btrim(v_instrument->>'cheque_number'), ''),
      nullif(btrim(v_instrument->>'effect_reference'), ''),
      nullif(v_instrument->>'maturity_date', '')::date,
      nullif(btrim(coalesce(v_instrument->>'drawee_bank_snapshot', p_payload->>'counterparty_bank_snapshot')), ''),
      coalesce(nullif(v_instrument->>'received_at', '')::date, (p_payload->>'bank_submission_date')::date),
      upper(coalesce(nullif(btrim(v_instrument->>'quality_state'), ''), 'COMPLETE')),
      v_actor
    );
  END IF;

  INSERT INTO public.collection_events (
    aggregate_type, aggregate_id, event_type, effective_date, amount,
    direction, currency, actor_id, correlation_id
  ) VALUES (
    'RECEIPT', v_receipt_id, 'RECEIPT_CREATED',
    (p_payload->>'bank_submission_date')::date, v_amount, 'NONE',
    v_currency, v_actor, v_correlation_id
  );

  v_result := jsonb_build_object('receipt_id', v_receipt_id, 'instrument_id', v_instrument_id,
                                  'version', 1, 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor, 'create_collection_receipt_v1',
    'RECEIPT', v_receipt_id, v_correlation_id,
    jsonb_build_object('source_type', v_source_type, 'method', v_method));
  PERFORM public.collection_idempotency_complete(v_actor, 'create_collection_receipt_v1',
    p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.allocate_collection_invoice_v1(
  p_receipt_id uuid,
  p_invoice_reference text,
  p_invoice_amount_snapshot numeric,
  p_allocated_amount numeric,
  p_expected_version integer,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('ENTRY');
  v_request jsonb := jsonb_build_object(
    'receipt_id', p_receipt_id, 'invoice_reference', btrim(p_invoice_reference),
    'invoice_amount_snapshot', p_invoice_amount_snapshot,
    'allocated_amount', p_allocated_amount, 'expected_version', p_expected_version
  );
  v_existing jsonb;
  v_receipt public.collection_receipts%ROWTYPE;
  v_receipt_total numeric(18,2);
  v_invoice_total numeric(18,2);
  v_allocation_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(
    v_actor, 'allocate_collection_invoice_v1', p_idempotency_key, v_request
  );
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT * INTO v_receipt FROM public.collection_receipts
  WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_RECEIPT_NOT_FOUND'; END IF;
  IF v_receipt.version <> p_expected_version THEN RAISE EXCEPTION 'COLLECTION_STALE_VERSION'; END IF;
  IF v_receipt.business_nature = 'PROROGATION' THEN
    RAISE EXCEPTION 'COLLECTION_PROROGATION_NOT_INVOICE_ALLOCATION';
  END IF;
  IF nullif(btrim(p_invoice_reference), '') IS NULL OR p_allocated_amount <= 0 THEN
    RAISE EXCEPTION 'COLLECTION_INVOICE_ALLOCATION_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_receipt.currency || ':' || lower(btrim(p_invoice_reference)), 0));
  SELECT coalesce(sum(allocated_amount), 0) INTO v_receipt_total
  FROM public.collection_invoice_allocations
  WHERE receipt_id = p_receipt_id AND allocation_state <> 'REVERSED';
  IF v_receipt_total + p_allocated_amount > v_receipt.amount THEN
    RAISE EXCEPTION 'COLLECTION_RECEIPT_OVERALLOCATED';
  END IF;

  SELECT coalesce(sum(allocated_amount), 0) INTO v_invoice_total
  FROM public.collection_invoice_allocations
  WHERE lower(btrim(invoice_reference)) = lower(btrim(p_invoice_reference))
    AND currency = v_receipt.currency AND allocation_state <> 'REVERSED';
  IF p_invoice_amount_snapshot IS NOT NULL
     AND v_invoice_total + p_allocated_amount > p_invoice_amount_snapshot THEN
    RAISE EXCEPTION 'COLLECTION_INVOICE_OVERALLOCATED';
  END IF;

  INSERT INTO public.collection_invoice_allocations (
    id, receipt_id, invoice_reference, invoice_amount_snapshot,
    allocated_amount, currency, review_required, created_by
  ) VALUES (
    v_allocation_id, p_receipt_id, btrim(p_invoice_reference), p_invoice_amount_snapshot,
    p_allocated_amount, v_receipt.currency, p_invoice_amount_snapshot IS NULL, v_actor
  );

  UPDATE public.collection_receipts
  SET version = version + 1, updated_at = now(), updated_by = v_actor
  WHERE id = p_receipt_id;
  INSERT INTO public.collection_events (
    aggregate_type, aggregate_id, event_type, effective_date, amount,
    direction, currency, actor_id, correlation_id
  ) VALUES ('RECEIPT', p_receipt_id, 'INVOICE_ALLOCATED', current_date,
            p_allocated_amount, 'NONE', v_receipt.currency, v_actor, v_correlation_id);

  v_result := jsonb_build_object('allocation_id', v_allocation_id,
    'receipt_id', p_receipt_id, 'version', p_expected_version + 1,
    'review_required', p_invoice_amount_snapshot IS NULL,
    'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor, 'allocate_collection_invoice_v1',
    'RECEIPT', p_receipt_id, v_correlation_id,
    jsonb_build_object('invoice_reference_present', true));
  PERFORM public.collection_idempotency_complete(v_actor, 'allocate_collection_invoice_v1',
    p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------------
-- 8. Commandes de prorogation Cassis et chèques de financement
-- --------------------------------------------------------------------------

CREATE FUNCTION public.create_collection_prorogation_v1(
  p_client_reference text,
  p_target_nominal numeric,
  p_currency text,
  p_funding_deadline date,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('APPROVE_PROROGATION');
  v_request jsonb := jsonb_build_object('client_reference', btrim(p_client_reference),
    'target_nominal', p_target_nominal, 'currency', upper(btrim(p_currency)),
    'funding_deadline', p_funding_deadline);
  v_existing jsonb;
  v_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'create_collection_prorogation_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  IF nullif(btrim(p_client_reference), '') IS NULL OR p_target_nominal <= 0
     OR upper(btrim(p_currency)) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'COLLECTION_PROROGATION_INVALID';
  END IF;

  INSERT INTO public.collection_prorogations (
    id, client_reference, target_nominal, currency, funding_deadline,
    created_by, updated_by
  ) VALUES (v_id, btrim(p_client_reference), p_target_nominal,
            upper(btrim(p_currency)), p_funding_deadline, v_actor, v_actor);
  INSERT INTO public.collection_events (
    aggregate_type, aggregate_id, event_type, effective_date, amount,
    direction, currency, actor_id, correlation_id
  ) VALUES ('PROROGATION', v_id, 'PROROGATION_CREATED', current_date,
            p_target_nominal, 'NONE', upper(btrim(p_currency)), v_actor, v_correlation_id);
  v_result := jsonb_build_object('prorogation_id', v_id, 'version', 1,
                                 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor, 'create_collection_prorogation_v1',
    'PROROGATION', v_id, v_correlation_id, NULL);
  PERFORM public.collection_idempotency_complete(v_actor,
    'create_collection_prorogation_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.attach_collection_prorogation_source_v1(
  p_prorogation_id uuid,
  p_source_reference_type text,
  p_source_reference text,
  p_allocated_amount numeric,
  p_expected_version integer,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('ENTRY');
  v_request jsonb := jsonb_build_object('prorogation_id', p_prorogation_id,
    'source_reference_type', upper(btrim(p_source_reference_type)),
    'source_reference', btrim(p_source_reference),
    'allocated_amount', p_allocated_amount, 'expected_version', p_expected_version);
  v_existing jsonb;
  v_p public.collection_prorogations%ROWTYPE;
  v_total numeric(18,2);
  v_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'attach_collection_prorogation_source_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT * INTO v_p FROM public.collection_prorogations
  WHERE id = p_prorogation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_PROROGATION_NOT_FOUND'; END IF;
  IF v_p.version <> p_expected_version THEN RAISE EXCEPTION 'COLLECTION_STALE_VERSION'; END IF;
  IF v_p.status NOT IN ('DRAFT','EFFECTS_PARTIAL','EFFECTS_COMPLETE')
     OR upper(btrim(p_source_reference_type)) NOT IN ('INVOICE','EFFECT','RECEIVABLE')
     OR nullif(btrim(p_source_reference), '') IS NULL OR p_allocated_amount <= 0 THEN
    RAISE EXCEPTION 'COLLECTION_PROROGATION_SOURCE_INVALID';
  END IF;
  SELECT coalesce(sum(allocated_amount), 0) INTO v_total
  FROM public.collection_prorogation_source_allocations
  WHERE prorogation_id = p_prorogation_id;
  IF v_total + p_allocated_amount > v_p.target_nominal THEN
    RAISE EXCEPTION 'COLLECTION_PROROGATION_SOURCES_OVER_TARGET';
  END IF;
  INSERT INTO public.collection_prorogation_source_allocations (
    id, prorogation_id, source_reference_type, source_reference,
    allocated_amount, currency, created_by
  ) VALUES (v_id, p_prorogation_id, upper(btrim(p_source_reference_type)),
            btrim(p_source_reference), p_allocated_amount, v_p.currency, v_actor);
  UPDATE public.collection_prorogations
  SET version = version + 1, updated_at = now(), updated_by = v_actor
  WHERE id = p_prorogation_id;
  INSERT INTO public.collection_events (
    aggregate_type, aggregate_id, event_type, effective_date, amount,
    direction, currency, actor_id, correlation_id
  ) VALUES ('PROROGATION', p_prorogation_id, 'PROROGATION_SOURCE_ATTACHED',
            current_date, p_allocated_amount, 'NONE', v_p.currency, v_actor, v_correlation_id);
  v_result := jsonb_build_object('source_allocation_id', v_id,
    'prorogation_id', p_prorogation_id, 'version', p_expected_version + 1,
    'sources_complete', v_total + p_allocated_amount = v_p.target_nominal,
    'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor,
    'attach_collection_prorogation_source_v1', 'PROROGATION', p_prorogation_id,
    v_correlation_id, jsonb_build_object('source_reference_type', upper(btrim(p_source_reference_type))));
  PERFORM public.collection_idempotency_complete(v_actor,
    'attach_collection_prorogation_source_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.attach_collection_replacement_effect_v1(
  p_prorogation_id uuid,
  p_instrument_id uuid,
  p_allocated_nominal numeric,
  p_expected_version integer,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('ENTRY');
  v_request jsonb := jsonb_build_object('prorogation_id', p_prorogation_id,
    'instrument_id', p_instrument_id, 'allocated_nominal', p_allocated_nominal,
    'expected_version', p_expected_version);
  v_existing jsonb;
  v_p public.collection_prorogations%ROWTYPE;
  v_i public.collection_instruments%ROWTYPE;
  v_total numeric(18,2);
  v_link_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'attach_collection_replacement_effect_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT * INTO v_p FROM public.collection_prorogations
  WHERE id = p_prorogation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_PROROGATION_NOT_FOUND'; END IF;
  IF v_p.version <> p_expected_version THEN RAISE EXCEPTION 'COLLECTION_STALE_VERSION'; END IF;
  IF v_p.status NOT IN ('DRAFT','EFFECTS_PARTIAL') THEN
    RAISE EXCEPTION 'COLLECTION_PROROGATION_EFFECTS_CLOSED';
  END IF;
  SELECT i.* INTO v_i
  FROM public.collection_instruments i
  JOIN public.collection_receipts r ON r.id = i.receipt_id
  WHERE i.id = p_instrument_id
    AND i.instrument_type = 'EFFECT'
    AND r.business_nature = 'PROROGATION';
  IF NOT FOUND OR v_i.currency <> v_p.currency OR p_allocated_nominal <= 0
     OR p_allocated_nominal > v_i.nominal_amount THEN
    RAISE EXCEPTION 'COLLECTION_REPLACEMENT_EFFECT_INVALID';
  END IF;
  SELECT coalesce(sum(allocated_nominal), 0) INTO v_total
  FROM public.collection_prorogation_replacement_effects
  WHERE prorogation_id = p_prorogation_id;
  IF v_total + p_allocated_nominal > v_p.target_nominal THEN
    RAISE EXCEPTION 'COLLECTION_REPLACEMENT_EFFECTS_OVER_TARGET';
  END IF;

  INSERT INTO public.collection_prorogation_replacement_effects (
    id, prorogation_id, instrument_id, allocated_nominal, created_by
  ) VALUES (v_link_id, p_prorogation_id, p_instrument_id, p_allocated_nominal, v_actor);
  UPDATE public.collection_prorogations
  SET status = CASE WHEN v_total + p_allocated_nominal = target_nominal
                    THEN 'EFFECTS_COMPLETE' ELSE 'EFFECTS_PARTIAL' END,
      earliest_effect_maturity = CASE
        WHEN earliest_effect_maturity IS NULL THEN v_i.maturity_date
        ELSE least(earliest_effect_maturity, v_i.maturity_date) END,
      version = version + 1, updated_at = now(), updated_by = v_actor
  WHERE id = p_prorogation_id;
  INSERT INTO public.collection_events (
    aggregate_type, aggregate_id, event_type, effective_date, amount,
    direction, currency, actor_id, correlation_id
  ) VALUES ('PROROGATION', p_prorogation_id, 'REPLACEMENT_EFFECT_ATTACHED',
            current_date, p_allocated_nominal, 'NONE', v_p.currency, v_actor, v_correlation_id);
  IF v_total + p_allocated_nominal = v_p.target_nominal THEN
    INSERT INTO public.collection_events (
      aggregate_type, aggregate_id, event_type, effective_date, amount,
      direction, currency, actor_id, correlation_id
    ) VALUES ('PROROGATION', p_prorogation_id, 'REPLACEMENT_EFFECTS_COMPLETE',
              current_date, v_p.target_nominal, 'NONE', v_p.currency, v_actor, v_correlation_id);
  END IF;
  v_result := jsonb_build_object('replacement_effect_link_id', v_link_id,
    'prorogation_id', p_prorogation_id, 'version', p_expected_version + 1,
    'effects_complete', v_total + p_allocated_nominal = v_p.target_nominal,
    'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor,
    'attach_collection_replacement_effect_v1', 'PROROGATION', p_prorogation_id,
    v_correlation_id, jsonb_build_object('instrument_id', p_instrument_id));
  PERFORM public.collection_idempotency_complete(v_actor,
    'attach_collection_replacement_effect_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.prepare_collection_funding_cheque_v1(
  p_prorogation_id uuid,
  p_account_registry_id uuid,
  p_beneficiary_snapshot text,
  p_cheque_number text,
  p_amount numeric,
  p_issue_date date,
  p_expected_version integer,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('ISSUE_FUNDING_CHEQUE', p_account_registry_id);
  v_request jsonb := jsonb_build_object('prorogation_id', p_prorogation_id,
    'account_registry_id', p_account_registry_id, 'beneficiary_snapshot', btrim(p_beneficiary_snapshot),
    'cheque_number', btrim(p_cheque_number), 'amount', p_amount,
    'issue_date', p_issue_date, 'expected_version', p_expected_version);
  v_existing jsonb;
  v_p public.collection_prorogations%ROWTYPE;
  v_account_currency text;
  v_total numeric(18,2);
  v_source_total numeric(18,2);
  v_cheque_id uuid := gen_random_uuid();
  v_link_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'prepare_collection_funding_cheque_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT * INTO v_p FROM public.collection_prorogations
  WHERE id = p_prorogation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_PROROGATION_NOT_FOUND'; END IF;
  IF v_p.version <> p_expected_version THEN RAISE EXCEPTION 'COLLECTION_STALE_VERSION'; END IF;
  IF v_p.status NOT IN ('EFFECTS_COMPLETE','FUNDING_PARTIAL') THEN
    RAISE EXCEPTION 'COLLECTION_REPLACEMENT_EFFECTS_NOT_COMPLETE';
  END IF;
  SELECT coalesce(sum(allocated_amount), 0) INTO v_source_total
  FROM public.collection_prorogation_source_allocations
  WHERE prorogation_id = p_prorogation_id;
  IF v_source_total <> v_p.target_nominal THEN
    RAISE EXCEPTION 'COLLECTION_PROROGATION_SOURCES_NOT_COMPLETE';
  END IF;
  SELECT currency INTO v_account_currency
  FROM public.daily_statement_account_registry
  WHERE id = p_account_registry_id AND status = 'active';
  IF NOT FOUND OR v_account_currency <> v_p.currency THEN
    RAISE EXCEPTION 'COLLECTION_FUNDING_ACCOUNT_INVALID';
  END IF;
  IF nullif(btrim(p_beneficiary_snapshot), '') IS NULL
     OR nullif(btrim(p_cheque_number), '') IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'COLLECTION_FUNDING_CHEQUE_INVALID';
  END IF;
  SELECT coalesce(sum(c.amount), 0) INTO v_total
  FROM public.collection_prorogation_funding_cheques f
  JOIN public.collection_outbound_cheques c ON c.id = f.outbound_cheque_id
  WHERE f.prorogation_id = p_prorogation_id
    AND c.status NOT IN ('CANCELLED','REPLACED');
  IF v_total + p_amount > v_p.target_nominal THEN
    RAISE EXCEPTION 'COLLECTION_FUNDING_OVER_TARGET';
  END IF;

  INSERT INTO public.collection_outbound_cheques (
    id, purpose, account_registry_id, beneficiary_snapshot, cheque_number,
    amount, currency, issue_date, status, created_by, updated_by
  ) VALUES (v_cheque_id, 'PROROGATION_FUNDING', p_account_registry_id,
            btrim(p_beneficiary_snapshot), btrim(p_cheque_number), p_amount,
            v_p.currency, p_issue_date, 'DRAFT', v_actor, v_actor);
  INSERT INTO public.collection_prorogation_funding_cheques (
    id, prorogation_id, outbound_cheque_id, created_by
  ) VALUES (v_link_id, p_prorogation_id, v_cheque_id, v_actor);
  UPDATE public.collection_prorogations
  SET version = version + 1, updated_at = now(), updated_by = v_actor
  WHERE id = p_prorogation_id;
  v_result := jsonb_build_object('outbound_cheque_id', v_cheque_id,
    'prorogation_id', p_prorogation_id, 'status', 'DRAFT',
    'version', p_expected_version + 1, 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor,
    'prepare_collection_funding_cheque_v1', 'OUTBOUND_CHEQUE', v_cheque_id,
    v_correlation_id, jsonb_build_object('prorogation_id', p_prorogation_id));
  PERFORM public.collection_idempotency_complete(v_actor,
    'prepare_collection_funding_cheque_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.approve_collection_funding_cheque_v1(
  p_outbound_cheque_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('APPROVE_PROROGATION');
  v_request jsonb := jsonb_build_object('outbound_cheque_id', p_outbound_cheque_id,
    'expected_version', p_expected_version, 'reason', btrim(p_reason));
  v_existing jsonb;
  v_c public.collection_outbound_cheques%ROWTYPE;
  v_p_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'approve_collection_funding_cheque_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  PERFORM public.collection_assert_reason(p_reason);
  SELECT * INTO v_c FROM public.collection_outbound_cheques
  WHERE id = p_outbound_cheque_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_OUTBOUND_CHEQUE_NOT_FOUND'; END IF;
  IF v_c.version <> p_expected_version THEN RAISE EXCEPTION 'COLLECTION_STALE_VERSION'; END IF;
  IF v_c.status <> 'DRAFT' THEN RAISE EXCEPTION 'COLLECTION_CHEQUE_NOT_DRAFT'; END IF;
  IF v_c.created_by = v_actor THEN RAISE EXCEPTION 'COLLECTION_TWO_ACTORS_REQUIRED'; END IF;
  SELECT prorogation_id INTO v_p_id FROM public.collection_prorogation_funding_cheques
  WHERE outbound_cheque_id = p_outbound_cheque_id;

  UPDATE public.collection_outbound_cheques
  SET status = 'ISSUED', approved_at = now(), approved_by = v_actor,
      version = version + 1, updated_at = now(), updated_by = v_actor
  WHERE id = p_outbound_cheque_id;
  INSERT INTO public.collection_events (
    aggregate_type, aggregate_id, event_type, effective_date, amount,
    direction, currency, actor_id, reason, correlation_id
  ) VALUES ('OUTBOUND_CHEQUE', p_outbound_cheque_id, 'FUNDING_CHEQUE_ISSUED',
            v_c.issue_date, v_c.amount, 'NONE', v_c.currency, v_actor,
            btrim(p_reason), v_correlation_id);
  v_result := jsonb_build_object('outbound_cheque_id', p_outbound_cheque_id,
    'prorogation_id', v_p_id, 'status', 'ISSUED',
    'version', p_expected_version + 1, 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor,
    'approve_collection_funding_cheque_v1', 'OUTBOUND_CHEQUE', p_outbound_cheque_id,
    v_correlation_id, jsonb_build_object('two_actor_check', true));
  PERFORM public.collection_idempotency_complete(v_actor,
    'approve_collection_funding_cheque_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.confirm_collection_funding_delivery_v1(
  p_outbound_cheque_id uuid,
  p_delivery_date date,
  p_delivery_evidence_ref text,
  p_expected_version integer,
  p_exception_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('CONFIRM_DELIVERY');
  v_request jsonb := jsonb_build_object('outbound_cheque_id', p_outbound_cheque_id,
    'delivery_date', p_delivery_date, 'delivery_evidence_ref', btrim(p_delivery_evidence_ref),
    'expected_version', p_expected_version, 'exception_reason', p_exception_reason);
  v_existing jsonb;
  v_c public.collection_outbound_cheques%ROWTYPE;
  v_p public.collection_prorogations%ROWTYPE;
  v_delivered numeric(18,2);
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'confirm_collection_funding_delivery_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT * INTO v_c FROM public.collection_outbound_cheques
  WHERE id = p_outbound_cheque_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_OUTBOUND_CHEQUE_NOT_FOUND'; END IF;
  IF v_c.version <> p_expected_version THEN RAISE EXCEPTION 'COLLECTION_STALE_VERSION'; END IF;
  IF v_c.status <> 'ISSUED' OR v_c.created_by = v_actor THEN
    RAISE EXCEPTION 'COLLECTION_DELIVERY_CONFIRMATION_FORBIDDEN';
  END IF;
  IF nullif(btrim(p_delivery_evidence_ref), '') IS NULL OR p_delivery_date < v_c.issue_date THEN
    RAISE EXCEPTION 'COLLECTION_DELIVERY_EVIDENCE_INVALID';
  END IF;
  SELECT p.* INTO v_p
  FROM public.collection_prorogations p
  JOIN public.collection_prorogation_funding_cheques f ON f.prorogation_id = p.id
  WHERE f.outbound_cheque_id = p_outbound_cheque_id FOR UPDATE;
  IF v_p.earliest_effect_maturity IS NOT NULL
     AND p_delivery_date >= v_p.earliest_effect_maturity THEN
    PERFORM public.collection_assert_reason(p_exception_reason);
  END IF;

  UPDATE public.collection_outbound_cheques
  SET status = 'DELIVERED', delivery_date = p_delivery_date,
      delivery_evidence_ref = btrim(p_delivery_evidence_ref),
      version = version + 1, updated_at = now(), updated_by = v_actor
  WHERE id = p_outbound_cheque_id;
  SELECT coalesce(sum(c.amount), 0) INTO v_delivered
  FROM public.collection_prorogation_funding_cheques f
  JOIN public.collection_outbound_cheques c ON c.id = f.outbound_cheque_id
  WHERE f.prorogation_id = v_p.id
    AND c.status IN ('DELIVERED','PRESENTED','PARTIALLY_DEBITED','DEBITED');
  UPDATE public.collection_prorogations
  SET status = CASE
        WHEN v_p.earliest_effect_maturity IS NOT NULL
             AND p_delivery_date >= v_p.earliest_effect_maturity THEN 'EXCEPTION'
        WHEN v_delivered = target_nominal THEN 'FUNDING_COMPLETE'
        ELSE 'FUNDING_PARTIAL' END,
      version = version + 1, updated_at = now(), updated_by = v_actor
  WHERE id = v_p.id;
  INSERT INTO public.collection_events (
    aggregate_type, aggregate_id, event_type, effective_date, amount,
    direction, currency, actor_id, reason, correlation_id
  ) VALUES ('OUTBOUND_CHEQUE', p_outbound_cheque_id,
            CASE WHEN v_p.earliest_effect_maturity IS NOT NULL
                       AND p_delivery_date >= v_p.earliest_effect_maturity
                 THEN 'FUNDING_EXCEPTION_RECORDED' ELSE 'FUNDING_CHEQUE_DELIVERED' END,
            p_delivery_date, v_c.amount, 'NONE', v_c.currency, v_actor,
            nullif(btrim(p_exception_reason), ''), v_correlation_id);
  v_result := jsonb_build_object('outbound_cheque_id', p_outbound_cheque_id,
    'prorogation_id', v_p.id, 'status', 'DELIVERED',
    'delivered_total', v_delivered, 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor,
    'confirm_collection_funding_delivery_v1', 'OUTBOUND_CHEQUE', p_outbound_cheque_id,
    v_correlation_id, jsonb_build_object('delivery_evidence_present', true));
  PERFORM public.collection_idempotency_complete(v_actor,
    'confirm_collection_funding_delivery_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------------
-- 9. Rapprochement attendu / constaté et preuve Daily v2
-- --------------------------------------------------------------------------

CREATE FUNCTION public.propose_collection_match_v1(
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_daily_line_id uuid,
  p_event_type text,
  p_amount numeric,
  p_score numeric,
  p_reason_codes text[],
  p_algorithm_version text,
  p_tolerance_snapshot jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('PROPOSE_MATCH');
  v_request jsonb := jsonb_build_object('aggregate_type', upper(btrim(p_aggregate_type)),
    'aggregate_id', p_aggregate_id, 'daily_line_id', p_daily_line_id,
    'event_type', upper(btrim(p_event_type)), 'amount', p_amount, 'score', p_score,
    'reason_codes', to_jsonb(p_reason_codes), 'algorithm_version', p_algorithm_version,
    'tolerance_snapshot', p_tolerance_snapshot);
  v_existing jsonb;
  v_type text := upper(btrim(p_aggregate_type));
  v_event text := upper(btrim(p_event_type));
  v_line record;
  v_expected_currency text;
  v_expected_account uuid;
  v_expected_direction text;
  v_residual numeric(18,2);
  v_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'propose_collection_match_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT l.*, u.account_registry_id INTO v_line
  FROM public.daily_statement_lines_canonical l
  JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
  WHERE l.id = p_daily_line_id AND l.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_ACTIVE_DAILY_LINE_REQUIRED'; END IF;
  IF p_amount <= 0 OR p_amount > abs(v_line.signed_amount)
     OR p_score NOT BETWEEN 0 AND 100 OR cardinality(p_reason_codes) = 0
     OR jsonb_typeof(p_tolerance_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'COLLECTION_MATCH_PROPOSAL_INVALID';
  END IF;

  IF v_type = 'RECEIPT' THEN
    SELECT currency, deposit_account_registry_id, amount INTO v_expected_currency, v_expected_account, v_residual
    FROM public.collection_receipts WHERE id = p_aggregate_id;
    v_expected_direction := 'credit';
    IF v_event NOT IN ('BANK_COLLECTION_CREDIT_CONFIRMED','BANK_DISCOUNT_CREDIT_CONFIRMED',
                       'BANK_TRANSFER_CREDIT_CONFIRMED','BANK_CASH_DEPOSIT_CREDIT_CONFIRMED') THEN
      RAISE EXCEPTION 'COLLECTION_RECEIPT_EVENT_INVALID';
    END IF;
  ELSIF v_type = 'INSTRUMENT' THEN
    SELECT i.currency, r.deposit_account_registry_id, i.nominal_amount - i.settled_amount
      INTO v_expected_currency, v_expected_account, v_residual
    FROM public.collection_instruments i
    JOIN public.collection_receipts r ON r.id = i.receipt_id
    WHERE i.id = p_aggregate_id;
    IF v_event IN ('EFFECT_SETTLEMENT_CONFIRMED','EFFECT_PARTIAL_SETTLEMENT_CONFIRMED') THEN
      v_expected_direction := 'credit';
    ELSIF v_event IN ('EFFECT_UNPAID_CONFIRMED','BANK_RECOURSE_DEBIT_CONFIRMED') THEN
      v_expected_direction := 'debit';
      SELECT i.settled_amount - coalesce(sum(a.allocated_amount), 0)
        INTO v_residual
      FROM public.collection_instruments i
      LEFT JOIN public.collection_events e
        ON e.aggregate_type = 'INSTRUMENT' AND e.aggregate_id = i.id
       AND e.event_type IN ('EFFECT_UNPAID_CONFIRMED','BANK_RECOURSE_DEBIT_CONFIRMED')
      LEFT JOIN public.collection_bank_line_allocations a
        ON a.event_id = e.id AND a.evidence_state IN ('ACTIVE','REBOUND')
      WHERE i.id = p_aggregate_id
      GROUP BY i.settled_amount;
    ELSE
      RAISE EXCEPTION 'COLLECTION_INSTRUMENT_EVENT_INVALID';
    END IF;
  ELSIF v_type = 'OUTBOUND_CHEQUE' THEN
    SELECT currency, account_registry_id, amount - debited_amount
      INTO v_expected_currency, v_expected_account, v_residual
    FROM public.collection_outbound_cheques WHERE id = p_aggregate_id;
    v_expected_direction := 'debit';
    IF v_event <> 'BANK_FUNDING_CHEQUE_DEBIT_CONFIRMED' THEN
      RAISE EXCEPTION 'COLLECTION_OUTBOUND_CHEQUE_EVENT_INVALID';
    END IF;
  ELSIF v_type = 'CHARGE' THEN
    SELECT currency, NULL::uuid, coalesce(observed_amount, expected_amount)
      INTO v_expected_currency, v_expected_account, v_residual
    FROM public.collection_remittance_charges WHERE id = p_aggregate_id;
    v_expected_direction := 'debit';
    IF v_event <> 'BANK_CHARGE_CONFIRMED' THEN
      RAISE EXCEPTION 'COLLECTION_CHARGE_EVENT_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION 'COLLECTION_MATCH_AGGREGATE_UNSUPPORTED';
  END IF;
  IF v_expected_currency IS NULL THEN RAISE EXCEPTION 'COLLECTION_MATCH_AGGREGATE_NOT_FOUND'; END IF;
  IF v_line.currency <> v_expected_currency OR v_line.direction <> v_expected_direction
     OR (v_expected_account IS NOT NULL AND v_line.account_registry_id <> v_expected_account)
     OR p_amount > v_residual THEN
    RAISE EXCEPTION 'COLLECTION_MATCH_EVIDENCE_MISMATCH';
  END IF;

  INSERT INTO public.collection_match_proposals (
    id, aggregate_type, aggregate_id, daily_line_id, proposed_event_type,
    proposed_amount, score, reason_codes, algorithm_version,
    tolerance_snapshot, proposed_by
  ) VALUES (v_id, v_type, p_aggregate_id, p_daily_line_id, v_event,
            p_amount, p_score, p_reason_codes, btrim(p_algorithm_version),
            p_tolerance_snapshot, v_actor);
  IF v_type = 'RECEIPT' THEN
    UPDATE public.collection_receipts
    SET settlement_state = CASE WHEN settlement_state = 'UNMATCHED' THEN 'PROPOSED' ELSE settlement_state END,
        version = version + 1, updated_at = now(), updated_by = v_actor
    WHERE id = p_aggregate_id;
  END IF;
  v_result := jsonb_build_object('proposal_id', v_id, 'status', 'PROPOSED',
                                 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor, 'propose_collection_match_v1',
    v_type, p_aggregate_id, v_correlation_id,
    jsonb_build_object('daily_line_id', p_daily_line_id, 'score', p_score));
  PERFORM public.collection_idempotency_complete(v_actor,
    'propose_collection_match_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.confirm_collection_match_v1(
  p_proposal_id uuid,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('CONFIRM_MATCH');
  v_request jsonb := jsonb_build_object('proposal_id', p_proposal_id, 'reason', btrim(p_reason));
  v_existing jsonb;
  v_p public.collection_match_proposals%ROWTYPE;
  v_line public.daily_statement_lines_canonical%ROWTYPE;
  v_used numeric(18,2);
  v_aggregate_total numeric(18,2);
  v_aggregate_nominal numeric(18,2);
  v_event_id uuid := gen_random_uuid();
  v_allocation_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'confirm_collection_match_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  PERFORM public.collection_assert_reason(p_reason);
  SELECT * INTO v_p FROM public.collection_match_proposals
  WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_MATCH_PROPOSAL_NOT_FOUND'; END IF;
  IF v_p.status <> 'PROPOSED' THEN RAISE EXCEPTION 'COLLECTION_MATCH_PROPOSAL_NOT_OPEN'; END IF;
  IF v_p.proposed_by = v_actor THEN RAISE EXCEPTION 'COLLECTION_TWO_ACTORS_REQUIRED'; END IF;
  SELECT * INTO v_line FROM public.daily_statement_lines_canonical
  WHERE id = v_p.daily_line_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_EVIDENCE_SUPERSEDED'; END IF;

  SELECT coalesce(sum(allocated_amount), 0) INTO v_used
  FROM public.collection_bank_line_allocations
  WHERE daily_line_id = v_p.daily_line_id
    AND evidence_state IN ('ACTIVE','REBOUND');
  IF v_used + v_p.proposed_amount > abs(v_line.signed_amount) THEN
    RAISE EXCEPTION 'COLLECTION_DAILY_LINE_OVERALLOCATED';
  END IF;

  INSERT INTO public.collection_events (
    id, aggregate_type, aggregate_id, event_type, effective_date, amount,
    direction, currency, actor_id, reason, correlation_id
  ) VALUES (v_event_id, v_p.aggregate_type, v_p.aggregate_id,
            v_p.proposed_event_type, coalesce(v_line.value_date, v_line.accounting_date),
            v_p.proposed_amount, upper(v_line.direction), v_line.currency,
            v_actor, btrim(p_reason), v_correlation_id);
  INSERT INTO public.collection_bank_line_allocations (
    id, event_id, daily_line_id, allocated_amount, currency,
    allocation_nature, confirmed_by
  ) VALUES (v_allocation_id, v_event_id, v_p.daily_line_id, v_p.proposed_amount,
            v_line.currency,
            CASE
              WHEN v_p.proposed_event_type = 'BANK_RECOURSE_DEBIT_CONFIRMED' THEN 'RECOURSE'
              WHEN v_line.direction = 'credit' THEN 'CREDIT'
              ELSE 'DEBIT'
            END,
            v_actor);
  UPDATE public.collection_match_proposals
  SET status = 'CONFIRMED', reviewed_at = now(), reviewed_by = v_actor,
      review_reason = btrim(p_reason)
  WHERE id = p_proposal_id;

  SELECT coalesce(sum(a.allocated_amount), 0) INTO v_aggregate_total
  FROM public.collection_bank_line_allocations a
  JOIN public.collection_events e ON e.id = a.event_id
  WHERE e.aggregate_type = v_p.aggregate_type AND e.aggregate_id = v_p.aggregate_id
    AND a.evidence_state IN ('ACTIVE','REBOUND')
    AND (
      v_p.aggregate_type <> 'INSTRUMENT'
      OR e.event_type IN ('EFFECT_SETTLEMENT_CONFIRMED','EFFECT_PARTIAL_SETTLEMENT_CONFIRMED')
    );
  IF v_p.aggregate_type = 'RECEIPT' THEN
    SELECT amount INTO v_aggregate_nominal FROM public.collection_receipts WHERE id = v_p.aggregate_id;
    UPDATE public.collection_receipts
    SET settlement_state = CASE WHEN v_aggregate_total = v_aggregate_nominal
                                THEN 'CONFIRMED' ELSE 'PARTIALLY_MATCHED' END,
        version = version + 1, updated_at = now(), updated_by = v_actor
    WHERE id = v_p.aggregate_id;
  ELSIF v_p.aggregate_type = 'INSTRUMENT' THEN
    SELECT nominal_amount INTO v_aggregate_nominal FROM public.collection_instruments WHERE id = v_p.aggregate_id;
    IF v_p.proposed_event_type IN ('EFFECT_SETTLEMENT_CONFIRMED','EFFECT_PARTIAL_SETTLEMENT_CONFIRMED') THEN
      UPDATE public.collection_instruments
      SET settled_amount = v_aggregate_total,
          settlement_state = CASE WHEN v_aggregate_total = v_aggregate_nominal
                                  THEN 'SETTLED' ELSE 'PARTIALLY_SETTLED' END,
          version = version + 1
      WHERE id = v_p.aggregate_id;
    ELSE
      UPDATE public.collection_instruments
      SET settlement_state = CASE WHEN v_p.proposed_event_type = 'BANK_RECOURSE_DEBIT_CONFIRMED'
                                  THEN 'RECOURSE_OPEN' ELSE 'UNPAID' END,
          version = version + 1
      WHERE id = v_p.aggregate_id;
      UPDATE public.collection_receipts r
      SET recourse_state = CASE WHEN v_p.proposed_event_type = 'BANK_RECOURSE_DEBIT_CONFIRMED'
                                THEN 'RECOURSE_OPEN' ELSE 'UNPAID' END,
          version = r.version + 1, updated_at = now(), updated_by = v_actor
      FROM public.collection_instruments i
      WHERE i.id = v_p.aggregate_id AND r.id = i.receipt_id;
    END IF;
  ELSIF v_p.aggregate_type = 'OUTBOUND_CHEQUE' THEN
    SELECT amount INTO v_aggregate_nominal FROM public.collection_outbound_cheques WHERE id = v_p.aggregate_id;
    UPDATE public.collection_outbound_cheques
    SET debited_amount = v_aggregate_total,
        status = CASE WHEN v_aggregate_total = v_aggregate_nominal
                      THEN 'DEBITED' ELSE 'PARTIALLY_DEBITED' END,
        version = version + 1, updated_at = now(), updated_by = v_actor
    WHERE id = v_p.aggregate_id;
  ELSIF v_p.aggregate_type = 'CHARGE' THEN
    UPDATE public.collection_remittance_charges
    SET observed_amount = v_aggregate_total,
        verification_state = CASE WHEN expected_amount = v_aggregate_total
                                  THEN 'RECONCILED' ELSE 'OBSERVED' END
    WHERE id = v_p.aggregate_id;
  END IF;

  v_result := jsonb_build_object('proposal_id', p_proposal_id, 'event_id', v_event_id,
    'allocation_id', v_allocation_id, 'aggregate_allocated_total', v_aggregate_total,
    'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor, 'confirm_collection_match_v1',
    v_p.aggregate_type, v_p.aggregate_id, v_correlation_id,
    jsonb_build_object('daily_line_id', v_p.daily_line_id, 'two_actor_check', true));
  PERFORM public.collection_idempotency_complete(v_actor,
    'confirm_collection_match_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.rebind_collection_superseded_evidence_v1(
  p_allocation_id uuid,
  p_new_daily_line_id uuid,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('CORRECT_EVENT');
  v_request jsonb := jsonb_build_object('allocation_id', p_allocation_id,
    'new_daily_line_id', p_new_daily_line_id, 'reason', btrim(p_reason));
  v_existing jsonb;
  v_old record;
  v_new public.daily_statement_lines_canonical%ROWTYPE;
  v_event_id uuid := gen_random_uuid();
  v_new_allocation_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'rebind_collection_superseded_evidence_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  PERFORM public.collection_assert_reason(p_reason);
  SELECT a.*, e.aggregate_type, e.aggregate_id, e.currency AS event_currency
    INTO v_old
  FROM public.collection_bank_line_allocations a
  JOIN public.collection_events e ON e.id = a.event_id
  JOIN public.daily_statement_lines_canonical l ON l.id = a.daily_line_id
  WHERE a.id = p_allocation_id AND a.evidence_state = 'ACTIVE' AND NOT l.is_active
  FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_SUPERSEDED_ALLOCATION_REQUIRED'; END IF;
  SELECT * INTO v_new FROM public.daily_statement_lines_canonical
  WHERE id = p_new_daily_line_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_ACTIVE_DAILY_LINE_REQUIRED'; END IF;
  IF v_new.daily_line_hash <> (
       SELECT daily_line_hash FROM public.daily_statement_lines_canonical WHERE id = v_old.daily_line_id
     ) OR v_new.currency <> v_old.currency OR abs(v_new.signed_amount) < v_old.allocated_amount THEN
    RAISE EXCEPTION 'COLLECTION_REBOUND_EVIDENCE_MISMATCH';
  END IF;

  UPDATE public.collection_bank_line_allocations
  SET evidence_state = 'EVIDENCE_SUPERSEDED' WHERE id = p_allocation_id;
  INSERT INTO public.collection_events (
    id, aggregate_type, aggregate_id, event_type, effective_date, amount,
    direction, currency, actor_id, reason, correlation_id
  ) VALUES (v_event_id, v_old.aggregate_type, v_old.aggregate_id,
            'BANK_EVIDENCE_REBOUND', coalesce(v_new.value_date, v_new.accounting_date),
            v_old.allocated_amount, upper(v_new.direction), v_new.currency,
            v_actor, btrim(p_reason), v_correlation_id);
  INSERT INTO public.collection_bank_line_allocations (
    id, event_id, daily_line_id, allocated_amount, currency, allocation_nature,
    evidence_state, supersedes_allocation_id, confirmed_by
  ) VALUES (v_new_allocation_id, v_event_id, p_new_daily_line_id,
            v_old.allocated_amount, v_old.currency, v_old.allocation_nature,
            'REBOUND', p_allocation_id, v_actor);
  UPDATE public.collection_match_proposals
  SET status = 'EVIDENCE_SUPERSEDED', reviewed_at = coalesce(reviewed_at, now()),
      reviewed_by = coalesce(reviewed_by, v_actor),
      review_reason = coalesce(review_reason, btrim(p_reason))
  WHERE daily_line_id = v_old.daily_line_id AND status = 'CONFIRMED';

  v_result := jsonb_build_object('old_allocation_id', p_allocation_id,
    'new_allocation_id', v_new_allocation_id, 'event_id', v_event_id,
    'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor,
    'rebind_collection_superseded_evidence_v1', v_old.aggregate_type,
    v_old.aggregate_id, v_correlation_id,
    jsonb_build_object('old_daily_line_id', v_old.daily_line_id,
                       'new_daily_line_id', p_new_daily_line_id));
  PERFORM public.collection_idempotency_complete(v_actor,
    'rebind_collection_superseded_evidence_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.calculate_collection_expected_charge_v1(
  p_account_registry_id uuid,
  p_product_code text,
  p_nominal numeric,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('ENTRY', p_account_registry_id);
  v_rule public.collection_charge_rules%ROWTYPE;
  v_days integer;
  v_interest numeric(18,2);
  v_commission numeric(18,2);
  v_tax numeric(18,2);
BEGIN
  IF p_nominal <= 0 OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'COLLECTION_CHARGE_INPUT_INVALID';
  END IF;
  SELECT * INTO v_rule FROM public.collection_charge_rules
  WHERE account_registry_id = p_account_registry_id
    AND product_code = btrim(p_product_code) AND status = 'ACTIVE'
    AND effective_from <= p_start_date
    AND (effective_until IS NULL OR effective_until >= p_start_date)
  ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_ACTIVE_CHARGE_RULE_NOT_FOUND'; END IF;
  v_days := p_end_date - p_start_date;
  v_interest := round(p_nominal * v_rule.annual_rate * v_days / v_rule.day_count_basis,
                      v_rule.rounding_scale);
  v_commission := round(greatest(v_rule.fixed_commission,
                                 p_nominal * v_rule.percent_commission,
                                 v_rule.minimum_commission), v_rule.rounding_scale);
  v_tax := round((v_interest + v_commission) * v_rule.tax_rate, v_rule.rounding_scale);
  RETURN jsonb_build_object('rule_id', v_rule.id, 'nominal', p_nominal,
    'days', v_days, 'interest_expected', v_interest,
    'commission_expected', v_commission, 'tax_expected', v_tax,
    'total_expected', v_interest + v_commission + v_tax,
    'observed_amount', NULL, 'currency_source', 'account_registry');
END;
$$;

-- --------------------------------------------------------------------------
-- 10. Administration locale des capacités et paramètres d'export/calcul
-- --------------------------------------------------------------------------

CREATE FUNCTION public.grant_collection_capability_v1(
  p_actor_id uuid,
  p_capability text,
  p_scope_id uuid,
  p_valid_until timestamptz,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_request jsonb := jsonb_build_object('actor_id', p_actor_id,
    'capability', upper(btrim(p_capability)), 'scope_id', p_scope_id,
    'valid_until', p_valid_until, 'reason', btrim(p_reason));
  v_existing jsonb;
  v_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'COLLECTION_ADMIN_REQUIRED';
  END IF;
  PERFORM public.collection_assert_reason(p_reason);
  IF upper(btrim(p_capability)) NOT IN (
    'ENTRY','PROPOSE_MATCH','CONFIRM_MATCH','APPROVE_PROROGATION',
    'ISSUE_FUNDING_CHEQUE','CONFIRM_DELIVERY','CORRECT_EVENT','AUDIT','MANAGE_CONFIG'
  ) OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_actor_id) THEN
    RAISE EXCEPTION 'COLLECTION_CAPABILITY_ASSIGNMENT_INVALID';
  END IF;
  v_existing := public.collection_idempotency_claim(v_admin,
    'grant_collection_capability_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  INSERT INTO public.collection_domain_assignments (
    id, actor_id, capability, scope_type, scope_id, valid_until,
    granted_by, reason
  ) VALUES (v_id, p_actor_id, upper(btrim(p_capability)),
            CASE WHEN p_scope_id IS NULL THEN 'GLOBAL' ELSE 'ACCOUNT' END,
            p_scope_id, p_valid_until, v_admin, btrim(p_reason));
  v_result := jsonb_build_object('assignment_id', v_id, 'actor_id', p_actor_id,
    'capability', upper(btrim(p_capability)), 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_admin, 'grant_collection_capability_v1',
    'ASSIGNMENT', v_id, v_correlation_id,
    jsonb_build_object('capability', upper(btrim(p_capability)),
                       'scoped', p_scope_id IS NOT NULL));
  PERFORM public.collection_idempotency_complete(v_admin,
    'grant_collection_capability_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.create_collection_charge_rule_v1(
  p_account_registry_id uuid,
  p_product_code text,
  p_effective_from date,
  p_annual_rate numeric,
  p_day_count_basis integer,
  p_fixed_commission numeric,
  p_percent_commission numeric,
  p_minimum_commission numeric,
  p_tax_rate numeric,
  p_rounding_scale integer,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('MANAGE_CONFIG', p_account_registry_id);
  v_request jsonb := jsonb_build_object('account_registry_id', p_account_registry_id,
    'product_code', btrim(p_product_code), 'effective_from', p_effective_from,
    'annual_rate', p_annual_rate, 'day_count_basis', p_day_count_basis,
    'fixed_commission', p_fixed_commission, 'percent_commission', p_percent_commission,
    'minimum_commission', p_minimum_commission, 'tax_rate', p_tax_rate,
    'rounding_scale', p_rounding_scale, 'reason', btrim(p_reason));
  v_existing jsonb;
  v_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'create_collection_charge_rule_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  PERFORM public.collection_assert_reason(p_reason);
  IF NOT EXISTS (SELECT 1 FROM public.daily_statement_account_registry
                 WHERE id = p_account_registry_id AND status = 'active') THEN
    RAISE EXCEPTION 'COLLECTION_ACTIVE_ACCOUNT_REQUIRED';
  END IF;
  INSERT INTO public.collection_charge_rules (
    id, account_registry_id, product_code, effective_from, annual_rate,
    day_count_basis, fixed_commission, percent_commission, minimum_commission,
    tax_rate, rounding_scale, status, created_by, reason
  ) VALUES (v_id, p_account_registry_id, btrim(p_product_code), p_effective_from,
    p_annual_rate, p_day_count_basis, p_fixed_commission, p_percent_commission,
    p_minimum_commission, p_tax_rate, p_rounding_scale, 'DRAFT', v_actor, btrim(p_reason));
  v_result := jsonb_build_object('charge_rule_id', v_id, 'status', 'DRAFT',
                                 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor, 'create_collection_charge_rule_v1',
    'CHARGE_RULE', v_id, v_correlation_id, jsonb_build_object('product_code', btrim(p_product_code)));
  PERFORM public.collection_idempotency_complete(v_actor,
    'create_collection_charge_rule_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.approve_collection_charge_rule_v1(
  p_charge_rule_id uuid,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule public.collection_charge_rules%ROWTYPE;
  v_actor uuid;
  v_request jsonb := jsonb_build_object('charge_rule_id', p_charge_rule_id, 'reason', btrim(p_reason));
  v_existing jsonb;
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  SELECT * INTO v_rule FROM public.collection_charge_rules
  WHERE id = p_charge_rule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_CHARGE_RULE_NOT_FOUND'; END IF;
  v_actor := public.collection_assert_actor('MANAGE_CONFIG', v_rule.account_registry_id);
  v_existing := public.collection_idempotency_claim(v_actor,
    'approve_collection_charge_rule_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  PERFORM public.collection_assert_reason(p_reason);
  IF v_rule.status <> 'DRAFT' OR v_rule.created_by = v_actor THEN
    RAISE EXCEPTION 'COLLECTION_CONFIG_TWO_ACTORS_REQUIRED';
  END IF;
  UPDATE public.collection_charge_rules
  SET status = 'ACTIVE', approved_at = now(), approved_by = v_actor,
      reason = btrim(p_reason)
  WHERE id = p_charge_rule_id;
  v_result := jsonb_build_object('charge_rule_id', p_charge_rule_id, 'status', 'ACTIVE',
                                 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor, 'approve_collection_charge_rule_v1',
    'CHARGE_RULE', p_charge_rule_id, v_correlation_id, jsonb_build_object('two_actor_check', true));
  PERFORM public.collection_idempotency_complete(v_actor,
    'approve_collection_charge_rule_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.create_collection_export_mapping_v1(
  p_operation_nature text,
  p_account_registry_id uuid,
  p_account_code text,
  p_account_label text,
  p_effective_from date,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_assert_actor('MANAGE_CONFIG', p_account_registry_id);
  v_request jsonb := jsonb_build_object('operation_nature', upper(btrim(p_operation_nature)),
    'account_registry_id', p_account_registry_id, 'account_code', btrim(p_account_code),
    'account_label', btrim(p_account_label), 'effective_from', p_effective_from,
    'reason', btrim(p_reason));
  v_existing jsonb;
  v_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  v_existing := public.collection_idempotency_claim(v_actor,
    'create_collection_export_mapping_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  PERFORM public.collection_assert_reason(p_reason);
  INSERT INTO public.collection_accounting_export_mappings (
    id, operation_nature, account_registry_id, account_code, account_label,
    effective_from, status, created_by, reason
  ) VALUES (v_id, upper(btrim(p_operation_nature)), p_account_registry_id,
            btrim(p_account_code), btrim(p_account_label), p_effective_from,
            'DRAFT', v_actor, btrim(p_reason));
  v_result := jsonb_build_object('mapping_id', v_id, 'status', 'DRAFT',
                                 'export_only', true, 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor, 'create_collection_export_mapping_v1',
    'EXPORT_MAPPING', v_id, v_correlation_id, jsonb_build_object('export_only', true));
  PERFORM public.collection_idempotency_complete(v_actor,
    'create_collection_export_mapping_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.approve_collection_export_mapping_v1(
  p_mapping_id uuid,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mapping public.collection_accounting_export_mappings%ROWTYPE;
  v_actor uuid;
  v_request jsonb := jsonb_build_object('mapping_id', p_mapping_id, 'reason', btrim(p_reason));
  v_existing jsonb;
  v_correlation_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  SELECT * INTO v_mapping FROM public.collection_accounting_export_mappings
  WHERE id = p_mapping_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTION_EXPORT_MAPPING_NOT_FOUND'; END IF;
  v_actor := public.collection_assert_actor('MANAGE_CONFIG', v_mapping.account_registry_id);
  v_existing := public.collection_idempotency_claim(v_actor,
    'approve_collection_export_mapping_v1', p_idempotency_key, v_request);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  PERFORM public.collection_assert_reason(p_reason);
  IF v_mapping.status <> 'DRAFT' OR v_mapping.created_by = v_actor THEN
    RAISE EXCEPTION 'COLLECTION_CONFIG_TWO_ACTORS_REQUIRED';
  END IF;
  UPDATE public.collection_accounting_export_mappings
  SET status = 'ACTIVE', approved_at = now(), approved_by = v_actor,
      reason = btrim(p_reason)
  WHERE id = p_mapping_id;
  v_result := jsonb_build_object('mapping_id', p_mapping_id, 'status', 'ACTIVE',
                                 'export_only', true, 'correlation_id', v_correlation_id);
  PERFORM public.collection_write_audit(v_actor, 'approve_collection_export_mapping_v1',
    'EXPORT_MAPPING', p_mapping_id, v_correlation_id, jsonb_build_object('two_actor_check', true));
  PERFORM public.collection_idempotency_complete(v_actor,
    'approve_collection_export_mapping_v1', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- Vue de contrôle : une preuve confirmée devient explicitement à reprendre si
-- Daily v2 a supersédé sa ligne. La vue n'écrit jamais dans Daily v2.
CREATE VIEW public.collection_bank_line_evidence_status_v AS
SELECT
  a.id AS allocation_id,
  a.event_id,
  a.daily_line_id,
  l.daily_line_hash,
  l.is_active AS daily_line_is_active,
  a.evidence_state,
  CASE
    WHEN NOT l.is_active AND a.evidence_state = 'ACTIVE' THEN 'REVIEW_REQUIRED'
    WHEN a.evidence_state = 'EVIDENCE_SUPERSEDED' THEN 'REBOUND_REQUIRED'
    ELSE 'CURRENT'
  END AS control_state,
  a.allocated_amount,
  a.currency,
  e.aggregate_type,
  e.aggregate_id,
  a.confirmed_at,
  a.confirmed_by
FROM public.collection_bank_line_allocations a
JOIN public.collection_events e ON e.id = a.event_id
JOIN public.daily_statement_lines_canonical l ON l.id = a.daily_line_id
WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
   OR public.has_role(auth.uid(), 'manager'::public.app_role)
   OR public.has_role(auth.uid(), 'auditor'::public.app_role)
   OR public.has_role(auth.uid(), 'user'::public.app_role);

-- --------------------------------------------------------------------------
-- 11. RLS, ACL et surface RPC fermée
-- --------------------------------------------------------------------------

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'collection_domain_assignments','collection_command_idempotency',
    'collection_receipts','collection_import_origins','collection_instruments',
    'collection_instrument_identities','collection_invoice_allocations',
    'collection_bank_remittances','collection_bank_remittance_items',
    'collection_charge_rules','collection_remittance_charges',
    'collection_prorogations','collection_prorogation_source_allocations',
    'collection_prorogation_replacement_effects','collection_outbound_cheques',
    'collection_prorogation_funding_cheques','collection_events',
    'collection_match_proposals','collection_bank_line_allocations',
    'collection_accounting_export_mappings','collection_audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
  END LOOP;
END;
$$;

CREATE POLICY collection_assignments_select
ON public.collection_domain_assignments FOR SELECT TO authenticated
USING (
  actor_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'auditor'::public.app_role)
);

CREATE POLICY collection_idempotency_select
ON public.collection_command_idempotency FOR SELECT TO authenticated
USING (
  actor_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'auditor'::public.app_role)
);

CREATE POLICY collection_audit_select
ON public.collection_audit_events FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  OR public.collection_has_capability(auth.uid(), 'AUDIT')
);

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'collection_receipts','collection_import_origins','collection_instruments',
    'collection_instrument_identities','collection_invoice_allocations',
    'collection_bank_remittances','collection_bank_remittance_items',
    'collection_charge_rules','collection_remittance_charges',
    'collection_prorogations','collection_prorogation_source_allocations',
    'collection_prorogation_replacement_effects','collection_outbound_cheques',
    'collection_prorogation_funding_cheques','collection_events',
    'collection_match_proposals','collection_bank_line_allocations',
    'collection_accounting_export_mappings'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (' ||
      'public.has_role(auth.uid(), ''admin''::public.app_role) OR ' ||
      'public.has_role(auth.uid(), ''manager''::public.app_role) OR ' ||
      'public.has_role(auth.uid(), ''auditor''::public.app_role) OR ' ||
      'public.has_role(auth.uid(), ''user''::public.app_role))',
      v_table || '_select', v_table
    );
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE
  public.collection_domain_assignments,
  public.collection_command_idempotency,
  public.collection_receipts,
  public.collection_import_origins,
  public.collection_instruments,
  public.collection_instrument_identities,
  public.collection_invoice_allocations,
  public.collection_bank_remittances,
  public.collection_bank_remittance_items,
  public.collection_charge_rules,
  public.collection_remittance_charges,
  public.collection_prorogations,
  public.collection_prorogation_source_allocations,
  public.collection_prorogation_replacement_effects,
  public.collection_outbound_cheques,
  public.collection_prorogation_funding_cheques,
  public.collection_events,
  public.collection_match_proposals,
  public.collection_bank_line_allocations,
  public.collection_accounting_export_mappings,
  public.collection_audit_events,
  public.collection_bank_line_evidence_status_v
TO authenticated;

REVOKE ALL ON TABLE public.collection_bank_line_evidence_status_v
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.collection_bank_line_evidence_status_v TO authenticated;

DO $$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'collection_reject_mutation','collection_assert_reason',
        'collection_has_capability','collection_assert_actor',
        'collection_idempotency_claim','collection_idempotency_complete',
        'collection_write_audit','create_collection_receipt_v1',
        'allocate_collection_invoice_v1','create_collection_prorogation_v1',
        'attach_collection_prorogation_source_v1',
        'attach_collection_replacement_effect_v1','prepare_collection_funding_cheque_v1',
        'approve_collection_funding_cheque_v1','confirm_collection_funding_delivery_v1',
        'propose_collection_match_v1','confirm_collection_match_v1',
        'rebind_collection_superseded_evidence_v1','calculate_collection_expected_charge_v1',
        'grant_collection_capability_v1','create_collection_charge_rule_v1',
        'approve_collection_charge_rule_v1','create_collection_export_mapping_v1',
        'approve_collection_export_mapping_v1'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_function);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_collection_receipt_v1(jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_collection_invoice_v1(uuid,text,numeric,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_collection_prorogation_v1(text,numeric,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_collection_prorogation_source_v1(uuid,text,text,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_collection_replacement_effect_v1(uuid,uuid,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_collection_funding_cheque_v1(uuid,uuid,text,text,numeric,date,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_collection_funding_cheque_v1(uuid,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_collection_funding_delivery_v1(uuid,date,text,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_collection_match_v1(text,uuid,uuid,text,numeric,numeric,text[],text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_collection_match_v1(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rebind_collection_superseded_evidence_v1(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_collection_expected_charge_v1(uuid,text,numeric,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_collection_capability_v1(uuid,text,uuid,timestamptz,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_collection_charge_rule_v1(uuid,text,date,numeric,integer,numeric,numeric,numeric,numeric,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_collection_charge_rule_v1(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_collection_export_mapping_v1(text,uuid,text,text,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_collection_export_mapping_v1(uuid,text,text) TO authenticated;

COMMIT;
