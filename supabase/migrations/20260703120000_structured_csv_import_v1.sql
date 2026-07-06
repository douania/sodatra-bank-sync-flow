-- ============================================================================
-- POC-BANK-STRUCTURED-EXPORTS-0U — MIGRATION CANDIDATE v1 (NON APPLIQUÉE EN PROD)
-- ============================================================================
-- Import CSV structuré : attempts → staging → canonical + audit append-only.
--
-- STATUT : CANDIDATE. Ne pas exécuter sur Supabase live sans :
--   1. tests read-only préalables (DB_TRUTH §6 + absence d'objets homonymes) ;
--   2. passage staging ;
--   3. GO CTO explicite (SECURITY_CONTRACT §9 et §12).
--
-- Provenance : draft docs/db-drafts/structured-csv-import-0P.sql (révisé 0R)
-- + rapport de design 0T. HEAD main de référence :
--   e4637d0728ee3b36d482f46e18eaa01b41ad8207
--
-- Décisions CTO 0U appliquées :
--   1.  Option A : lines_canonical.is_active NOT NULL (toujours explicite)
--       + UNIQUE(line_hash) WHERE is_active + UNIQUE(canonical_statement_id,
--       line_hash) ; is_active modifié uniquement par les RPC promote/supersede.
--   2.  Promotion needs_review : admin seul.
--   3.  Manager : dépôt (pre_ingest) + escalation uniquement.
--   4.  Rôle user : aucun accès au pipeline (fail-closed).
--   5.  TEXT + CHECK, aucun enum Postgres créé.
--   6.  safe_details : whitelist stricte + valeurs scalaires uniquement.
--   7.  Aucune écriture directe des rôles applicatifs sur les 6 tables :
--       toutes les écritures passent par les RPC SECURITY DEFINER (le dépôt
--       d'attempts inclus — via pre_ingest — pour garantir l'event systématique).
--   8.  RPC SECURITY DEFINER : search_path épinglé (public, pg_temp),
--       REVOKE EXECUTE FROM PUBLIC/anon, rôle vérifié dans chaque fonction.
--   9.  RPC pre_ingest_structured_bank_statement = write path staging.
--   10. Dates : helper strict DD/MM/YYYY avec round-trip, aucun cast implicite.
--
-- Invariants données (0J/0K/0O) : no raw CSV, no raw bytes, no full account,
-- no full IBAN. Seuls account_fingerprint (hash) et account_number_masked
-- (****1234) sont admis. description_sanitized = libellé normalisé, PAS
-- anonymisé : donnée sensible, lecture RLS minimale.
--
-- NOTE transaction : pas de BEGIN/COMMIT explicite — le CLI supabase applique
-- chaque migration dans une transaction ; ce choix permet aussi le test de
-- rollback local (BEGIN; \i ...; ROLLBACK;).
-- ============================================================================

-- ============================================================================
-- SECTION 1 — TABLES (TEXT + CHECK, décision CTO 5)
-- ============================================================================

-- 1.A  Tentatives d'import (une ligne par dépôt, y compris rejets).
CREATE TABLE public.bank_statement_import_attempts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users (id),

  source_format             text NOT NULL,
  source_file_name_redacted text,
  bank                      text NOT NULL,

  account_fingerprint       text,
  account_number_masked     text,

  raw_text_hash             text,
  import_id                 text,

  parser_validation_status  text,
  success                   boolean NOT NULL DEFAULT false,
  ingestion_ready           boolean NOT NULL DEFAULT false,
  rejected_reason           text,
  errors_count              integer NOT NULL DEFAULT 0 CHECK (errors_count >= 0),
  warnings_count            integer NOT NULL DEFAULT 0 CHECK (warnings_count >= 0),

  status                    text NOT NULL DEFAULT 'received',

  runtime_version           text,
  parser_version            text,

  CONSTRAINT attempts_status_domain CHECK (status IN (
    'received', 'rejected', 'pre_ingested', 'ingestion_ready', 'needs_review',
    'duplicate', 'conflict', 'ingested', 'superseded', 'failed'
  )),
  CONSTRAINT attempts_parser_validation_status_domain CHECK (
    parser_validation_status IS NULL
    OR parser_validation_status IN ('valid', 'needs_review', 'invalid', 'unsupported')
  ),
  CONSTRAINT attempts_masked_never_full_account
    CHECK (account_number_masked IS NULL OR account_number_masked LIKE '%*%'),
  CONSTRAINT attempts_ingestion_ready_requires_success
    CHECK (NOT ingestion_ready OR success),
  CONSTRAINT attempts_ingestion_ready_requires_import_id
    CHECK (NOT ingestion_ready OR import_id IS NOT NULL),
  CONSTRAINT attempts_ingestion_ready_requires_fingerprint
    CHECK (NOT ingestion_ready OR account_fingerprint IS NOT NULL),
  CONSTRAINT attempts_ingestion_ready_requires_parser_status
    CHECK (NOT ingestion_ready OR parser_validation_status IS NOT NULL),
  CONSTRAINT attempts_rejected_has_reason
    CHECK (status <> 'rejected' OR rejected_reason IS NOT NULL),
  CONSTRAINT attempts_hash_required_after_decode
    CHECK (raw_text_hash IS NOT NULL OR status IN ('received', 'rejected', 'failed'))
);

COMMENT ON TABLE public.bank_statement_import_attempts IS
  'Tentatives d''import CSV structuré. Jamais de CSV brut. Écriture uniquement via RPC pre_ingest/reject/etc. Statuts received/pre_ingested non utilisés par le flux v1 (réservés à un séquencement plus fin).';

-- 1.B  Header de relevé en staging (quarantaine avant promotion).
CREATE TABLE public.bank_statement_staging (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id                uuid NOT NULL REFERENCES public.bank_statement_import_attempts (id),
  import_id                 text NOT NULL,
  raw_text_hash             text NOT NULL,

  bank                      text NOT NULL,
  account_fingerprint       text NOT NULL,
  account_number_masked     text,
  currency                  text NOT NULL,

  period_start_date         date NOT NULL,
  period_end_date           date NOT NULL,
  statement_date            date,

  opening_balance           numeric(18, 2) NOT NULL,
  total_debits              numeric(18, 2) NOT NULL,
  total_credits             numeric(18, 2) NOT NULL,
  closing_balance           numeric(18, 2) NOT NULL,

  validation_status         text NOT NULL,
  calculated_closing        numeric(18, 2),
  discrepancy               numeric(18, 2),
  line_count                integer NOT NULL CHECK (line_count >= 0),

  status                    text NOT NULL DEFAULT 'not_promoted',
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users (id),

  -- R5/R6 : seuls valid et needs_review atteignent le staging (0T, D-1).
  CONSTRAINT staging_validation_status_domain
    CHECK (validation_status IN ('valid', 'needs_review')),
  CONSTRAINT staging_status_domain CHECK (status IN (
    'not_promoted', 'promotion_pending', 'promoted', 'promotion_failed', 'superseded'
  )),
  CONSTRAINT staging_one_per_attempt UNIQUE (attempt_id),
  CONSTRAINT staging_period_coherent
    CHECK (period_end_date >= period_start_date),
  CONSTRAINT staging_masked_never_full_account
    CHECK (account_number_masked IS NULL OR account_number_masked LIKE '%*%')
);

-- 1.C  Lignes de transaction en staging.
CREATE TABLE public.bank_statement_lines_staging (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_statement_id      uuid NOT NULL REFERENCES public.bank_statement_staging (id) ON DELETE CASCADE,
  attempt_id                uuid NOT NULL REFERENCES public.bank_statement_import_attempts (id),
  import_id                 text NOT NULL,
  line_hash                 text NOT NULL,

  source_line_index         integer NOT NULL CHECK (source_line_index >= 0),
  transaction_date          date NOT NULL,
  value_date                date,

  -- Libellé normalisé, PAS anonymisé (0R) : donnée sensible, RLS minimale.
  description_sanitized     text NOT NULL,

  debit_amount              numeric(18, 2),
  credit_amount             numeric(18, 2),
  signed_amount             numeric(18, 2) NOT NULL,
  running_balance           numeric(18, 2),
  direction                 text NOT NULL CHECK (direction IN ('debit', 'credit')),
  currency                  text NOT NULL,

  status                    text NOT NULL DEFAULT 'not_promoted',
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lines_staging_status_domain CHECK (status IN (
    'not_promoted', 'promotion_pending', 'promoted', 'promotion_failed', 'superseded'
  )),
  CONSTRAINT lines_staging_one_amount
    CHECK (
      (direction = 'debit'  AND debit_amount  IS NOT NULL AND credit_amount IS NULL) OR
      (direction = 'credit' AND credit_amount IS NOT NULL AND debit_amount  IS NULL)
    ),
  CONSTRAINT lines_staging_unique_per_statement
    UNIQUE (staging_statement_id, line_hash)
);

-- 1.D  Relevés promus (source de vérité).
CREATE TABLE public.bank_statement_canonical (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoted_from_staging_id  uuid NOT NULL REFERENCES public.bank_statement_staging (id),
  import_id                 text NOT NULL,
  active_raw_text_hash      text NOT NULL,

  bank                      text NOT NULL,
  account_fingerprint       text NOT NULL,
  account_number_masked     text,
  currency                  text NOT NULL,

  period_start_date         date NOT NULL,
  period_end_date           date NOT NULL,
  statement_date            date,

  opening_balance           numeric(18, 2) NOT NULL,
  total_debits              numeric(18, 2) NOT NULL,
  total_credits             numeric(18, 2) NOT NULL,
  closing_balance           numeric(18, 2) NOT NULL,

  validation_status         text NOT NULL,
  status                    text NOT NULL DEFAULT 'ingested',

  ingested_at               timestamptz NOT NULL DEFAULT now(),
  ingested_by               uuid REFERENCES auth.users (id),

  -- Chaîne de remplacement. DEFERRABLE : la séquence supersede référence l'id
  -- du nouveau canonical AVANT son insertion (vérification FK au COMMIT).
  superseded_by             uuid REFERENCES public.bank_statement_canonical (id)
                              DEFERRABLE INITIALLY DEFERRED,
  superseded_at             timestamptz,

  CONSTRAINT canonical_validation_status_domain
    CHECK (validation_status IN ('valid', 'needs_review')),
  CONSTRAINT canonical_status_domain
    CHECK (status IN ('ingested', 'superseded')),
  CONSTRAINT canonical_supersede_coherent
    CHECK (
      (status = 'ingested'   AND superseded_by IS NULL     AND superseded_at IS NULL) OR
      (status = 'superseded' AND superseded_by IS NOT NULL AND superseded_at IS NOT NULL)
    ),
  CONSTRAINT canonical_masked_never_full_account
    CHECK (account_number_masked IS NULL OR account_number_masked LIKE '%*%')
);

COMMENT ON TABLE public.bank_statement_canonical IS
  'Relevés promus. Aucune policy INSERT/UPDATE/DELETE : mutations uniquement via RPC promote/supersede (SECURITY DEFINER). Correction = supersede, jamais DELETE.';

-- 1.E  Lignes promues (immuables ; is_active = seul champ de cycle de vie).
CREATE TABLE public.bank_statement_lines_canonical (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_statement_id    uuid NOT NULL REFERENCES public.bank_statement_canonical (id),
  import_id                 text NOT NULL,
  line_hash                 text NOT NULL,

  -- Option A (décision CTO 1) : dénormalisation du statut actif du parent.
  -- Toujours explicite (pas de DEFAULT) ; maintenu EXCLUSIVEMENT par les RPC
  -- promote/supersede dans la même transaction que la bascule du parent.
  is_active                 boolean NOT NULL,

  transaction_date          date NOT NULL,
  value_date                date,
  description_sanitized     text NOT NULL,

  debit_amount              numeric(18, 2),
  credit_amount             numeric(18, 2),
  signed_amount             numeric(18, 2) NOT NULL,
  running_balance           numeric(18, 2),
  direction                 text NOT NULL CHECK (direction IN ('debit', 'credit')),
  currency                  text NOT NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lines_canonical_one_amount
    CHECK (
      (direction = 'debit'  AND debit_amount  IS NOT NULL AND credit_amount IS NULL) OR
      (direction = 'credit' AND credit_amount IS NOT NULL AND debit_amount  IS NULL)
    )
);

COMMENT ON COLUMN public.bank_statement_lines_canonical.is_active IS
  'Option A (0T/0U) : true tant que le relevé parent est ingested ; basculé à false par la RPC supersede. Jamais modifiable directement par un rôle applicatif.';

-- 1.F  Audit append-only du pipeline.
CREATE TABLE public.bank_statement_import_events (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  actor_id                  uuid REFERENCES auth.users (id),

  attempt_id                uuid REFERENCES public.bank_statement_import_attempts (id),
  staging_statement_id      uuid REFERENCES public.bank_statement_staging (id),
  canonical_statement_id    uuid REFERENCES public.bank_statement_canonical (id),
  import_id                 text,
  raw_text_hash             text,

  event_type                text NOT NULL,
  previous_status           text,
  new_status                text,

  safe_message              text,
  safe_details              jsonb,

  CONSTRAINT events_event_type_domain CHECK (event_type IN (
    'attempt_received', 'attempt_rejected', 'attempt_failed', 'pre_ingested',
    'marked_ingestion_ready', 'marked_needs_review', 'duplicate_detected',
    'conflict_detected', 'review_requested', 'promotion_requested', 'promoted',
    'promotion_failed', 'superseded', 'status_changed'
  )),
  CONSTRAINT events_reference_something
    CHECK (
      attempt_id IS NOT NULL OR
      staging_statement_id IS NOT NULL OR
      canonical_statement_id IS NOT NULL
    ),
  -- Ceinture structurelle top-level ; la profondeur est neutralisée par la
  -- règle « valeurs scalaires uniquement » de la RPC d'audit (décision CTO 6).
  CONSTRAINT events_safe_details_no_banned_keys
    CHECK (
      safe_details IS NULL
      OR NOT (safe_details ?| ARRAY[
        'raw_csv', 'raw_text', 'raw_bytes', 'raw_content', 'file_content',
        'account_number', 'iban'
      ])
    )
);

COMMENT ON TABLE public.bank_statement_import_events IS
  'Audit append-only. INSERT uniquement via structured_csv_append_audit_event (whitelist + scalaires). Aucune policy UPDATE/DELETE ; privilèges d''écriture révoqués.';

-- ============================================================================
-- SECTION 2 — INDEX
-- ============================================================================

-- Un seul relevé ACTIF par import_id (les superseded n'entrent pas en collision).
CREATE UNIQUE INDEX uq_canonical_active_import_id
  ON public.bank_statement_canonical (import_id)
  WHERE status = 'ingested';

-- Un line_hash unique PAR relevé canonical (les doublons métier d'un même
-- relevé sont déjà différenciés par occurrenceOrdinal côté runtime).
CREATE UNIQUE INDEX uq_lines_canonical_line_hash_per_statement
  ON public.bank_statement_lines_canonical (canonical_statement_id, line_hash);

-- Option A : un line_hash n'est ACTIF qu'une seule fois, tous relevés confondus.
CREATE UNIQUE INDEX uq_lines_canonical_line_hash_active
  ON public.bank_statement_lines_canonical (line_hash)
  WHERE is_active;

CREATE INDEX idx_attempts_raw_text_hash
  ON public.bank_statement_import_attempts (raw_text_hash)
  WHERE raw_text_hash IS NOT NULL;
CREATE INDEX idx_attempts_import_id
  ON public.bank_statement_import_attempts (import_id);
CREATE INDEX idx_attempts_status
  ON public.bank_statement_import_attempts (status);
CREATE INDEX idx_lines_staging_import_id
  ON public.bank_statement_lines_staging (import_id);
CREATE INDEX idx_lines_canonical_import_id
  ON public.bank_statement_lines_canonical (import_id);
-- FK non indexée par défaut ; lecture UI de base = historique par tentative.
CREATE INDEX idx_events_attempt_id
  ON public.bank_statement_import_events (attempt_id);

-- ============================================================================
-- SECTION 3 — HELPERS INTERNES (SECURITY INVOKER, aucun EXECUTE applicatif)
-- ============================================================================
-- Ces fonctions ne sont PAS des RPC : elles s'exécutent dans le contexte
-- definer (owner) des RPC appelantes. EXECUTE révoqué de tous les rôles
-- applicatifs en SECTION 7 (double verrou : INVOKER + zéro grant).

-- 3.1 Dates DD/MM/YYYY strictes (décision CTO 10 ; draft 5B D1/D2).
CREATE OR REPLACE FUNCTION public.structured_csv_parse_date_strict(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date date;
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_DATE_NULL: date value required (fail-closed)';
  END IF;
  IF p_value !~ '^\d{2}/\d{2}/\d{4}$' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_DATE_FORMAT: expected DD/MM/YYYY (fail-closed)';
  END IF;
  -- Conversion EXPLICITE : jamais de cast ::date (dépendant du DateStyle).
  v_date := to_date(p_value, 'DD/MM/YYYY');
  -- Round-trip obligatoire (D2) : aucune correction silencieuse.
  IF to_char(v_date, 'DD/MM/YYYY') <> p_value THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_DATE_ROUNDTRIP: value rejected (fail-closed)';
  END IF;
  RETURN v_date;
END;
$$;

-- 3.2 Montants stricts : numeric, échelle max 2 (les colonnes numeric(18,2)
--     arrondiraient silencieusement — interdit, SECURITY_CONTRACT §7).
CREATE OR REPLACE FUNCTION public.structured_csv_parse_amount_strict(p_value text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_num numeric;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_num := p_value::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_AMOUNT_FORMAT: numeric value rejected (fail-closed)';
  END;
  IF v_num IS DISTINCT FROM round(v_num, 2) THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_AMOUNT_SCALE: more than 2 decimals rejected (fail-closed)';
  END IF;
  RETURN v_num;
END;
$$;

-- 3.3 Whitelist safe_details + valeurs scalaires uniquement (décision CTO 6).
CREATE OR REPLACE FUNCTION public.structured_csv_assert_safe_details(p_details jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key  text;
  v_type text;
  -- Whitelist FIGÉE (0T/0U). Toute extension = décision CTO + migration.
  v_allowed constant text[] := ARRAY[
    'reason_code', 'errors_count', 'warnings_count', 'line_count', 'import_id',
    'raw_text_hash', 'line_hash', 'previous_status', 'new_status', 'resolution',
    'parser_version', 'runtime_version'
  ];
BEGIN
  IF p_details IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_details) <> 'object' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_SAFE_DETAILS_TYPE: object required (fail-closed)';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_details) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'STRUCTURED_CSV_SAFE_DETAILS_KEY: key outside whitelist (fail-closed)';
    END IF;
    v_type := jsonb_typeof(p_details -> v_key);
    -- Scalaires uniquement : neutralise structurellement toute clé bannie
    -- imbriquée (le CHECK table ne couvre que le top-level).
    IF v_type NOT IN ('string', 'number', 'boolean', 'null') THEN
      RAISE EXCEPTION 'STRUCTURED_CSV_SAFE_DETAILS_SCALAR: nested values rejected (fail-closed)';
    END IF;
  END LOOP;
END;
$$;

-- 3.4 Raison humaine safe : non vide, longueur bornée (jamais de contenu CSV —
--     discipline appelant ; la borne limite l'exfiltration accidentelle).
CREATE OR REPLACE FUNCTION public.structured_csv_assert_safe_reason(p_reason text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_REASON_REQUIRED: non-empty reason required (fail-closed)';
  END IF;
  IF length(p_reason) > 200 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_REASON_TOO_LONG: max 200 chars (fail-closed)';
  END IF;
END;
$$;

-- 3.5 Whitelist de clés d'un payload jsonb (anti-smuggling : un payload de
--     dépôt ne peut pas transporter raw_csv & co sous des clés imprévues).
CREATE OR REPLACE FUNCTION public.structured_csv_assert_object_keys(
  p_object  jsonb,
  p_allowed text[]
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_object IS NULL OR jsonb_typeof(p_object) <> 'object' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_PAYLOAD_TYPE: object required (fail-closed)';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_object) LOOP
    IF NOT (v_key = ANY (p_allowed)) THEN
      RAISE EXCEPTION 'STRUCTURED_CSV_PAYLOAD_KEY: key outside whitelist (fail-closed)';
    END IF;
  END LOOP;
END;
$$;

-- 3.6 Verrou par import_id (draft 7.9) : sérialise promotion/supersede/dépôt
--     décisionnel d'un même relevé logique. Libéré au COMMIT/ROLLBACK.
CREATE OR REPLACE FUNCTION public.structured_csv_acquire_import_lock(p_import_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_import_id IS NULL OR length(btrim(p_import_id)) = 0 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_LOCK_IMPORT_ID: non-empty import_id required (fail-closed)';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_import_id, 0));
END;
$$;

-- 3.7 SEUL point d'écriture de bank_statement_import_events (draft 7.8).
--     INVOKER : ne s'exécute avec des privilèges élevés que lorsqu'elle est
--     appelée depuis une RPC SECURITY DEFINER (contexte owner).
CREATE OR REPLACE FUNCTION public.structured_csv_append_audit_event(
  p_actor_id               uuid,
  p_attempt_id             uuid,
  p_staging_statement_id   uuid,
  p_canonical_statement_id uuid,
  p_import_id              text,
  p_raw_text_hash          text,
  p_event_type             text,
  p_previous_status        text,
  p_new_status             text,
  p_safe_message           text,
  p_safe_details           jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.structured_csv_assert_safe_details(p_safe_details);
  INSERT INTO public.bank_statement_import_events (
    actor_id, attempt_id, staging_statement_id, canonical_statement_id,
    import_id, raw_text_hash, event_type, previous_status, new_status,
    safe_message, safe_details
  ) VALUES (
    p_actor_id, p_attempt_id, p_staging_statement_id, p_canonical_statement_id,
    p_import_id, p_raw_text_hash, p_event_type, p_previous_status, p_new_status,
    p_safe_message, p_safe_details
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 3.8 Cœur de promotion staging -> canonical, partagé par promote (7.1),
--     approve_needs_review (7.6) et supersede (7.7). Préconditions à la charge
--     de l'appelant : verrou import_id pris, R1/R2/R3 déjà arbitrés.
CREATE OR REPLACE FUNCTION public.structured_csv_promote_staging_core(
  p_attempt_id       uuid,
  p_staging_id       uuid,
  p_new_canonical_id uuid,
  p_actor            uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staging       public.bank_statement_staging%ROWTYPE;
  v_attempt       public.bank_statement_import_attempts%ROWTYPE;
  v_inserted      integer;
  v_active_count  integer;
BEGIN
  SELECT * INTO v_staging
  FROM public.bank_statement_staging WHERE id = p_staging_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_CORE_STAGING_NOT_FOUND (fail-closed)';
  END IF;
  SELECT * INTO v_attempt
  FROM public.bank_statement_import_attempts WHERE id = p_attempt_id;
  IF NOT FOUND OR v_staging.attempt_id <> p_attempt_id THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_CORE_ATTEMPT_MISMATCH (fail-closed)';
  END IF;
  IF v_staging.status <> 'not_promoted' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_CORE_STAGING_STATE: staging not promotable (fail-closed)';
  END IF;

  INSERT INTO public.bank_statement_canonical (
    id, promoted_from_staging_id, import_id, active_raw_text_hash,
    bank, account_fingerprint, account_number_masked, currency,
    period_start_date, period_end_date, statement_date,
    opening_balance, total_debits, total_credits, closing_balance,
    validation_status, status, ingested_by
  ) VALUES (
    p_new_canonical_id, v_staging.id, v_staging.import_id, v_staging.raw_text_hash,
    v_staging.bank, v_staging.account_fingerprint, v_staging.account_number_masked, v_staging.currency,
    v_staging.period_start_date, v_staging.period_end_date, v_staging.statement_date,
    v_staging.opening_balance, v_staging.total_debits, v_staging.total_credits, v_staging.closing_balance,
    v_staging.validation_status, 'ingested', p_actor
  );

  INSERT INTO public.bank_statement_lines_canonical (
    canonical_statement_id, import_id, line_hash, is_active,
    transaction_date, value_date, description_sanitized,
    debit_amount, credit_amount, signed_amount, running_balance,
    direction, currency
  )
  SELECT
    p_new_canonical_id, ls.import_id, ls.line_hash, true,
    ls.transaction_date, ls.value_date, ls.description_sanitized,
    ls.debit_amount, ls.credit_amount, ls.signed_amount, ls.running_balance,
    ls.direction, ls.currency
  FROM public.bank_statement_lines_staging ls
  WHERE ls.staging_statement_id = v_staging.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_staging.line_count THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_CORE_LINE_COUNT: staged/promoted mismatch (fail-closed)';
  END IF;

  UPDATE public.bank_statement_lines_staging
    SET status = 'promoted'
    WHERE staging_statement_id = v_staging.id;
  UPDATE public.bank_statement_staging
    SET status = 'promoted'
    WHERE id = v_staging.id;
  UPDATE public.bank_statement_import_attempts
    SET status = 'ingested'
    WHERE id = p_attempt_id;

  PERFORM public.structured_csv_append_audit_event(
    p_actor, p_attempt_id, v_staging.id, p_new_canonical_id,
    v_staging.import_id, v_staging.raw_text_hash,
    'promoted', v_attempt.status, 'ingested',
    'structured statement promoted to canonical', NULL
  );

  -- Postcondition : exactement UN canonical actif pour cet import_id.
  SELECT count(*) INTO v_active_count
  FROM public.bank_statement_canonical
  WHERE import_id = v_staging.import_id AND status = 'ingested';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_CORE_POSTCONDITION: active canonical count <> 1 (rollback)';
  END IF;

  RETURN p_new_canonical_id;
END;
$$;

-- 3.9 Trigger anti-promote (draft 4.5, version structurelle 0T D-9) :
--     ceinture indépendante des RPC. La logique fine (acteur humain admin
--     pour needs_review/conflict) reste portée par les RPC.
CREATE OR REPLACE FUNCTION public.structured_csv_assert_canonical_insert_allowed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staging public.bank_statement_staging%ROWTYPE;
  v_attempt public.bank_statement_import_attempts%ROWTYPE;
BEGIN
  IF NEW.status <> 'ingested' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_TRIGGER_STATUS: canonical must be inserted as ingested (fail-closed)';
  END IF;
  SELECT * INTO v_staging
  FROM public.bank_statement_staging WHERE id = NEW.promoted_from_staging_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_TRIGGER_STAGING: staging row required (fail-closed)';
  END IF;
  SELECT * INTO v_attempt
  FROM public.bank_statement_import_attempts WHERE id = v_staging.attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_TRIGGER_ATTEMPT: attempt row required (fail-closed)';
  END IF;
  IF v_attempt.status NOT IN ('ingestion_ready', 'needs_review', 'conflict') THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_TRIGGER_GATE: attempt status forbids promotion (fail-closed)';
  END IF;
  IF NOT v_attempt.success
     OR v_attempt.import_id IS NULL
     OR v_attempt.account_fingerprint IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_TRIGGER_GATE: attempt gates not satisfied (fail-closed)';
  END IF;
  IF v_staging.import_id <> NEW.import_id THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_TRIGGER_IMPORT_ID: staging/canonical import_id mismatch (fail-closed)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_canonical_anti_promote
  BEFORE INSERT ON public.bank_statement_canonical
  FOR EACH ROW EXECUTE FUNCTION public.structured_csv_assert_canonical_insert_allowed();

-- ============================================================================
-- SECTION 4 — RPC EXPOSÉES (SECURITY DEFINER, rôle vérifié en interne)
-- ============================================================================

-- 4.1 pre_ingest_structured_bank_statement — décision CTO 9.
--     UNIQUE write path du dépôt : attempt (+ staging + lignes si parsé OK)
--     + events, en une transaction. Rôles : admin, manager (dépôt).
--     p_requested_status :
--       'rejected' / 'failed'      -> attempt + event seulement (R6) ;
--       'ingestion_ready'          -> parser 'valid', gates complètes ;
--       'needs_review'             -> parser 'needs_review', opt-in staging (R5).
--     R1/R2 arbitrés ici sous verrou : duplicate (pas de staging),
--     conflict (staging quarantaine conservé pour supersede).
--     R3 (line_hash actif sous un autre import_id) -> route needs_review.
CREATE OR REPLACE FUNCTION public.pre_ingest_structured_bank_statement(
  p_requested_status         text,
  p_source_format            text,
  p_bank                     text,
  p_source_file_name_redacted text DEFAULT NULL,
  p_account_fingerprint      text DEFAULT NULL,
  p_account_number_masked    text DEFAULT NULL,
  p_raw_text_hash            text DEFAULT NULL,
  p_import_id                text DEFAULT NULL,
  p_parser_validation_status text DEFAULT NULL,
  p_rejected_reason          text DEFAULT NULL,
  p_errors_count             integer DEFAULT 0,
  p_warnings_count           integer DEFAULT 0,
  p_runtime_version          text DEFAULT NULL,
  p_parser_version           text DEFAULT NULL,
  p_statement                jsonb DEFAULT NULL,
  p_lines                    jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor          uuid;
  v_attempt_id     uuid;
  v_staging_id     uuid;
  v_active         public.bank_statement_canonical%ROWTYPE;
  v_final_status   text;
  v_ingestion_ready boolean := false;
  v_line           jsonb;
  v_line_hashes    text[] := '{}';
  v_line_count     integer;
  v_r3_overlap     boolean := false;
  v_stmt_allowed   constant text[] := ARRAY[
    'currency', 'period_start_date', 'period_end_date', 'statement_date',
    'opening_balance', 'total_debits', 'total_credits', 'closing_balance',
    'calculated_closing', 'discrepancy', 'line_count'
  ];
  v_line_allowed   constant text[] := ARRAY[
    'source_line_index', 'transaction_date', 'value_date',
    'description_sanitized', 'debit_amount', 'credit_amount', 'signed_amount',
    'running_balance', 'direction', 'currency', 'line_hash'
  ];
BEGIN
  -- Rôle : admin ou manager (décision CTO 3 — dépôt).
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT (public.has_role(v_actor, 'admin'::public.app_role)
          OR public.has_role(v_actor, 'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ROLE_DENIED: admin or manager role required (fail-closed)';
  END IF;

  IF p_requested_status IS NULL
     OR p_requested_status NOT IN ('rejected', 'failed', 'ingestion_ready', 'needs_review') THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_REQUESTED_STATUS: unsupported requested status (fail-closed)';
  END IF;
  IF p_source_format IS NULL OR length(btrim(p_source_format)) = 0
     OR p_bank IS NULL OR length(btrim(p_bank)) = 0 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_SOURCE_REQUIRED: source_format and bank required (fail-closed)';
  END IF;
  IF p_parser_validation_status IS NOT NULL
     AND p_parser_validation_status NOT IN ('valid', 'needs_review', 'invalid', 'unsupported') THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_PARSER_STATUS: unsupported parser status (fail-closed)';
  END IF;

  -- ------------------------------------------------------------------
  -- Branche 1 : rejet / échec technique (R4/R6) — attempt + events only.
  -- ------------------------------------------------------------------
  IF p_requested_status IN ('rejected', 'failed') THEN
    PERFORM public.structured_csv_assert_safe_reason(p_rejected_reason);
    IF p_statement IS NOT NULL OR p_lines IS NOT NULL THEN
      RAISE EXCEPTION 'STRUCTURED_CSV_REJECT_NO_PAYLOAD: rejected/failed deposits must not carry statement payload (fail-closed)';
    END IF;

    INSERT INTO public.bank_statement_import_attempts (
      created_by, source_format, source_file_name_redacted, bank,
      account_fingerprint, account_number_masked, raw_text_hash, import_id,
      parser_validation_status, success, ingestion_ready, rejected_reason,
      errors_count, warnings_count, status, runtime_version, parser_version
    ) VALUES (
      v_actor, p_source_format, p_source_file_name_redacted, p_bank,
      p_account_fingerprint, p_account_number_masked, p_raw_text_hash, p_import_id,
      p_parser_validation_status, false, false, p_rejected_reason,
      p_errors_count, p_warnings_count, p_requested_status,
      p_runtime_version, p_parser_version
    )
    RETURNING id INTO v_attempt_id;

    PERFORM public.structured_csv_append_audit_event(
      v_actor, v_attempt_id, NULL, NULL, p_import_id, p_raw_text_hash,
      'attempt_received', NULL, p_requested_status,
      'structured CSV deposit received', NULL
    );
    PERFORM public.structured_csv_append_audit_event(
      v_actor, v_attempt_id, NULL, NULL, p_import_id, p_raw_text_hash,
      CASE WHEN p_requested_status = 'rejected' THEN 'attempt_rejected' ELSE 'attempt_failed' END,
      NULL, p_requested_status,
      'structured CSV deposit closed before staging',
      jsonb_build_object(
        'reason_code', p_rejected_reason,
        'errors_count', p_errors_count,
        'warnings_count', p_warnings_count
      )
    );

    RETURN jsonb_build_object(
      'attempt_id', v_attempt_id,
      'final_status', p_requested_status,
      'staging_statement_id', NULL
    );
  END IF;

  -- ------------------------------------------------------------------
  -- Branche 2 : dépôt parsé (ingestion_ready / needs_review) — staging.
  -- ------------------------------------------------------------------
  IF p_rejected_reason IS NOT NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_REASON_FORBIDDEN: staged deposit cannot carry rejected_reason (fail-closed)';
  END IF;
  -- R4 : fingerprint obligatoire, fail-closed, jamais de fallback.
  IF p_account_fingerprint IS NULL OR length(btrim(p_account_fingerprint)) = 0 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_R4_FINGERPRINT: account_fingerprint required (fail-closed)';
  END IF;
  IF p_raw_text_hash IS NULL OR length(btrim(p_raw_text_hash)) = 0
     OR p_import_id IS NULL OR length(btrim(p_import_id)) = 0 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_IDENTITY_REQUIRED: raw_text_hash and import_id required (fail-closed)';
  END IF;
  IF p_requested_status = 'ingestion_ready' AND p_parser_validation_status IS DISTINCT FROM 'valid' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_GATE_VALID: ingestion_ready requires parser status valid (fail-closed)';
  END IF;
  IF p_requested_status = 'needs_review' AND p_parser_validation_status IS DISTINCT FROM 'needs_review' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_GATE_REVIEW: needs_review requires parser status needs_review (fail-closed)';
  END IF;
  IF p_statement IS NULL OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_PAYLOAD_REQUIRED: statement object and lines array required (fail-closed)';
  END IF;
  PERFORM public.structured_csv_assert_object_keys(p_statement, v_stmt_allowed);

  v_line_count := (p_statement ->> 'line_count')::integer;
  IF v_line_count IS NULL OR v_line_count <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_LINE_COUNT: declared line_count must match lines array (fail-closed)';
  END IF;
  IF (p_statement ->> 'currency') IS NULL OR length(btrim(p_statement ->> 'currency')) = 0 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_CURRENCY_REQUIRED (fail-closed)';
  END IF;
  -- Agrégats obligatoires, vérifiés AVANT toute écriture (message explicite).
  IF (p_statement ->> 'opening_balance') IS NULL
     OR (p_statement ->> 'total_debits') IS NULL
     OR (p_statement ->> 'total_credits') IS NULL
     OR (p_statement ->> 'closing_balance') IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_BALANCES_REQUIRED (fail-closed)';
  END IF;

  -- Pré-validation des lignes (clés whitelistées + hash présent) et collecte
  -- des line_hash pour la gate R3.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    PERFORM public.structured_csv_assert_object_keys(v_line, v_line_allowed);
    IF (v_line ->> 'line_hash') IS NULL OR length(btrim(v_line ->> 'line_hash')) = 0 THEN
      RAISE EXCEPTION 'STRUCTURED_CSV_LINE_HASH_REQUIRED (fail-closed)';
    END IF;
    v_line_hashes := v_line_hashes || (v_line ->> 'line_hash');
  END LOOP;

  -- Verrou décisionnel par relevé logique (draft 7.9).
  PERFORM public.structured_csv_acquire_import_lock(p_import_id);

  -- R1/R2 : comparaison au canonical ACTIF du même import_id.
  SELECT * INTO v_active
  FROM public.bank_statement_canonical
  WHERE import_id = p_import_id AND status = 'ingested';

  IF FOUND AND v_active.active_raw_text_hash = p_raw_text_hash THEN
    v_final_status := 'duplicate';               -- R1 : contenu identique.
  ELSIF FOUND THEN
    v_final_status := 'conflict';                -- R2 : contenu différent.
  ELSE
    -- R3 : un line_hash encore ACTIF sous un AUTRE import_id => needs_review.
    SELECT EXISTS (
      SELECT 1 FROM public.bank_statement_lines_canonical lc
      WHERE lc.is_active
        AND lc.import_id <> p_import_id
        AND lc.line_hash = ANY (v_line_hashes)
    ) INTO v_r3_overlap;
    IF v_r3_overlap THEN
      v_final_status := 'needs_review';
      v_ingestion_ready := false;
    ELSE
      v_final_status := p_requested_status;
      v_ingestion_ready := (p_requested_status = 'ingestion_ready');
    END IF;
  END IF;

  INSERT INTO public.bank_statement_import_attempts (
    created_by, source_format, source_file_name_redacted, bank,
    account_fingerprint, account_number_masked, raw_text_hash, import_id,
    parser_validation_status, success, ingestion_ready, rejected_reason,
    errors_count, warnings_count, status, runtime_version, parser_version
  ) VALUES (
    v_actor, p_source_format, p_source_file_name_redacted, p_bank,
    p_account_fingerprint, p_account_number_masked, p_raw_text_hash, p_import_id,
    p_parser_validation_status, true, v_ingestion_ready, NULL,
    p_errors_count, p_warnings_count, v_final_status,
    p_runtime_version, p_parser_version
  )
  RETURNING id INTO v_attempt_id;

  PERFORM public.structured_csv_append_audit_event(
    v_actor, v_attempt_id, NULL, NULL, p_import_id, p_raw_text_hash,
    'attempt_received', NULL, v_final_status,
    'structured CSV deposit received', NULL
  );

  -- R1 duplicate : attempt + event seulement, AUCUN staging.
  IF v_final_status = 'duplicate' THEN
    PERFORM public.structured_csv_append_audit_event(
      v_actor, v_attempt_id, NULL, v_active.id, p_import_id, p_raw_text_hash,
      'duplicate_detected', NULL, 'duplicate',
      'exact duplicate of active canonical statement', NULL
    );
    RETURN jsonb_build_object(
      'attempt_id', v_attempt_id,
      'final_status', 'duplicate',
      'staging_statement_id', NULL,
      'active_canonical_statement_id', v_active.id
    );
  END IF;

  -- Staging (quarantaine) : créé pour conflict / ingestion_ready / needs_review.
  INSERT INTO public.bank_statement_staging (
    attempt_id, import_id, raw_text_hash, bank, account_fingerprint,
    account_number_masked, currency, period_start_date, period_end_date,
    statement_date, opening_balance, total_debits, total_credits,
    closing_balance, validation_status, calculated_closing, discrepancy,
    line_count, status, created_by
  ) VALUES (
    v_attempt_id, p_import_id, p_raw_text_hash, p_bank, p_account_fingerprint,
    p_account_number_masked, p_statement ->> 'currency',
    public.structured_csv_parse_date_strict(p_statement ->> 'period_start_date'),
    public.structured_csv_parse_date_strict(p_statement ->> 'period_end_date'),
    CASE WHEN p_statement ->> 'statement_date' IS NULL THEN NULL
         ELSE public.structured_csv_parse_date_strict(p_statement ->> 'statement_date') END,
    public.structured_csv_parse_amount_strict(p_statement ->> 'opening_balance'),
    public.structured_csv_parse_amount_strict(p_statement ->> 'total_debits'),
    public.structured_csv_parse_amount_strict(p_statement ->> 'total_credits'),
    public.structured_csv_parse_amount_strict(p_statement ->> 'closing_balance'),
    p_parser_validation_status,
    public.structured_csv_parse_amount_strict(p_statement ->> 'calculated_closing'),
    public.structured_csv_parse_amount_strict(p_statement ->> 'discrepancy'),
    v_line_count, 'not_promoted', v_actor
  )
  RETURNING id INTO v_staging_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.bank_statement_lines_staging (
      staging_statement_id, attempt_id, import_id, line_hash,
      source_line_index, transaction_date, value_date, description_sanitized,
      debit_amount, credit_amount, signed_amount, running_balance,
      direction, currency, status
    ) VALUES (
      v_staging_id, v_attempt_id, p_import_id, v_line ->> 'line_hash',
      (v_line ->> 'source_line_index')::integer,
      public.structured_csv_parse_date_strict(v_line ->> 'transaction_date'),
      CASE WHEN v_line ->> 'value_date' IS NULL THEN NULL
           ELSE public.structured_csv_parse_date_strict(v_line ->> 'value_date') END,
      v_line ->> 'description_sanitized',
      public.structured_csv_parse_amount_strict(v_line ->> 'debit_amount'),
      public.structured_csv_parse_amount_strict(v_line ->> 'credit_amount'),
      public.structured_csv_parse_amount_strict(v_line ->> 'signed_amount'),
      public.structured_csv_parse_amount_strict(v_line ->> 'running_balance'),
      v_line ->> 'direction', v_line ->> 'currency', 'not_promoted'
    );
  END LOOP;

  PERFORM public.structured_csv_append_audit_event(
    v_actor, v_attempt_id, v_staging_id, NULL, p_import_id, p_raw_text_hash,
    'pre_ingested', NULL, v_final_status,
    'structured CSV statement staged',
    jsonb_build_object('line_count', v_line_count,
                       'errors_count', p_errors_count,
                       'warnings_count', p_warnings_count)
  );

  IF v_final_status = 'conflict' THEN
    PERFORM public.structured_csv_append_audit_event(
      v_actor, v_attempt_id, v_staging_id, v_active.id, p_import_id, p_raw_text_hash,
      'conflict_detected', NULL, 'conflict',
      'same import_id with different raw_text_hash than active canonical', NULL
    );
  ELSIF v_final_status = 'needs_review' AND v_r3_overlap THEN
    PERFORM public.structured_csv_append_audit_event(
      v_actor, v_attempt_id, v_staging_id, NULL, p_import_id, p_raw_text_hash,
      'marked_needs_review', NULL, 'needs_review',
      'active line_hash overlap with another import_id (R3)',
      jsonb_build_object('reason_code', 'line_hash_scope_conflict')
    );
  ELSIF v_final_status = 'needs_review' THEN
    PERFORM public.structured_csv_append_audit_event(
      v_actor, v_attempt_id, v_staging_id, NULL, p_import_id, p_raw_text_hash,
      'marked_needs_review', NULL, 'needs_review',
      'parser flagged statement for human review', NULL
    );
  ELSE
    PERFORM public.structured_csv_append_audit_event(
      v_actor, v_attempt_id, v_staging_id, NULL, p_import_id, p_raw_text_hash,
      'marked_ingestion_ready', NULL, 'ingestion_ready',
      'all pre-ingestion gates passed', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'final_status', v_final_status,
    'staging_statement_id', v_staging_id
  );
END;
$$;

-- 4.2 promote_structured_bank_statement_import (draft 7.1) — admin seul.
--     R1/R2/R3 re-vérifiés sous verrou (état re-lu après acquisition).
CREATE OR REPLACE FUNCTION public.promote_structured_bank_statement_import(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid;
  v_attempt public.bank_statement_import_attempts%ROWTYPE;
  v_staging public.bank_statement_staging%ROWTYPE;
  v_active  public.bank_statement_canonical%ROWTYPE;
  v_new_id  uuid;
  v_overlap boolean;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ROLE_DENIED: admin role required (fail-closed)';
  END IF;

  SELECT * INTO v_staging
  FROM public.bank_statement_staging WHERE attempt_id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_STAGING_NOT_FOUND (fail-closed)';
  END IF;

  PERFORM public.structured_csv_acquire_import_lock(v_staging.import_id);

  -- Re-lecture APRÈS verrou : l'état pré-verrou peut être périmé.
  SELECT * INTO v_attempt
  FROM public.bank_statement_import_attempts WHERE id = p_attempt_id;
  SELECT * INTO v_staging
  FROM public.bank_statement_staging WHERE attempt_id = p_attempt_id;

  IF v_attempt.status <> 'ingestion_ready' OR NOT v_attempt.ingestion_ready THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_PROMOTE_GATE: attempt is not ingestion_ready (needs_review path = RPC approve, fail-closed)';
  END IF;
  IF v_staging.status <> 'not_promoted' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_PROMOTE_STAGING_STATE (fail-closed)';
  END IF;

  -- R1/R2 sous verrou.
  SELECT * INTO v_active
  FROM public.bank_statement_canonical
  WHERE import_id = v_staging.import_id AND status = 'ingested';

  IF FOUND AND v_active.active_raw_text_hash = v_staging.raw_text_hash THEN
    UPDATE public.bank_statement_import_attempts
      SET status = 'duplicate' WHERE id = p_attempt_id;
    UPDATE public.bank_statement_staging
      SET status = 'promotion_failed' WHERE id = v_staging.id;
    PERFORM public.structured_csv_append_audit_event(
      v_actor, p_attempt_id, v_staging.id, v_active.id,
      v_staging.import_id, v_staging.raw_text_hash,
      'duplicate_detected', 'ingestion_ready', 'duplicate',
      'promotion aborted: exact duplicate of active canonical', NULL
    );
    RETURN jsonb_build_object('outcome', 'duplicate',
                              'active_canonical_statement_id', v_active.id);
  ELSIF FOUND THEN
    UPDATE public.bank_statement_import_attempts
      SET status = 'conflict' WHERE id = p_attempt_id;
    PERFORM public.structured_csv_append_audit_event(
      v_actor, p_attempt_id, v_staging.id, v_active.id,
      v_staging.import_id, v_staging.raw_text_hash,
      'conflict_detected', 'ingestion_ready', 'conflict',
      'promotion aborted: active canonical holds different content', NULL
    );
    RETURN jsonb_build_object('outcome', 'conflict',
                              'active_canonical_statement_id', v_active.id);
  END IF;

  -- R3 sous verrou : chevauchement de line_hash actifs d'un autre import_id.
  SELECT EXISTS (
    SELECT 1
    FROM public.bank_statement_lines_staging ls
    JOIN public.bank_statement_lines_canonical lc
      ON lc.line_hash = ls.line_hash AND lc.is_active
    WHERE ls.staging_statement_id = v_staging.id
      AND lc.import_id <> v_staging.import_id
  ) INTO v_overlap;
  IF v_overlap THEN
    UPDATE public.bank_statement_import_attempts
      SET status = 'needs_review', ingestion_ready = false
      WHERE id = p_attempt_id;
    PERFORM public.structured_csv_append_audit_event(
      v_actor, p_attempt_id, v_staging.id, NULL,
      v_staging.import_id, v_staging.raw_text_hash,
      'marked_needs_review', 'ingestion_ready', 'needs_review',
      'promotion aborted: active line_hash overlap with another import_id (R3)',
      jsonb_build_object('reason_code', 'line_hash_scope_conflict')
    );
    RETURN jsonb_build_object('outcome', 'needs_review');
  END IF;

  v_new_id := gen_random_uuid();
  PERFORM public.structured_csv_promote_staging_core(
    p_attempt_id, v_staging.id, v_new_id, v_actor);

  RETURN jsonb_build_object('outcome', 'promoted',
                            'canonical_statement_id', v_new_id);
END;
$$;

-- 4.3 approve_structured_bank_statement_needs_review_promotion (draft 7.6).
--     ADMIN SEUL (décision CTO 2). Seule exception à la gate ingestion_ready.
--     R3 persistant => exception (l'index partiel actif bloquerait de toute
--     façon : résoudre l'autre relevé d'abord).
CREATE OR REPLACE FUNCTION public.approve_structured_bank_statement_needs_review_promotion(
  p_attempt_id uuid,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid;
  v_attempt public.bank_statement_import_attempts%ROWTYPE;
  v_staging public.bank_statement_staging%ROWTYPE;
  v_active  public.bank_statement_canonical%ROWTYPE;
  v_new_id  uuid;
  v_overlap boolean;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ROLE_DENIED: admin role required for needs_review promotion (fail-closed)';
  END IF;
  PERFORM public.structured_csv_assert_safe_reason(p_reason);

  SELECT * INTO v_staging
  FROM public.bank_statement_staging WHERE attempt_id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_STAGING_NOT_FOUND (fail-closed)';
  END IF;

  PERFORM public.structured_csv_acquire_import_lock(v_staging.import_id);

  SELECT * INTO v_attempt
  FROM public.bank_statement_import_attempts WHERE id = p_attempt_id;
  SELECT * INTO v_staging
  FROM public.bank_statement_staging WHERE attempt_id = p_attempt_id;

  IF v_attempt.status <> 'needs_review' OR NOT v_attempt.success THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_APPROVE_GATE: attempt is not needs_review (fail-closed)';
  END IF;
  IF v_staging.status <> 'not_promoted' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_APPROVE_STAGING_STATE (fail-closed)';
  END IF;

  PERFORM public.structured_csv_append_audit_event(
    v_actor, p_attempt_id, v_staging.id, NULL,
    v_staging.import_id, v_staging.raw_text_hash,
    'promotion_requested', 'needs_review', NULL,
    p_reason, NULL
  );

  SELECT * INTO v_active
  FROM public.bank_statement_canonical
  WHERE import_id = v_staging.import_id AND status = 'ingested';

  IF FOUND AND v_active.active_raw_text_hash = v_staging.raw_text_hash THEN
    UPDATE public.bank_statement_import_attempts
      SET status = 'duplicate' WHERE id = p_attempt_id;
    UPDATE public.bank_statement_staging
      SET status = 'promotion_failed' WHERE id = v_staging.id;
    PERFORM public.structured_csv_append_audit_event(
      v_actor, p_attempt_id, v_staging.id, v_active.id,
      v_staging.import_id, v_staging.raw_text_hash,
      'duplicate_detected', 'needs_review', 'duplicate',
      'approval aborted: exact duplicate of active canonical', NULL
    );
    RETURN jsonb_build_object('outcome', 'duplicate',
                              'active_canonical_statement_id', v_active.id);
  ELSIF FOUND THEN
    UPDATE public.bank_statement_import_attempts
      SET status = 'conflict' WHERE id = p_attempt_id;
    PERFORM public.structured_csv_append_audit_event(
      v_actor, p_attempt_id, v_staging.id, v_active.id,
      v_staging.import_id, v_staging.raw_text_hash,
      'conflict_detected', 'needs_review', 'conflict',
      'approval aborted: active canonical holds different content', NULL
    );
    RETURN jsonb_build_object('outcome', 'conflict',
                              'active_canonical_statement_id', v_active.id);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.bank_statement_lines_staging ls
    JOIN public.bank_statement_lines_canonical lc
      ON lc.line_hash = ls.line_hash AND lc.is_active
    WHERE ls.staging_statement_id = v_staging.id
      AND lc.import_id <> v_staging.import_id
  ) INTO v_overlap;
  IF v_overlap THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_R3_ACTIVE_OVERLAP: resolve the other active statement first (fail-closed)';
  END IF;

  v_new_id := gen_random_uuid();
  PERFORM public.structured_csv_promote_staging_core(
    p_attempt_id, v_staging.id, v_new_id, v_actor);

  RETURN jsonb_build_object('outcome', 'promoted',
                            'canonical_statement_id', v_new_id);
END;
$$;

-- 4.4 reject_structured_bank_statement_import (draft 7.2) — admin seul.
--     Clôture humaine d'une tentative non terminale (hors conflict : 7.5/7.7).
CREATE OR REPLACE FUNCTION public.reject_structured_bank_statement_import(
  p_attempt_id uuid,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid;
  v_attempt public.bank_statement_import_attempts%ROWTYPE;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ROLE_DENIED: admin role required (fail-closed)';
  END IF;
  PERFORM public.structured_csv_assert_safe_reason(p_reason);

  SELECT * INTO v_attempt
  FROM public.bank_statement_import_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ATTEMPT_NOT_FOUND (fail-closed)';
  END IF;
  -- Sérialisation avec promote/approve/supersede du même relevé logique
  -- (draft 7.9) : verrou puis RE-LECTURE avant décision.
  IF v_attempt.import_id IS NOT NULL THEN
    PERFORM public.structured_csv_acquire_import_lock(v_attempt.import_id);
  END IF;
  SELECT * INTO v_attempt
  FROM public.bank_statement_import_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.status NOT IN ('received', 'pre_ingested', 'ingestion_ready', 'needs_review') THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_REJECT_STATE: attempt not rejectable from its current status (fail-closed)';
  END IF;

  UPDATE public.bank_statement_import_attempts
    SET status = 'rejected', rejected_reason = p_reason
    WHERE id = p_attempt_id;
  UPDATE public.bank_statement_staging
    SET status = 'promotion_failed'
    WHERE attempt_id = p_attempt_id AND status = 'not_promoted';

  PERFORM public.structured_csv_append_audit_event(
    v_actor, p_attempt_id, NULL, NULL, v_attempt.import_id, v_attempt.raw_text_hash,
    'attempt_rejected', v_attempt.status, 'rejected',
    p_reason, jsonb_build_object('resolution', 'human_reject')
  );

  RETURN jsonb_build_object('attempt_id', p_attempt_id, 'final_status', 'rejected');
END;
$$;

-- 4.5 resolve_structured_bank_statement_conflict_keep_existing (draft 7.4).
--     Admin seul : arbitrage humain R2, le canonical existant est conservé.
CREATE OR REPLACE FUNCTION public.resolve_structured_bank_statement_conflict_keep_existing(
  p_attempt_id uuid,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid;
  v_attempt public.bank_statement_import_attempts%ROWTYPE;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ROLE_DENIED: admin role required (fail-closed)';
  END IF;
  PERFORM public.structured_csv_assert_safe_reason(p_reason);

  SELECT * INTO v_attempt
  FROM public.bank_statement_import_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ATTEMPT_NOT_FOUND (fail-closed)';
  END IF;
  -- Sérialisation avec supersede du même relevé logique (draft 7.9).
  IF v_attempt.import_id IS NOT NULL THEN
    PERFORM public.structured_csv_acquire_import_lock(v_attempt.import_id);
  END IF;
  SELECT * INTO v_attempt
  FROM public.bank_statement_import_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.status <> 'conflict' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_KEEP_EXISTING_STATE: attempt is not in conflict (fail-closed)';
  END IF;

  UPDATE public.bank_statement_import_attempts
    SET status = 'rejected', rejected_reason = p_reason
    WHERE id = p_attempt_id;
  UPDATE public.bank_statement_staging
    SET status = 'promotion_failed'
    WHERE attempt_id = p_attempt_id AND status = 'not_promoted';

  PERFORM public.structured_csv_append_audit_event(
    v_actor, p_attempt_id, NULL, NULL, v_attempt.import_id, v_attempt.raw_text_hash,
    'status_changed', 'conflict', 'rejected',
    p_reason, jsonb_build_object('resolution', 'keep_existing')
  );

  RETURN jsonb_build_object('attempt_id', p_attempt_id, 'final_status', 'rejected',
                            'resolution', 'keep_existing');
END;
$$;

-- 4.6 request_structured_bank_statement_manager_escalation (draft 7.5).
--     Manager (ou admin) : demande de review — event uniquement, aucun
--     changement d'état (décision CTO 3 : seule action manager post-dépôt).
CREATE OR REPLACE FUNCTION public.request_structured_bank_statement_manager_escalation(
  p_attempt_id uuid,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid;
  v_attempt public.bank_statement_import_attempts%ROWTYPE;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT (public.has_role(v_actor, 'admin'::public.app_role)
          OR public.has_role(v_actor, 'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ROLE_DENIED: admin or manager role required (fail-closed)';
  END IF;
  PERFORM public.structured_csv_assert_safe_reason(p_reason);

  SELECT * INTO v_attempt
  FROM public.bank_statement_import_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ATTEMPT_NOT_FOUND (fail-closed)';
  END IF;
  IF v_attempt.status IN ('ingested', 'superseded') THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ESCALATION_STATE: attempt already terminal (fail-closed)';
  END IF;

  PERFORM public.structured_csv_append_audit_event(
    v_actor, p_attempt_id, NULL, NULL, v_attempt.import_id, v_attempt.raw_text_hash,
    'review_requested', v_attempt.status, v_attempt.status,
    p_reason, NULL
  );

  RETURN jsonb_build_object('attempt_id', p_attempt_id,
                            'status', v_attempt.status,
                            'escalated', true);
END;
$$;

-- 4.7 supersede_structured_bank_statement_import (draft 7.7, séquence a-i).
--     Admin seul. Remplace le canonical actif par le staging d'un attempt en
--     conflict (même import_id). FK superseded_by différée : l'ancien pointe
--     vers le nouvel id AVANT son insertion.
CREATE OR REPLACE FUNCTION public.supersede_structured_bank_statement_import(
  p_old_canonical_statement_id uuid,
  p_new_attempt_id             uuid,
  p_reason                     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor        uuid;
  v_new_attempt  public.bank_statement_import_attempts%ROWTYPE;
  v_new_staging  public.bank_statement_staging%ROWTYPE;
  v_old          public.bank_statement_canonical%ROWTYPE;
  v_old_attempt_id uuid;
  v_new_id       uuid;
  v_overlap      boolean;
  v_active_count integer;
  v_old_active_lines integer;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_ROLE_DENIED: admin role required (fail-closed)';
  END IF;
  PERFORM public.structured_csv_assert_safe_reason(p_reason);

  SELECT * INTO v_new_staging
  FROM public.bank_statement_staging WHERE attempt_id = p_new_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_STAGING_NOT_FOUND (fail-closed)';
  END IF;

  -- b. Verrou import_id, puis re-lecture de tout l'état décisionnel.
  PERFORM public.structured_csv_acquire_import_lock(v_new_staging.import_id);

  SELECT * INTO v_new_attempt
  FROM public.bank_statement_import_attempts WHERE id = p_new_attempt_id;
  SELECT * INTO v_new_staging
  FROM public.bank_statement_staging WHERE attempt_id = p_new_attempt_id;

  IF v_new_attempt.status <> 'conflict' OR NOT v_new_attempt.success THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_SUPERSEDE_GATE: new attempt must be a parsed conflict (fail-closed)';
  END IF;
  IF v_new_staging.status <> 'not_promoted' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_SUPERSEDE_STAGING_STATE (fail-closed)';
  END IF;

  -- c. Re-lecture du canonical visé SOUS VERROU LIGNE.
  SELECT * INTO v_old
  FROM public.bank_statement_canonical
  WHERE id = p_old_canonical_statement_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_OLD_CANONICAL_NOT_FOUND (fail-closed)';
  END IF;
  IF v_old.status <> 'ingested' THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_STALE_CANONICAL: target is no longer the active canonical (fail-closed)';
  END IF;
  IF v_old.import_id <> v_new_staging.import_id THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_SUPERSEDE_IMPORT_MISMATCH: not the same logical statement (fail-closed)';
  END IF;

  -- R1 : contenu identique => supersede sans objet, duplicate contrôlé.
  IF v_new_staging.raw_text_hash = v_old.active_raw_text_hash THEN
    UPDATE public.bank_statement_import_attempts
      SET status = 'duplicate' WHERE id = p_new_attempt_id;
    UPDATE public.bank_statement_staging
      SET status = 'promotion_failed' WHERE id = v_new_staging.id;
    PERFORM public.structured_csv_append_audit_event(
      v_actor, p_new_attempt_id, v_new_staging.id, v_old.id,
      v_new_staging.import_id, v_new_staging.raw_text_hash,
      'duplicate_detected', 'conflict', 'duplicate',
      'supersede aborted: identical content to active canonical', NULL
    );
    RETURN jsonb_build_object('outcome', 'duplicate',
                              'active_canonical_statement_id', v_old.id);
  END IF;

  -- R3 : chevauchement actif avec un AUTRE import_id => résolution préalable.
  SELECT EXISTS (
    SELECT 1
    FROM public.bank_statement_lines_staging ls
    JOIN public.bank_statement_lines_canonical lc
      ON lc.line_hash = ls.line_hash AND lc.is_active
    WHERE ls.staging_statement_id = v_new_staging.id
      AND lc.import_id <> v_new_staging.import_id
  ) INTO v_overlap;
  IF v_overlap THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_R3_ACTIVE_OVERLAP: resolve the other active statement first (fail-closed)';
  END IF;

  -- e. Pré-génération de l'id du nouveau canonical.
  v_new_id := gen_random_uuid();

  -- f. Bascule de l'ancien (FK superseded_by différée jusqu'au COMMIT).
  UPDATE public.bank_statement_canonical
    SET status = 'superseded', superseded_by = v_new_id, superseded_at = now()
    WHERE id = v_old.id;

  -- Option A : désactivation des lignes de l'ancien AVANT insertion des
  -- nouvelles (l'index partiel actif interdirait les line_hash communs).
  UPDATE public.bank_statement_lines_canonical
    SET is_active = false
    WHERE canonical_statement_id = v_old.id AND is_active;

  -- Traçabilité de l'ancien pipeline : staging + attempt d'origine.
  SELECT attempt_id INTO v_old_attempt_id
  FROM public.bank_statement_staging WHERE id = v_old.promoted_from_staging_id;
  UPDATE public.bank_statement_staging
    SET status = 'superseded'
    WHERE id = v_old.promoted_from_staging_id AND status = 'promoted';
  UPDATE public.bank_statement_import_attempts
    SET status = 'superseded'
    WHERE id = v_old_attempt_id AND status = 'ingested';

  PERFORM public.structured_csv_append_audit_event(
    v_actor, v_old_attempt_id, v_old.promoted_from_staging_id, v_old.id,
    v_old.import_id, v_old.active_raw_text_hash,
    'superseded', 'ingested', 'superseded',
    p_reason, jsonb_build_object('resolution', 'superseded')
  );

  -- g./h. Promotion du nouveau contenu (canonical + lignes actives + event).
  PERFORM public.structured_csv_promote_staging_core(
    p_new_attempt_id, v_new_staging.id, v_new_id, v_actor);

  -- i. Postconditions (toute violation => exception => ROLLBACK TOTAL).
  SELECT count(*) INTO v_active_count
  FROM public.bank_statement_canonical
  WHERE import_id = v_new_staging.import_id AND status = 'ingested';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_SUPERSEDE_POSTCONDITION: active canonical count <> 1 (rollback)';
  END IF;
  SELECT count(*) INTO v_old_active_lines
  FROM public.bank_statement_lines_canonical
  WHERE canonical_statement_id = v_old.id AND is_active;
  IF v_old_active_lines <> 0 THEN
    RAISE EXCEPTION 'STRUCTURED_CSV_SUPERSEDE_POSTCONDITION: superseded lines still active (rollback)';
  END IF;

  RETURN jsonb_build_object('outcome', 'superseded',
                            'old_canonical_statement_id', v_old.id,
                            'new_canonical_statement_id', v_new_id);
END;
$$;

-- ============================================================================
-- SECTION 5 — RLS (lecture seule par rôle ; écritures = RPC uniquement)
-- ============================================================================

ALTER TABLE public.bank_statement_import_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_staging         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines_staging   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_canonical       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines_canonical ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_import_events   ENABLE ROW LEVEL SECURITY;

-- Aucune policy INSERT/UPDATE/DELETE sur aucune table (décision CTO 7) :
-- défaut RLS = deny ; les RPC SECURITY DEFINER (owner) ne sont pas soumises.
-- Rôle user : aucune policy => aucun accès (décision CTO 4).

CREATE POLICY "bank_statement_import_attempts_select"
  ON public.bank_statement_import_attempts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "bank_statement_staging_select"
  ON public.bank_statement_staging
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- Lignes staging : libellés sensibles => admin seul.
CREATE POLICY "bank_statement_lines_staging_select"
  ON public.bank_statement_lines_staging
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "bank_statement_canonical_select"
  ON public.bank_statement_canonical
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "bank_statement_lines_canonical_select"
  ON public.bank_statement_lines_canonical
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "bank_statement_import_events_select"
  ON public.bank_statement_import_events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

-- ============================================================================
-- SECTION 6 — PRIVILÈGES TABLES (ceinture + bretelles, SEC-05)
-- ============================================================================
-- Les default privileges Supabase accordent large à anon/authenticated/
-- service_role à la création : on révoque tout puis on ré-accorde le minimum.
-- Les RPC SECURITY DEFINER (owner) ne dépendent pas de ces grants.

REVOKE ALL ON TABLE public.bank_statement_import_attempts  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bank_statement_staging          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bank_statement_lines_staging    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bank_statement_canonical        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bank_statement_lines_canonical  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bank_statement_import_events    FROM PUBLIC, anon, authenticated, service_role;

-- Lecture : authenticated (filtrée par RLS) + service_role (ops/debug ;
-- BYPASSRLS plateforme assumé et documenté).
GRANT SELECT ON TABLE public.bank_statement_import_attempts  TO authenticated, service_role;
GRANT SELECT ON TABLE public.bank_statement_staging          TO authenticated, service_role;
GRANT SELECT ON TABLE public.bank_statement_lines_staging    TO authenticated, service_role;
GRANT SELECT ON TABLE public.bank_statement_canonical        TO authenticated, service_role;
GRANT SELECT ON TABLE public.bank_statement_lines_canonical  TO authenticated, service_role;
GRANT SELECT ON TABLE public.bank_statement_import_events    TO authenticated, service_role;

-- ============================================================================
-- SECTION 7 — PRIVILÈGES FONCTIONS (décision CTO 8)
-- ============================================================================

-- 7.a Helpers internes : EXECUTE révoqué de TOUS les rôles applicatifs.
REVOKE ALL ON FUNCTION public.structured_csv_parse_date_strict(text)                    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.structured_csv_parse_amount_strict(text)                  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.structured_csv_assert_safe_details(jsonb)                 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.structured_csv_assert_safe_reason(text)                   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.structured_csv_assert_object_keys(jsonb, text[])          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.structured_csv_acquire_import_lock(text)                  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.structured_csv_append_audit_event(uuid, uuid, uuid, uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.structured_csv_promote_staging_core(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.structured_csv_assert_canonical_insert_allowed()          FROM PUBLIC, anon, authenticated, service_role;

-- 7.b RPC exposées : EXECUTE pour authenticated uniquement (le contrôle fin
--     est fait PAR RÔLE dans chaque fonction). service_role volontairement
--     NON accordé : l'identité d'exécution du futur runtime Node est un
--     arbitrage CTO séparé (0T, écart E-2) — fail-closed en attendant.
REVOKE ALL ON FUNCTION public.pre_ingest_structured_bank_statement(text, text, text, text, text, text, text, text, text, text, integer, integer, text, text, jsonb, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pre_ingest_structured_bank_statement(text, text, text, text, text, text, text, text, text, text, integer, integer, text, text, jsonb, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.promote_structured_bank_statement_import(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.promote_structured_bank_statement_import(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_structured_bank_statement_needs_review_promotion(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_structured_bank_statement_needs_review_promotion(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_structured_bank_statement_import(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reject_structured_bank_statement_import(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_structured_bank_statement_conflict_keep_existing(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_structured_bank_statement_conflict_keep_existing(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.request_structured_bank_statement_manager_escalation(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_structured_bank_statement_manager_escalation(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.supersede_structured_bank_statement_import(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.supersede_structured_bank_statement_import(uuid, uuid, text) TO authenticated;

-- ============================================================================
-- FIN — POC-BANK-STRUCTURED-EXPORTS-0U — MIGRATION CANDIDATE v1
-- ============================================================================
