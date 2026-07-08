-- ============================================================================
-- DAILY-RPC-V2-MIGRATION-DRAFT-0H — MIGRATION CANDIDATE v2 (NON APPLIQUÉE EN PROD)
-- ============================================================================
-- Modèle journalier : export attempt → N daily units (staging) → canonical
-- par journée + audit append-only. Twin SQL STRICT du contrat TypeScript 0G
-- (src/services/structuredBankStatementDailyRpcPayload.ts).
--
-- STATUT : CANDIDATE / DRAFT. Ne JAMAIS exécuter sur Supabase live sans :
--   1. verdict CTO explicite sur l'arbitrage v1-candidate vs v2-directe ;
--   2. tests read-only préalables (absence d'objets homonymes) ;
--   3. passage staging complet ;
--   4. GO CTO explicite (SECURITY_CONTRACT §9 et §12).
--
-- Doctrine CTO (0F/0G actée) :
--   1. Unité canonique = (bank, account_fingerprint, currency, accounting_date)
--      hashée dans day_unit_id v2, indépendante de la fenêtre d'export.
--   2. day_content_hash v2 = comparateur R1/R2 PAR JOURNÉE : SHA-256 de la
--      liste triée lexicalement des daily_line_hash, préimage identique au TS.
--   3. rawTextHash / sourceFileNameRedacted / export_period_* = traçabilité
--      seulement, jamais clé d'identité.
--   4. ORA : journée non close jamais promouvable (provisional fail-closed).
--   5. Backfill BIS = mode dédié, grant obligatoire, admin seul.
--   6. Écritures uniquement via RPC SECURITY DEFINER ; RLS lecture seule ;
--      service_role sans EXECUTE (doctrine E-2) ; audit append-only.
--
-- Décisions de draft (à confirmer CTO avant toute application) :
--   D-0H-1. day_unit_id RECALCULÉ côté SQL depuis le contexte attempt.
--           Préimages assemblées par concaténation de to_json(text)::text :
--           sortie compacte garantie (aucun espace) et échappement escape_json
--           byte-compatible JSON.stringify (", \, contrôles \n/\t/…, non-ASCII
--           littéral). Toute divergence bank/fingerprint/currency/date ↔
--           day_unit_id est donc rejetée. Ancres de parité TS figées dans la
--           suite de tests (11_validation_gates.sql).
--   D-0H-2. daily_line_hash NON recalculé côté SQL (la normalisation NFKC des
--           libellés n'existe pas en SQL stock) : l'unicité + le
--           day_content_hash recalculé restent les garde-fous serveur.
--   D-0H-3. Pas de table watermarks : aucune gate de ce draft ne la consomme
--           (la règle ORA s'appuie sur export_reference_date) — pas d'état
--           inutilisé dans une migration candidate.
--   D-0H-4. Une unité 'provisional' est enregistrée SANS arbitrage R1/R2/R3 :
--           ces règles protègent le chemin de promotion, qu'un provisional ne
--           peut jamais atteindre (trigger + gate RPC).
--   D-0H-5. Aucune branche « dépôt rejeté » : le contrat 0G ne dépose que des
--           payloads valides ; un payload invalide lève une exception et rien
--           ne persiste (fail-closed all-or-nothing).
--
-- Invariants données : no raw CSV, no raw bytes, no full account, no IBAN.
-- description_sanitized = libellé normalisé, PAS anonymisé : donnée sensible,
-- lecture RLS minimale (admin seul en staging).
--
-- NOTE transaction : pas de BEGIN/COMMIT explicite — le CLI supabase applique
-- chaque migration dans une transaction ; permet aussi le test de rollback
-- local (BEGIN; \i ...; ROLLBACK;).
-- ============================================================================

-- ============================================================================
-- SECTION 1 — TABLES (TEXT + CHECK, aucun enum — doctrine v1 CTO-5 conservée)
-- ============================================================================

-- 1.A  Tentatives d'export (une ligne par dépôt accepté ; immuable).
CREATE TABLE public.daily_statement_export_attempts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users (id),

  requested_mode            text NOT NULL,
  source_format             text NOT NULL,
  bank                      text NOT NULL,
  currency                  text NOT NULL,
  account_fingerprint       text NOT NULL,
  account_number_masked     text,
  source_file_name_redacted text,

  raw_text_hash             text NOT NULL,
  export_period_start       date NOT NULL,
  export_period_end         date NOT NULL,
  statement_date            date,
  export_reference_date     date,

  parser_validation_status  text NOT NULL,
  errors_count              integer NOT NULL DEFAULT 0 CHECK (errors_count >= 0),
  warnings_count            integer NOT NULL DEFAULT 0 CHECK (warnings_count >= 0),
  runtime_version           text,
  parser_version            text,

  ingestion_ready           boolean NOT NULL,
  bridge_guard_passed       boolean NOT NULL,
  period_days               integer NOT NULL CHECK (period_days >= 1),
  backfill_grant_reference  text,
  units_total               integer NOT NULL CHECK (units_total >= 1),

  CONSTRAINT attempts_v2_mode_domain
    CHECK (requested_mode IN ('daily', 'backfill')),
  CONSTRAINT attempts_v2_parser_status_domain
    CHECK (parser_validation_status IN ('valid', 'needs_review')),
  -- Masque strict (doctrine PR #77) : astérisques puis AU PLUS 4 chiffres.
  CONSTRAINT attempts_v2_masked_never_full_account
    CHECK (account_number_masked IS NULL OR account_number_masked ~ '^[*]+[0-9]{0,4}$'),
  CONSTRAINT attempts_v2_period_coherent
    CHECK (export_period_end >= export_period_start),
  -- Backfill : grant obligatoire ; daily : grant structurellement interdit.
  CONSTRAINT attempts_v2_backfill_grant
    CHECK ((requested_mode = 'daily'    AND backfill_grant_reference IS NULL)
        OR (requested_mode = 'backfill' AND backfill_grant_reference IS NOT NULL)),
  -- Un dépôt daily n'existe que pour un export ingestion-ready (0C).
  CONSTRAINT attempts_v2_daily_requires_ready
    CHECK (requested_mode <> 'daily' OR ingestion_ready),
  -- Aucun dépôt ne persiste pour une source refusée par la garde BRIDGE/UNKNOWN.
  CONSTRAINT attempts_v2_bridge_guard_passed
    CHECK (bridge_guard_passed)
);

COMMENT ON TABLE public.daily_statement_export_attempts IS
  'Dépôts d''exports journaliers v2. Jamais de CSV brut. Écriture uniquement via pre_ingest_daily_statement_units. Un payload invalide ne persiste RIEN (D-0H-5).';

-- 1.B  Unités journalières en staging (quarantaine par journée).
CREATE TABLE public.daily_statement_units_staging (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id                uuid NOT NULL REFERENCES public.daily_statement_export_attempts (id),
  day_unit_id               text NOT NULL,

  bank                      text NOT NULL,
  account_fingerprint       text NOT NULL,
  currency                  text NOT NULL,
  accounting_date           date NOT NULL,

  day_content_hash          text NOT NULL,
  line_count                integer NOT NULL CHECK (line_count >= 1),
  day_total_debits          numeric(18, 2) NOT NULL,
  day_total_credits         numeric(18, 2) NOT NULL,
  opening_balance_derived   numeric(18, 2),
  closing_balance_derived   numeric(18, 2),
  aggregates_status         text NOT NULL,
  validation_status         text NOT NULL,

  status                    text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users (id),

  CONSTRAINT units_staging_aggregates_domain
    CHECK (aggregates_status IN ('derived', 'unavailable')),
  CONSTRAINT units_staging_validation_domain
    CHECK (validation_status IN ('valid', 'needs_review')),
  CONSTRAINT units_staging_status_domain CHECK (status IN (
    'staged', 'provisional', 'duplicate', 'conflict', 'needs_review',
    'promoted', 'promotion_failed', 'superseded'
  )),
  -- Miroir du contrat TS : derived => les deux soldes présents ;
  -- unavailable => aucun solde fabriqué.
  CONSTRAINT units_staging_aggregates_coherent
    CHECK ((aggregates_status = 'derived'
              AND opening_balance_derived IS NOT NULL
              AND closing_balance_derived IS NOT NULL)
        OR (aggregates_status = 'unavailable'
              AND opening_balance_derived IS NULL
              AND closing_balance_derived IS NULL)),
  -- Une journée au plus une fois par tentative.
  CONSTRAINT units_staging_one_per_attempt UNIQUE (attempt_id, day_unit_id)
);

-- 1.C  Lignes de transaction en staging (rattachées à leur unité journalière).
CREATE TABLE public.daily_statement_lines_staging (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_unit_id           uuid NOT NULL REFERENCES public.daily_statement_units_staging (id) ON DELETE CASCADE,
  attempt_id                uuid NOT NULL REFERENCES public.daily_statement_export_attempts (id),
  day_unit_id               text NOT NULL,

  daily_line_hash           text NOT NULL,
  daily_occurrence_ordinal  integer NOT NULL CHECK (daily_occurrence_ordinal >= 1),
  source_line_index         integer NOT NULL CHECK (source_line_index >= 0),

  accounting_date           date NOT NULL,
  value_date                date,
  -- Libellé normalisé, PAS anonymisé : donnée sensible, RLS admin seul.
  description_sanitized     text NOT NULL,

  debit_amount              numeric(18, 2),
  credit_amount             numeric(18, 2),
  signed_amount             numeric(18, 2) NOT NULL,
  running_balance           numeric(18, 2),
  direction                 text NOT NULL CHECK (direction IN ('debit', 'credit')),
  currency                  text NOT NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),

  -- Cohérence direction/montant/signe complète (doctrine PR #77).
  CONSTRAINT lines_staging_v2_one_amount
    CHECK (
      (direction = 'debit'  AND debit_amount  IS NOT NULL AND credit_amount IS NULL
        AND signed_amount < 0 AND abs(signed_amount) = debit_amount) OR
      (direction = 'credit' AND credit_amount IS NOT NULL AND debit_amount  IS NULL
        AND signed_amount > 0 AND signed_amount = credit_amount)
    ),
  CONSTRAINT lines_staging_v2_unique_per_unit
    UNIQUE (staging_unit_id, daily_line_hash)
);

-- 1.D  Unités journalières promues (source de vérité par journée).
CREATE TABLE public.daily_statement_units_canonical (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoted_from_staging_unit_id uuid NOT NULL REFERENCES public.daily_statement_units_staging (id),
  day_unit_id               text NOT NULL,

  bank                      text NOT NULL,
  account_fingerprint       text NOT NULL,
  currency                  text NOT NULL,
  accounting_date           date NOT NULL,

  active_day_content_hash   text NOT NULL,
  line_count                integer NOT NULL CHECK (line_count >= 1),
  day_total_debits          numeric(18, 2) NOT NULL,
  day_total_credits         numeric(18, 2) NOT NULL,
  opening_balance_derived   numeric(18, 2),
  closing_balance_derived   numeric(18, 2),
  aggregates_status         text NOT NULL,
  validation_status         text NOT NULL,

  status                    text NOT NULL DEFAULT 'ingested',
  ingested_at               timestamptz NOT NULL DEFAULT now(),
  ingested_by               uuid REFERENCES auth.users (id),

  -- Chaîne de remplacement journée par journée. DEFERRABLE : le supersede
  -- référence l'id du nouveau canonical AVANT son insertion (FK au COMMIT).
  superseded_by             uuid REFERENCES public.daily_statement_units_canonical (id)
                              DEFERRABLE INITIALLY DEFERRED,
  superseded_at             timestamptz,

  CONSTRAINT units_canonical_aggregates_domain
    CHECK (aggregates_status IN ('derived', 'unavailable')),
  CONSTRAINT units_canonical_validation_domain
    CHECK (validation_status IN ('valid', 'needs_review')),
  CONSTRAINT units_canonical_status_domain
    CHECK (status IN ('ingested', 'superseded')),
  CONSTRAINT units_canonical_supersede_coherent
    CHECK (
      (status = 'ingested'   AND superseded_by IS NULL     AND superseded_at IS NULL) OR
      (status = 'superseded' AND superseded_by IS NOT NULL AND superseded_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.daily_statement_units_canonical IS
  'Journées promues. Aucune policy INSERT/UPDATE/DELETE : mutations uniquement via RPC promote/supersede (SECURITY DEFINER). Correction = supersede par journée, jamais DELETE.';

-- 1.E  Lignes promues (immuables ; is_active = seul champ de cycle de vie).
CREATE TABLE public.daily_statement_lines_canonical (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_unit_id         uuid NOT NULL REFERENCES public.daily_statement_units_canonical (id),
  day_unit_id               text NOT NULL,

  daily_line_hash           text NOT NULL,
  daily_occurrence_ordinal  integer NOT NULL CHECK (daily_occurrence_ordinal >= 1),
  source_line_index         integer NOT NULL CHECK (source_line_index >= 0),

  -- Option A (doctrine v1 CTO-1) : dénormalisation du statut actif du parent.
  -- Toujours explicite ; maintenu EXCLUSIVEMENT par promote/supersede.
  is_active                 boolean NOT NULL,

  accounting_date           date NOT NULL,
  value_date                date,
  description_sanitized     text NOT NULL,

  debit_amount              numeric(18, 2),
  credit_amount             numeric(18, 2),
  signed_amount             numeric(18, 2) NOT NULL,
  running_balance           numeric(18, 2),
  direction                 text NOT NULL CHECK (direction IN ('debit', 'credit')),
  currency                  text NOT NULL,

  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lines_canonical_v2_one_amount
    CHECK (
      (direction = 'debit'  AND debit_amount  IS NOT NULL AND credit_amount IS NULL
        AND signed_amount < 0 AND abs(signed_amount) = debit_amount) OR
      (direction = 'credit' AND credit_amount IS NOT NULL AND debit_amount  IS NULL
        AND signed_amount > 0 AND signed_amount = credit_amount)
    )
);

-- 1.F  Audit append-only du pipeline journalier.
CREATE TABLE public.daily_statement_import_events (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  actor_id                  uuid REFERENCES auth.users (id),

  attempt_id                uuid REFERENCES public.daily_statement_export_attempts (id),
  staging_unit_id           uuid REFERENCES public.daily_statement_units_staging (id),
  canonical_unit_id         uuid REFERENCES public.daily_statement_units_canonical (id),
  day_unit_id               text,
  raw_text_hash             text,

  event_type                text NOT NULL,
  previous_status           text,
  new_status                text,

  safe_message              text,
  safe_details              jsonb,

  CONSTRAINT events_v2_event_type_domain CHECK (event_type IN (
    'attempt_received', 'backfill_deposit', 'unit_staged', 'unit_provisional_held',
    'unit_duplicate', 'unit_conflict', 'unit_needs_review', 'unit_promoted',
    'promotion_failed', 'unit_superseded', 'status_changed'
  )),
  CONSTRAINT events_v2_reference_something
    CHECK (
      attempt_id IS NOT NULL OR
      staging_unit_id IS NOT NULL OR
      canonical_unit_id IS NOT NULL
    ),
  -- Ceinture top-level ; la profondeur est neutralisée par la règle
  -- « scalaires uniquement » de la RPC d'audit (doctrine v1 CTO-6).
  CONSTRAINT events_v2_safe_details_no_banned_keys
    CHECK (
      safe_details IS NULL
      OR NOT (safe_details ?| ARRAY[
        'raw_csv', 'raw_text', 'raw_bytes', 'raw_content', 'file_content',
        'account_number', 'iban', 'decoded_text', 'full_iban', 'raw_account',
        'account_number_raw'
      ])
    )
);

COMMENT ON TABLE public.daily_statement_import_events IS
  'Audit append-only. INSERT uniquement via daily_stmt_append_audit_event (whitelist + scalaires). Aucune policy UPDATE/DELETE ; privilèges d''écriture révoqués.';

-- ============================================================================
-- SECTION 2 — INDEX
-- ============================================================================

-- Jamais deux versions ACTIVES d'une même journée (ancre dure R1/R2).
CREATE UNIQUE INDEX uq_daily_units_canonical_active_day_unit_id
  ON public.daily_statement_units_canonical (day_unit_id)
  WHERE status = 'ingested';

-- Un daily_line_hash unique PAR unité canonical.
CREATE UNIQUE INDEX uq_daily_lines_canonical_hash_per_unit
  ON public.daily_statement_lines_canonical (canonical_unit_id, daily_line_hash);

-- Option A : un daily_line_hash n'est ACTIF qu'une seule fois (ceinture R3).
CREATE UNIQUE INDEX uq_daily_lines_canonical_hash_active
  ON public.daily_statement_lines_canonical (daily_line_hash)
  WHERE is_active;

CREATE INDEX idx_daily_attempts_raw_text_hash
  ON public.daily_statement_export_attempts (raw_text_hash);
CREATE INDEX idx_daily_units_staging_day_unit_id
  ON public.daily_statement_units_staging (day_unit_id);
CREATE INDEX idx_daily_units_staging_status
  ON public.daily_statement_units_staging (status);
CREATE INDEX idx_daily_lines_staging_day_unit_id
  ON public.daily_statement_lines_staging (day_unit_id);
CREATE INDEX idx_daily_lines_canonical_day_unit_id
  ON public.daily_statement_lines_canonical (day_unit_id);
CREATE INDEX idx_daily_events_attempt_id
  ON public.daily_statement_import_events (attempt_id);

-- ============================================================================
-- SECTION 3 — HELPERS INTERNES (aucun EXECUTE applicatif — double verrou)
-- ============================================================================
-- Ces fonctions ne sont PAS des RPC : elles s'exécutent dans le contexte
-- definer (owner) des RPC appelantes. EXECUTE révoqué de tous les rôles
-- applicatifs en SECTION 7.

-- 3.1 Dates DD/MM/YYYY strictes (copie conforme v1 : conversion explicite,
--     round-trip, aucun cast implicite dépendant du DateStyle).
CREATE OR REPLACE FUNCTION public.daily_stmt_parse_date_strict(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date date;
BEGIN
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_DATE_NULL: date value required (fail-closed)';
  END IF;
  IF p_value !~ '^\d{2}/\d{2}/\d{4}$' THEN
    RAISE EXCEPTION 'DAILY_STMT_DATE_FORMAT: expected DD/MM/YYYY (fail-closed)';
  END IF;
  v_date := to_date(p_value, 'DD/MM/YYYY');
  IF to_char(v_date, 'DD/MM/YYYY') <> p_value THEN
    RAISE EXCEPTION 'DAILY_STMT_DATE_ROUNDTRIP: value rejected (fail-closed)';
  END IF;
  RETURN v_date;
END;
$$;

-- 3.2 Montants stricts : forme admise = signe optionnel, 1-16 chiffres,
--     décimales optionnelles ; échelle max 2, aucun arrondi silencieux
--     (NaN/Infinity/exponentielle échouent la regex, doctrine PR #77).
CREATE OR REPLACE FUNCTION public.daily_stmt_parse_amount_strict(p_value text)
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
  IF p_value !~ '^-?[0-9]{1,16}([.][0-9]+)?$' THEN
    RAISE EXCEPTION 'DAILY_STMT_AMOUNT_FORMAT: numeric value rejected (fail-closed)';
  END IF;
  v_num := p_value::numeric;
  IF v_num IS DISTINCT FROM round(v_num, 2) THEN
    RAISE EXCEPTION 'DAILY_STMT_AMOUNT_SCALE: more than 2 decimals rejected (fail-closed)';
  END IF;
  RETURN v_num;
END;
$$;

-- 3.3 Hash SHA-256 hex lowercase 64 (forme de toute identité v2 persistée).
CREATE OR REPLACE FUNCTION public.daily_stmt_assert_hex64(p_value text, p_label text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_value IS NULL OR p_value !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'DAILY_STMT_HEX_REQUIRED: % must be a 64-char lowercase hex SHA-256 (fail-closed)', p_label;
  END IF;
  RETURN p_value;
END;
$$;

-- 3.4 Whitelist de clés d'un objet jsonb (anti-smuggling par construction).
CREATE OR REPLACE FUNCTION public.daily_stmt_assert_object_keys(
  p_object  jsonb,
  p_allowed text[],
  p_label   text
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
    RAISE EXCEPTION 'DAILY_STMT_PAYLOAD_TYPE: % must be a json object (fail-closed)', p_label;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_object) LOOP
    IF NOT (v_key = ANY (p_allowed)) THEN
      RAISE EXCEPTION 'DAILY_STMT_PAYLOAD_KEY: % carries a key outside its whitelist (fail-closed)', p_label;
    END IF;
  END LOOP;
END;
$$;

-- 3.5 Scan PROFOND des clés interdites (objets ET tableaux, toute profondeur).
--     Matching exact sur la forme normalisée (minuscules, non-alphanumériques
--     retirés) : raw_csv ET rawCsv sont bloqués, tandis que raw_text_hash /
--     account_number_masked — qui ne font que CONTENIR une sous-chaîne
--     bloquée — restent autorisés (jamais de matching par sous-chaîne).
CREATE OR REPLACE FUNCTION public.daily_stmt_assert_no_forbidden_keys(
  p_value jsonb,
  p_path  text DEFAULT '$'
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key  text;
  v_norm text;
  v_idx  integer := 0;
  v_elem jsonb;
  -- Miroir de DAILY_STATEMENT_FORBIDDEN_PAYLOAD_KEYS (0G), formes normalisées.
  v_forbidden constant text[] := ARRAY[
    'rawcsv', 'rawtext', 'rawbytes', 'rawcontent', 'filecontent',
    'accountnumber', 'iban', 'decodedtext', 'fulliban', 'rawaccount',
    'accountnumberraw'
  ];
BEGIN
  IF p_value IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_value) = 'object' THEN
    FOR v_key IN SELECT jsonb_object_keys(p_value) LOOP
      v_norm := regexp_replace(lower(v_key), '[^a-z0-9]', '', 'g');
      IF v_norm = ANY (v_forbidden) THEN
        RAISE EXCEPTION 'DAILY_STMT_FORBIDDEN_KEY: forbidden key at %.% — raw content, full accounts and IBANs are never accepted (fail-closed)', p_path, v_key;
      END IF;
      PERFORM public.daily_stmt_assert_no_forbidden_keys(p_value -> v_key, p_path || '.' || v_key);
    END LOOP;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    FOR v_elem IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      PERFORM public.daily_stmt_assert_no_forbidden_keys(v_elem, p_path || '[' || v_idx || ']');
      v_idx := v_idx + 1;
    END LOOP;
  END IF;
END;
$$;

-- 3.6 Masque de compte strict (doctrine PR #77).
CREATE OR REPLACE FUNCTION public.daily_stmt_assert_masked_account(p_value text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_value IS NULL THEN
    RETURN;
  END IF;
  IF p_value !~ '^[*]+[0-9]{0,4}$' THEN
    RAISE EXCEPTION 'DAILY_STMT_MASKED_ACCOUNT: account_number_masked must be asterisks then at most 4 digits (fail-closed)';
  END IF;
END;
$$;

-- 3.7 Nom de fichier expurgé (heuristiques conservatrices, miroir TS) :
--     séparateurs de chemin, 8+ chiffres consécutifs, motif IBAN-like ou
--     longueur excessive => refus fail-closed.
CREATE OR REPLACE FUNCTION public.daily_stmt_assert_safe_file_name(p_value text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_value IS NULL THEN
    RETURN;
  END IF;
  IF length(p_value) > 200 THEN
    RAISE EXCEPTION 'DAILY_STMT_FILE_NAME_SENSITIVE: source_file_name_redacted exceeds 200 characters (fail-closed)';
  END IF;
  IF p_value ~ '[\\/]' THEN
    RAISE EXCEPTION 'DAILY_STMT_FILE_NAME_SENSITIVE: source_file_name_redacted must not contain path separators (fail-closed)';
  END IF;
  IF p_value ~ '[0-9]{8,}' OR p_value ~ '[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,}' THEN
    RAISE EXCEPTION 'DAILY_STMT_FILE_NAME_SENSITIVE: source_file_name_redacted still looks sensitive (long digit run or IBAN-like value, fail-closed)';
  END IF;
END;
$$;

-- 3.8 Raison humaine safe : non vide, longueur bornée (jamais de contenu CSV).
CREATE OR REPLACE FUNCTION public.daily_stmt_assert_safe_reason(p_reason text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_REASON_REQUIRED: non-empty reason required (fail-closed)';
  END IF;
  IF length(p_reason) > 200 THEN
    RAISE EXCEPTION 'DAILY_STMT_REASON_TOO_LONG: max 200 chars (fail-closed)';
  END IF;
END;
$$;

-- 3.9 day_content_hash v2 — twin SQL STRICT du helper TS 0G.
--     Préimage : JSON array [domainTag, dayUnitId, sortedDailyLineHashes],
--     SHA-256 hex lowercase. Assemblage par concaténation de
--     to_json(text)::text : sortie compacte (aucun espace) et échappement
--     escape_json byte-compatible JSON.stringify — parité prouvée par les
--     ancres TS figées dans la suite de tests. Tri LEXICAL en ordre d'octets
--     (COLLATE "C") = tri par code unit JS pour des chaînes hex lowercase
--     ASCII. Doublon refusé : le daily_line_hash v2 embarque l'ordinal, un
--     doublon révèle un bug amont.
CREATE OR REPLACE FUNCTION public.daily_stmt_day_content_hash(
  p_day_unit_id text,
  p_hashes      text[]
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload text;
BEGIN
  IF p_day_unit_id IS NULL OR length(btrim(p_day_unit_id)) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_CONTENT_HASH_UNIT_ID: dayUnitId must be non-empty (fail-closed)';
  END IF;
  IF p_hashes IS NULL OR coalesce(array_length(p_hashes, 1), 0) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_CONTENT_HASH_EMPTY: dailyLineHashes must be a non-empty array (fail-closed)';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_hashes) h WHERE h IS NULL OR h !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'DAILY_STMT_CONTENT_HASH_ENTRY: every dailyLineHash must be a 64-char lowercase hex SHA-256 (fail-closed)';
  END IF;
  IF (SELECT count(DISTINCT h) FROM unnest(p_hashes) h) <> array_length(p_hashes, 1) THEN
    RAISE EXCEPTION 'DAILY_STMT_CONTENT_HASH_DUPLICATE: duplicate dailyLineHash in one unit reveals an ordinal bug (fail-closed)';
  END IF;

  v_payload := '['
    || to_json('sodatra:structured_bank_statement_csv:day_content_hash:v2'::text)::text
    || ',' || to_json(btrim(p_day_unit_id))::text
    || ',['
    || (SELECT string_agg(to_json(h)::text, ',' ORDER BY h COLLATE "C") FROM unnest(p_hashes) h)
    || ']]';

  RETURN encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');
END;
$$;

-- 3.10 day_unit_id v2 — recalcul serveur (décision D-0H-1) : toute divergence
--      bank / account_fingerprint / currency / accounting_date entre le
--      contexte attempt et une unité déclarée est structurellement rejetée.
--      Même assemblage compact to_json(text)::text que 3.9 ; préimage
--      identique au canonicalPayload TS (0H idempotency keys).
CREATE OR REPLACE FUNCTION public.daily_stmt_day_unit_id(
  p_bank            text,
  p_fingerprint     text,
  p_currency        text,
  p_accounting_date text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payload text;
BEGIN
  v_payload := '['
    || to_json('sodatra:structured_bank_statement_csv:day_unit_id:v2'::text)::text
    || ',' || to_json(btrim(p_bank))::text
    || ',' || to_json(btrim(p_fingerprint))::text
    || ',' || to_json(btrim(p_currency))::text
    || ',' || to_json(btrim(p_accounting_date))::text
    || ']';
  RETURN encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');
END;
$$;

-- 3.11 Whitelist safe_details + valeurs scalaires uniquement (doctrine CTO-6).
CREATE OR REPLACE FUNCTION public.daily_stmt_assert_safe_details(p_details jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key  text;
  v_type text;
  v_allowed constant text[] := ARRAY[
    'reason_code', 'errors_count', 'warnings_count', 'line_count',
    'day_unit_id', 'daily_line_hash', 'accounting_date', 'day_content_hash',
    'raw_text_hash', 'requested_mode', 'backfill_grant_reference',
    'previous_status', 'new_status', 'resolution', 'parser_version',
    'runtime_version', 'units_total', 'units_staged', 'units_provisional',
    'units_duplicate', 'units_conflict', 'units_needs_review', 'period_days'
  ];
BEGIN
  IF p_details IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_details) <> 'object' THEN
    RAISE EXCEPTION 'DAILY_STMT_SAFE_DETAILS_TYPE: object required (fail-closed)';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_details) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'DAILY_STMT_SAFE_DETAILS_KEY: key outside whitelist (fail-closed)';
    END IF;
    v_type := jsonb_typeof(p_details -> v_key);
    IF v_type NOT IN ('string', 'number', 'boolean', 'null') THEN
      RAISE EXCEPTION 'DAILY_STMT_SAFE_DETAILS_SCALAR: nested values rejected (fail-closed)';
    END IF;
  END LOOP;
END;
$$;

-- 3.12 SEUL point d'écriture de daily_statement_import_events.
CREATE OR REPLACE FUNCTION public.daily_stmt_append_audit_event(
  p_actor_id          uuid,
  p_attempt_id        uuid,
  p_staging_unit_id   uuid,
  p_canonical_unit_id uuid,
  p_day_unit_id       text,
  p_raw_text_hash     text,
  p_event_type        text,
  p_previous_status   text,
  p_new_status        text,
  p_safe_message      text,
  p_safe_details      jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.daily_stmt_assert_safe_details(p_safe_details);
  INSERT INTO public.daily_statement_import_events (
    actor_id, attempt_id, staging_unit_id, canonical_unit_id,
    day_unit_id, raw_text_hash, event_type, previous_status, new_status,
    safe_message, safe_details
  ) VALUES (
    p_actor_id, p_attempt_id, p_staging_unit_id, p_canonical_unit_id,
    p_day_unit_id, p_raw_text_hash, p_event_type, p_previous_status, p_new_status,
    p_safe_message, p_safe_details
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 3.13 Verrou décisionnel PAR JOURNÉE : sérialise dépôt/promotion/supersede
--      d'un même day_unit_id. Libéré au COMMIT/ROLLBACK. Les appelants
--      multi-unités acquièrent leurs verrous en ordre trié (anti-deadlock).
CREATE OR REPLACE FUNCTION public.daily_stmt_acquire_day_lock(p_day_unit_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_day_unit_id IS NULL OR length(btrim(p_day_unit_id)) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_LOCK_DAY_UNIT_ID: non-empty day_unit_id required (fail-closed)';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_day_unit_id, 0));
END;
$$;

-- 3.14 Cœur de promotion staging -> canonical d'UNE unité journalière,
--      partagé par promote (4.2) et supersede (4.3). Préconditions à la
--      charge de l'appelant : verrou day_unit_id pris, R1/R2/R3 arbitrés.
CREATE OR REPLACE FUNCTION public.daily_stmt_promote_unit_core(
  p_staging_unit_id  uuid,
  p_new_canonical_id uuid,
  p_actor            uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit         public.daily_statement_units_staging%ROWTYPE;
  v_inserted     integer;
  v_active_count integer;
BEGIN
  SELECT * INTO v_unit
  FROM public.daily_statement_units_staging WHERE id = p_staging_unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_CORE_STAGING_NOT_FOUND (fail-closed)';
  END IF;
  IF v_unit.status NOT IN ('staged', 'conflict') THEN
    RAISE EXCEPTION 'DAILY_STMT_CORE_STAGING_STATE: staging unit not promotable (fail-closed)';
  END IF;

  INSERT INTO public.daily_statement_units_canonical (
    id, promoted_from_staging_unit_id, day_unit_id,
    bank, account_fingerprint, currency, accounting_date,
    active_day_content_hash, line_count, day_total_debits, day_total_credits,
    opening_balance_derived, closing_balance_derived,
    aggregates_status, validation_status, status, ingested_by
  ) VALUES (
    p_new_canonical_id, v_unit.id, v_unit.day_unit_id,
    v_unit.bank, v_unit.account_fingerprint, v_unit.currency, v_unit.accounting_date,
    v_unit.day_content_hash, v_unit.line_count, v_unit.day_total_debits, v_unit.day_total_credits,
    v_unit.opening_balance_derived, v_unit.closing_balance_derived,
    v_unit.aggregates_status, v_unit.validation_status, 'ingested', p_actor
  );

  INSERT INTO public.daily_statement_lines_canonical (
    canonical_unit_id, day_unit_id, daily_line_hash, daily_occurrence_ordinal,
    source_line_index, is_active, accounting_date, value_date,
    description_sanitized, debit_amount, credit_amount, signed_amount,
    running_balance, direction, currency
  )
  SELECT
    p_new_canonical_id, ls.day_unit_id, ls.daily_line_hash, ls.daily_occurrence_ordinal,
    ls.source_line_index, true, ls.accounting_date, ls.value_date,
    ls.description_sanitized, ls.debit_amount, ls.credit_amount, ls.signed_amount,
    ls.running_balance, ls.direction, ls.currency
  FROM public.daily_statement_lines_staging ls
  WHERE ls.staging_unit_id = v_unit.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_unit.line_count THEN
    RAISE EXCEPTION 'DAILY_STMT_CORE_LINE_COUNT: staged/promoted mismatch (fail-closed)';
  END IF;

  UPDATE public.daily_statement_units_staging
    SET status = 'promoted'
    WHERE id = v_unit.id;

  PERFORM public.daily_stmt_append_audit_event(
    p_actor, v_unit.attempt_id, v_unit.id, p_new_canonical_id,
    v_unit.day_unit_id, NULL,
    'unit_promoted', v_unit.status, 'promoted',
    'daily unit promoted to canonical',
    jsonb_build_object('day_unit_id', v_unit.day_unit_id,
                       'day_content_hash', v_unit.day_content_hash,
                       'line_count', v_unit.line_count)
  );

  -- Postcondition : exactement UNE unité canonical active pour ce day_unit_id.
  SELECT count(*) INTO v_active_count
  FROM public.daily_statement_units_canonical
  WHERE day_unit_id = v_unit.day_unit_id AND status = 'ingested';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'DAILY_STMT_CORE_POSTCONDITION: active canonical count <> 1 (rollback)';
  END IF;

  RETURN p_new_canonical_id;
END;
$$;

-- 3.15 Trigger anti-promote : ceinture STRUCTURELLE indépendante des RPC.
--      Une unité provisional / duplicate / needs_review ne peut JAMAIS être
--      insérée en canonical, même par un chemin owner défectueux.
CREATE OR REPLACE FUNCTION public.daily_stmt_assert_canonical_insert_allowed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit public.daily_statement_units_staging%ROWTYPE;
BEGIN
  IF NEW.status <> 'ingested' THEN
    RAISE EXCEPTION 'DAILY_STMT_TRIGGER_STATUS: canonical must be inserted as ingested (fail-closed)';
  END IF;
  SELECT * INTO v_unit
  FROM public.daily_statement_units_staging WHERE id = NEW.promoted_from_staging_unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_TRIGGER_STAGING: staging unit required (fail-closed)';
  END IF;
  IF v_unit.day_unit_id <> NEW.day_unit_id THEN
    RAISE EXCEPTION 'DAILY_STMT_TRIGGER_DAY_UNIT_ID: staging/canonical day_unit_id mismatch (fail-closed)';
  END IF;
  IF v_unit.status NOT IN ('staged', 'conflict') THEN
    RAISE EXCEPTION 'DAILY_STMT_TRIGGER_GATE: staging status % forbids promotion (provisional/duplicate/needs_review are never promotable, fail-closed)', v_unit.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_daily_units_canonical_anti_promote
  BEFORE INSERT ON public.daily_statement_units_canonical
  FOR EACH ROW EXECUTE FUNCTION public.daily_stmt_assert_canonical_insert_allowed();

-- ============================================================================
-- SECTION 4 — RPC EXPOSÉES (SECURITY DEFINER, rôle vérifié en interne)
-- ============================================================================

-- 4.1 pre_ingest_daily_statement_units — UNIQUE write path du dépôt v2.
--     Twin SQL du builder TS 0G : mêmes whitelists, même blocklist profonde,
--     mêmes gates, day_unit_id ET day_content_hash recalculés côté serveur.
--     Rôles : admin, manager (dépôt daily) ; backfill = admin seul.
--     Arbitrage PAR UNITÉ sous verrou : R1 duplicate (pas de lignes stagées),
--     R2 conflict (quarantaine pour supersede), R3 needs_review, provisional
--     hors arbitrage (D-0H-4). Fail-closed all-or-nothing : toute violation
--     lève une exception et RIEN ne persiste.
CREATE OR REPLACE FUNCTION public.pre_ingest_daily_statement_units(
  p_attempt       jsonb,
  p_units         jsonb,
  p_lines         jsonb,
  p_guard_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor            uuid;
  v_attempt_id       uuid;

  -- attempt
  v_mode             text;
  v_source_format    text;
  v_bank             text;
  v_currency         text;
  v_fp               text;
  v_masked           text;
  v_file_name        text;
  v_rth              text;
  v_period_start     date;
  v_period_end       date;
  v_stmt_date        date;
  v_ref_date         date;
  v_parser_status    text;
  v_errors_count     integer;
  v_warnings_count   integer;

  -- guard
  v_ingestion_ready  boolean;
  v_bridge           boolean;
  v_period_days      integer;
  v_grant            text;

  -- units (tableaux parallèles indexés par position dans p_units)
  v_n                integer;
  v_unit             jsonb;
  v_line             jsonb;
  v_i                integer;
  v_lidx             integer;
  v_day_unit_ids     text[] := '{}';
  v_acc_raw          text[] := '{}';
  v_acc_dates        date[] := '{}';
  v_content_hashes   text[] := '{}';
  v_line_counts      integer[] := '{}';
  v_req_status       text[] := '{}';
  v_expected         text;
  v_max_acc          date;
  v_unit_hashes      text[];

  -- lignes
  v_direction        text;
  v_signed           numeric;
  v_debit            numeric;
  v_credit           numeric;
  v_seen_pairs       text[] := '{}';
  v_pair             text;

  -- arbitrage
  v_lock_id          text;
  v_active           public.daily_statement_units_canonical%ROWTYPE;
  v_final            text;
  v_overlap          boolean;
  v_staging_unit_id  uuid;
  v_result_units     jsonb := '[]'::jsonb;
  v_active_id        uuid;

  -- Miroirs EXACTS des whitelists TS 0G (DAILY_STATEMENT_RPC_*_ALLOWED_KEYS).
  c_attempt_allowed constant text[] := ARRAY[
    'requested_mode', 'source_format', 'bank', 'currency', 'account_fingerprint',
    'account_number_masked', 'source_file_name_redacted', 'raw_text_hash',
    'export_period_start', 'export_period_end', 'statement_date',
    'export_reference_date', 'parser_validation_status', 'errors_count',
    'warnings_count', 'runtime_version', 'parser_version'
  ];
  c_unit_allowed constant text[] := ARRAY[
    'day_unit_id', 'accounting_date', 'day_content_hash', 'line_count',
    'day_total_debits', 'day_total_credits', 'opening_balance_derived',
    'closing_balance_derived', 'aggregates_status', 'validation_status',
    'requested_unit_status'
  ];
  c_line_allowed constant text[] := ARRAY[
    'day_unit_id', 'daily_line_hash', 'daily_occurrence_ordinal',
    'source_line_index', 'accounting_date', 'value_date',
    'description_sanitized', 'debit_amount', 'credit_amount', 'signed_amount',
    'running_balance', 'direction', 'currency'
  ];
  c_guard_allowed constant text[] := ARRAY[
    'ingestion_ready', 'period_days', 'bridge_guard_passed',
    'backfill_grant_reference'
  ];
  -- Miroir de MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS (0C).
  c_max_period_days constant integer := 45;
BEGIN
  -- Rôle : admin ou manager (dépôt) ; backfill = admin seul (doctrine 0F).
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT (public.has_role(v_actor, 'admin'::public.app_role)
          OR public.has_role(v_actor, 'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'DAILY_STMT_ROLE_DENIED: admin or manager role required (fail-closed)';
  END IF;

  -- Anti-smuggling AVANT tout : scan profond des 4 paramètres.
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_attempt, '$.p_attempt');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_units, '$.p_units');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_lines, '$.p_lines');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_guard_context, '$.p_guard_context');

  -- Whitelists structurelles.
  PERFORM public.daily_stmt_assert_object_keys(p_attempt, c_attempt_allowed, 'p_attempt');
  PERFORM public.daily_stmt_assert_object_keys(p_guard_context, c_guard_allowed, 'p_guard_context');
  IF p_units IS NULL OR jsonb_typeof(p_units) <> 'array' OR jsonb_array_length(p_units) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_UNITS_REQUIRED: p_units must be a non-empty json array (fail-closed)';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_LINES_REQUIRED: p_lines must be a non-empty json array (fail-closed)';
  END IF;

  -- ------------------------------------------------------------------
  -- p_attempt
  -- ------------------------------------------------------------------
  v_mode := p_attempt ->> 'requested_mode';
  IF v_mode IS NULL OR v_mode NOT IN ('daily', 'backfill') THEN
    RAISE EXCEPTION 'DAILY_STMT_MODE_UNSUPPORTED: requested_mode must be daily or backfill (fail-closed)';
  END IF;
  IF v_mode = 'backfill'
     AND NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_ADMIN_ONLY: backfill deposits require the admin role (fail-closed)';
  END IF;

  v_source_format := nullif(btrim(coalesce(p_attempt ->> 'source_format', '')), '');
  v_bank          := nullif(btrim(coalesce(p_attempt ->> 'bank', '')), '');
  v_currency      := nullif(btrim(coalesce(p_attempt ->> 'currency', '')), '');
  v_fp            := nullif(btrim(coalesce(p_attempt ->> 'account_fingerprint', '')), '');
  IF v_source_format IS NULL OR v_bank IS NULL OR v_currency IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_SOURCE_REQUIRED: source_format, bank and currency are required (fail-closed)';
  END IF;
  IF v_fp IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_FINGERPRINT_REQUIRED: account_fingerprint is mandatory; no fallback on the masked account number (fail-closed)';
  END IF;

  v_masked := nullif(btrim(coalesce(p_attempt ->> 'account_number_masked', '')), '');
  PERFORM public.daily_stmt_assert_masked_account(v_masked);
  v_file_name := nullif(btrim(coalesce(p_attempt ->> 'source_file_name_redacted', '')), '');
  PERFORM public.daily_stmt_assert_safe_file_name(v_file_name);

  v_rth := public.daily_stmt_assert_hex64(p_attempt ->> 'raw_text_hash', 'raw_text_hash');

  v_period_start := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_start');
  v_period_end   := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_end');
  IF v_period_end < v_period_start THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_INCOHERENT: export_period_end earlier than export_period_start (fail-closed)';
  END IF;
  v_stmt_date := CASE WHEN p_attempt ->> 'statement_date' IS NULL THEN NULL
                      ELSE public.daily_stmt_parse_date_strict(p_attempt ->> 'statement_date') END;
  v_ref_date  := CASE WHEN p_attempt ->> 'export_reference_date' IS NULL THEN NULL
                      ELSE public.daily_stmt_parse_date_strict(p_attempt ->> 'export_reference_date') END;

  v_parser_status := p_attempt ->> 'parser_validation_status';
  IF v_parser_status IS NULL OR v_parser_status NOT IN ('valid', 'needs_review') THEN
    RAISE EXCEPTION 'DAILY_STMT_PARSER_STATUS: parser_validation_status must be valid or needs_review (fail-closed)';
  END IF;

  IF coalesce(p_attempt ->> 'errors_count', '0') !~ '^[0-9]+$'
     OR coalesce(p_attempt ->> 'warnings_count', '0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DAILY_STMT_COUNT_INVALID: errors_count/warnings_count must be integers >= 0 (fail-closed)';
  END IF;
  v_errors_count   := coalesce(p_attempt ->> 'errors_count', '0')::integer;
  v_warnings_count := coalesce(p_attempt ->> 'warnings_count', '0')::integer;

  -- ------------------------------------------------------------------
  -- p_guard_context
  -- ------------------------------------------------------------------
  IF jsonb_typeof(p_guard_context -> 'ingestion_ready') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_guard_context -> 'bridge_guard_passed') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'DAILY_STMT_GUARD_TYPE: ingestion_ready and bridge_guard_passed must be json booleans (fail-closed)';
  END IF;
  v_ingestion_ready := (p_guard_context ->> 'ingestion_ready')::boolean;
  v_bridge          := (p_guard_context ->> 'bridge_guard_passed')::boolean;
  IF coalesce(p_guard_context ->> 'period_days', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_DAYS_INVALID: period_days must be an integer >= 1 (fail-closed)';
  END IF;
  v_period_days := (p_guard_context ->> 'period_days')::integer;
  IF v_period_days < 1 THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_DAYS_INVALID: period_days must be an integer >= 1 (fail-closed)';
  END IF;
  v_grant := nullif(btrim(coalesce(p_guard_context ->> 'backfill_grant_reference', '')), '');

  IF NOT v_bridge THEN
    RAISE EXCEPTION 'DAILY_STMT_BRIDGE_GUARD_FAILED: a guard-rejected export never becomes a deposit (fail-closed)';
  END IF;
  -- Recomptage serveur : la fenêtre déclarée ne peut pas être sous-évaluée.
  IF v_period_days <> (v_period_end - v_period_start + 1) THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_DAYS_MISMATCH: period_days does not match the inclusive export window (fail-closed)';
  END IF;

  IF v_mode = 'daily' THEN
    IF NOT v_ingestion_ready THEN
      RAISE EXCEPTION 'DAILY_STMT_INGESTION_READY_REQUIRED: a daily deposit requires an ingestion-ready export (fail-closed)';
    END IF;
    IF v_period_days > c_max_period_days THEN
      RAISE EXCEPTION 'DAILY_STMT_PERIOD_CAP: export window above the %-day ingestion limit; use the dedicated backfill mode (fail-closed)', c_max_period_days;
    END IF;
    IF v_grant IS NOT NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_GRANT_FORBIDDEN: backfill_grant_reference must not ride a daily deposit (fail-closed)';
    END IF;
  ELSE
    IF v_grant IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_GRANT_REQUIRED: backfill_grant_reference is mandatory in backfill mode (fail-closed)';
    END IF;
  END IF;

  -- ------------------------------------------------------------------
  -- p_units : validation + recalculs serveur (day_unit_id, agrégats domaine)
  -- ------------------------------------------------------------------
  v_n := jsonb_array_length(p_units);
  FOR v_i IN 0 .. v_n - 1 LOOP
    v_unit := p_units -> v_i;
    PERFORM public.daily_stmt_assert_object_keys(v_unit, c_unit_allowed, 'p_units[' || v_i || ']');

    -- accounting_date stricte, puis recalcul du day_unit_id depuis le contexte
    -- attempt (D-0H-1) : divergence bank/fingerprint/currency/date impossible.
    v_acc_raw := v_acc_raw || btrim(v_unit ->> 'accounting_date');
    v_acc_dates := v_acc_dates || public.daily_stmt_parse_date_strict(v_unit ->> 'accounting_date');
    PERFORM public.daily_stmt_assert_hex64(v_unit ->> 'day_unit_id', 'p_units[' || v_i || '].day_unit_id');
    IF (v_unit ->> 'day_unit_id')
       <> public.daily_stmt_day_unit_id(v_bank, v_fp, v_currency, v_acc_raw[v_i + 1]) THEN
      RAISE EXCEPTION 'DAILY_STMT_DAY_UNIT_ID_MISMATCH: p_units[%].day_unit_id does not match the attempt context (bank/fingerprint/currency/accounting_date divergence, fail-closed)', v_i;
    END IF;
    IF (v_unit ->> 'day_unit_id') = ANY (v_day_unit_ids) THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_DUPLICATE: duplicate day_unit_id in p_units (one unit per accounting day, fail-closed)';
    END IF;
    v_day_unit_ids := v_day_unit_ids || (v_unit ->> 'day_unit_id');

    v_content_hashes := v_content_hashes
      || public.daily_stmt_assert_hex64(v_unit ->> 'day_content_hash', 'p_units[' || v_i || '].day_content_hash');

    IF coalesce(v_unit ->> 'line_count', '') !~ '^[0-9]+$' OR (v_unit ->> 'line_count')::integer < 1 THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_LINE_COUNT_INVALID: p_units[%].line_count must be an integer >= 1 (fail-closed)', v_i;
    END IF;
    v_line_counts := v_line_counts || (v_unit ->> 'line_count')::integer;

    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_debits');
    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_credits');
    IF v_unit ->> 'day_total_debits' IS NULL OR v_unit ->> 'day_total_credits' IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_TOTALS_REQUIRED: p_units[%] day totals are required (fail-closed)', v_i;
    END IF;
    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'opening_balance_derived');
    PERFORM public.daily_stmt_parse_amount_strict(v_unit ->> 'closing_balance_derived');

    IF coalesce(v_unit ->> 'aggregates_status', '') NOT IN ('derived', 'unavailable')
       OR coalesce(v_unit ->> 'validation_status', '') NOT IN ('valid', 'needs_review') THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_STATUS_DOMAIN: p_units[%] aggregates/validation status outside domain (fail-closed)', v_i;
    END IF;
    -- Miroir TS : derived => soldes présents ; unavailable => rien de fabriqué.
    IF (v_unit ->> 'aggregates_status' = 'derived'
          AND (v_unit ->> 'opening_balance_derived' IS NULL OR v_unit ->> 'closing_balance_derived' IS NULL))
       OR (v_unit ->> 'aggregates_status' = 'unavailable'
          AND (v_unit ->> 'opening_balance_derived' IS NOT NULL OR v_unit ->> 'closing_balance_derived' IS NOT NULL)) THEN
      RAISE EXCEPTION 'DAILY_STMT_AGGREGATES_INCOHERENT: p_units[%] derived balances incoherent with aggregates_status (fail-closed)', v_i;
    END IF;

    IF coalesce(v_unit ->> 'requested_unit_status', '') NOT IN ('staged', 'provisional') THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_STATUS_DOMAIN: p_units[%].requested_unit_status must be staged or provisional (fail-closed)', v_i;
    END IF;
    v_req_status := v_req_status || (v_unit ->> 'requested_unit_status');
  END LOOP;

  -- Re-dérivation serveur de la règle journée non close (doctrine 9) : le
  -- statut déclaré doit être EXACTEMENT celui que la règle impose.
  SELECT max(d) INTO v_max_acc FROM unnest(v_acc_dates) d;
  FOR v_i IN 1 .. v_n LOOP
    IF v_ref_date IS NOT NULL THEN
      v_expected := CASE WHEN v_acc_dates[v_i] >= v_ref_date THEN 'provisional' ELSE 'staged' END;
    ELSIF v_bank = 'ORA' THEN
      -- ORA sans export_reference_date : dernier jour provisional (fail-closed).
      v_expected := CASE WHEN v_acc_dates[v_i] = v_max_acc THEN 'provisional' ELSE 'staged' END;
    ELSE
      v_expected := 'staged';
    END IF;
    IF v_req_status[v_i] <> v_expected THEN
      RAISE EXCEPTION 'DAILY_STMT_UNIT_STATUS_MISMATCH: p_units[%].requested_unit_status "%" contradicts the server-derived non-closed-day rule ("%") (fail-closed)', v_i - 1, v_req_status[v_i], v_expected;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- p_lines : validation par ligne (formats stricts + one_amount + jointure)
  -- ------------------------------------------------------------------
  FOR v_i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
    v_line := p_lines -> v_i;
    PERFORM public.daily_stmt_assert_object_keys(v_line, c_line_allowed, 'p_lines[' || v_i || ']');

    v_lidx := array_position(v_day_unit_ids, v_line ->> 'day_unit_id');
    IF v_lidx IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_ORPHAN: p_lines[%].day_unit_id does not reference any p_units entry (orphan line, fail-closed)', v_i;
    END IF;

    PERFORM public.daily_stmt_assert_hex64(v_line ->> 'daily_line_hash', 'p_lines[' || v_i || '].daily_line_hash');
    v_pair := v_lidx || '|' || (v_line ->> 'daily_line_hash');
    IF v_pair = ANY (v_seen_pairs) THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_HASH_DUPLICATE: p_lines[%].daily_line_hash duplicated within its unit (ordinal bug upstream, fail-closed)', v_i;
    END IF;
    v_seen_pairs := v_seen_pairs || v_pair;

    IF coalesce(v_line ->> 'daily_occurrence_ordinal', '') !~ '^[0-9]+$'
       OR (v_line ->> 'daily_occurrence_ordinal')::integer < 1 THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_ORDINAL: p_lines[%].daily_occurrence_ordinal must be an integer >= 1 (fail-closed)', v_i;
    END IF;
    IF coalesce(v_line ->> 'source_line_index', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_SOURCE_INDEX: p_lines[%].source_line_index must be an integer >= 0 (fail-closed)', v_i;
    END IF;

    IF public.daily_stmt_parse_date_strict(v_line ->> 'accounting_date') <> v_acc_dates[v_lidx] THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_DATE_MISMATCH: p_lines[%].accounting_date does not equal its unit''s accounting_date (fail-closed)', v_i;
    END IF;
    IF v_line ->> 'value_date' IS NOT NULL THEN
      PERFORM public.daily_stmt_parse_date_strict(v_line ->> 'value_date');
    END IF;

    IF nullif(btrim(coalesce(v_line ->> 'description_sanitized', '')), '') IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_DESCRIPTION_REQUIRED: p_lines[%].description_sanitized is required (fail-closed)', v_i;
    END IF;

    v_direction := v_line ->> 'direction';
    IF v_direction IS NULL OR v_direction NOT IN ('debit', 'credit') THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_DIRECTION: p_lines[%].direction must be debit or credit (fail-closed)', v_i;
    END IF;

    v_signed := public.daily_stmt_parse_amount_strict(v_line ->> 'signed_amount');
    IF v_signed IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_SIGNED_REQUIRED: p_lines[%].signed_amount is required (fail-closed)', v_i;
    END IF;
    v_debit  := public.daily_stmt_parse_amount_strict(v_line ->> 'debit_amount');
    v_credit := public.daily_stmt_parse_amount_strict(v_line ->> 'credit_amount');
    PERFORM public.daily_stmt_parse_amount_strict(v_line ->> 'running_balance');

    -- Miroir lines_staging_v2_one_amount (message stable pour les tests).
    IF NOT (
      (v_direction = 'debit'  AND v_debit  IS NOT NULL AND v_credit IS NULL
        AND v_signed < 0 AND abs(v_signed) = v_debit) OR
      (v_direction = 'credit' AND v_credit IS NOT NULL AND v_debit  IS NULL
        AND v_signed > 0 AND v_signed = v_credit)
    ) THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_ONE_AMOUNT: p_lines[%] violates the direction/amount/sign coherence (lines_staging_v2_one_amount mirror, fail-closed)', v_i;
    END IF;

    IF btrim(coalesce(v_line ->> 'currency', '')) <> v_currency THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_CURRENCY_MISMATCH: p_lines[%].currency does not equal p_attempt.currency (fail-closed)', v_i;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Croisements unité <-> lignes : comptes + day_content_hash recalculé.
  -- ------------------------------------------------------------------
  FOR v_i IN 1 .. v_n LOOP
    SELECT array_agg(l.value ->> 'daily_line_hash')
    INTO v_unit_hashes
    FROM jsonb_array_elements(p_lines) l
    WHERE l.value ->> 'day_unit_id' = v_day_unit_ids[v_i];

    IF coalesce(array_length(v_unit_hashes, 1), 0) <> v_line_counts[v_i] THEN
      RAISE EXCEPTION 'DAILY_STMT_LINE_COUNT: p_units[%] declares line_count % but received % p_lines (fail-closed)',
        v_i - 1, v_line_counts[v_i], coalesce(array_length(v_unit_hashes, 1), 0);
    END IF;
    IF public.daily_stmt_day_content_hash(v_day_unit_ids[v_i], v_unit_hashes)
       <> v_content_hashes[v_i] THEN
      RAISE EXCEPTION 'DAILY_STMT_CONTENT_HASH_MISMATCH: p_units[%].day_content_hash does not match the SQL recomputation over its own lines (fail-closed)', v_i - 1;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Écritures : attempt, puis arbitrage R1/R2/R3 par unité SOUS VERROU.
  -- ------------------------------------------------------------------
  INSERT INTO public.daily_statement_export_attempts (
    created_by, requested_mode, source_format, bank, currency,
    account_fingerprint, account_number_masked, source_file_name_redacted,
    raw_text_hash, export_period_start, export_period_end, statement_date,
    export_reference_date, parser_validation_status, errors_count,
    warnings_count, runtime_version, parser_version, ingestion_ready,
    bridge_guard_passed, period_days, backfill_grant_reference, units_total
  ) VALUES (
    v_actor, v_mode, v_source_format, v_bank, v_currency,
    v_fp, v_masked, v_file_name,
    v_rth, v_period_start, v_period_end, v_stmt_date,
    v_ref_date, v_parser_status, v_errors_count,
    v_warnings_count, nullif(btrim(coalesce(p_attempt ->> 'runtime_version', '')), ''),
    nullif(btrim(coalesce(p_attempt ->> 'parser_version', '')), ''), v_ingestion_ready,
    v_bridge, v_period_days, v_grant, v_n
  )
  RETURNING id INTO v_attempt_id;

  PERFORM public.daily_stmt_append_audit_event(
    v_actor, v_attempt_id, NULL, NULL, NULL, v_rth,
    'attempt_received', NULL, NULL,
    'daily statement export deposit received',
    jsonb_build_object('requested_mode', v_mode, 'units_total', v_n,
                       'period_days', v_period_days)
  );
  IF v_mode = 'backfill' THEN
    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_attempt_id, NULL, NULL, NULL, v_rth,
      'backfill_deposit', NULL, NULL,
      'backfill deposit under explicit grant',
      jsonb_build_object('backfill_grant_reference', v_grant,
                         'period_days', v_period_days, 'units_total', v_n)
    );
  END IF;

  -- Verrous PAR JOURNÉE en ordre trié (anti-deadlock entre dépôts recouvrants).
  FOR v_lock_id IN SELECT h FROM unnest(v_day_unit_ids) h ORDER BY h COLLATE "C" LOOP
    PERFORM public.daily_stmt_acquire_day_lock(v_lock_id);
  END LOOP;

  FOR v_i IN 1 .. v_n LOOP
    v_active_id := NULL;

    IF v_req_status[v_i] = 'provisional' THEN
      -- D-0H-4 : hors arbitrage R1/R2/R3, jamais promouvable.
      v_final := 'provisional';
    ELSE
      SELECT * INTO v_active
      FROM public.daily_statement_units_canonical
      WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'ingested';

      IF FOUND AND v_active.active_day_content_hash = v_content_hashes[v_i] THEN
        v_final := 'duplicate';                 -- R1 : journée identique.
        v_active_id := v_active.id;
      ELSIF FOUND THEN
        v_final := 'conflict';                  -- R2 : contenu divergent.
        v_active_id := v_active.id;
      ELSE
        -- R3 : un daily_line_hash encore ACTIF sous une AUTRE journée.
        SELECT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_lines) l
          JOIN public.daily_statement_lines_canonical lc
            ON lc.daily_line_hash = l.value ->> 'daily_line_hash' AND lc.is_active
          WHERE l.value ->> 'day_unit_id' = v_day_unit_ids[v_i]
            AND lc.day_unit_id <> v_day_unit_ids[v_i]
        ) INTO v_overlap;
        v_final := CASE WHEN v_overlap THEN 'needs_review' ELSE 'staged' END;
      END IF;
    END IF;

    v_unit := p_units -> (v_i - 1);
    INSERT INTO public.daily_statement_units_staging (
      attempt_id, day_unit_id, bank, account_fingerprint, currency,
      accounting_date, day_content_hash, line_count, day_total_debits,
      day_total_credits, opening_balance_derived, closing_balance_derived,
      aggregates_status, validation_status, status, created_by
    ) VALUES (
      v_attempt_id, v_day_unit_ids[v_i], v_bank, v_fp, v_currency,
      v_acc_dates[v_i], v_content_hashes[v_i], v_line_counts[v_i],
      public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_debits'),
      public.daily_stmt_parse_amount_strict(v_unit ->> 'day_total_credits'),
      public.daily_stmt_parse_amount_strict(v_unit ->> 'opening_balance_derived'),
      public.daily_stmt_parse_amount_strict(v_unit ->> 'closing_balance_derived'),
      v_unit ->> 'aggregates_status', v_unit ->> 'validation_status',
      v_final, v_actor
    )
    RETURNING id INTO v_staging_unit_id;

    -- R1 duplicate : AUCUNE ligne stagée (le contenu identique vit déjà en
    -- canonical — ne pas dupliquer des libellés sensibles). Tous les autres
    -- statuts conservent leurs lignes (conflict = matière du futur supersede).
    IF v_final <> 'duplicate' THEN
      FOR v_line IN
        SELECT l.value FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS l(value, ord)
        WHERE l.value ->> 'day_unit_id' = v_day_unit_ids[v_i]
        ORDER BY l.ord
      LOOP
        INSERT INTO public.daily_statement_lines_staging (
          staging_unit_id, attempt_id, day_unit_id, daily_line_hash,
          daily_occurrence_ordinal, source_line_index, accounting_date,
          value_date, description_sanitized, debit_amount, credit_amount,
          signed_amount, running_balance, direction, currency
        ) VALUES (
          v_staging_unit_id, v_attempt_id, v_day_unit_ids[v_i],
          v_line ->> 'daily_line_hash',
          (v_line ->> 'daily_occurrence_ordinal')::integer,
          (v_line ->> 'source_line_index')::integer,
          v_acc_dates[v_i],
          CASE WHEN v_line ->> 'value_date' IS NULL THEN NULL
               ELSE public.daily_stmt_parse_date_strict(v_line ->> 'value_date') END,
          v_line ->> 'description_sanitized',
          public.daily_stmt_parse_amount_strict(v_line ->> 'debit_amount'),
          public.daily_stmt_parse_amount_strict(v_line ->> 'credit_amount'),
          public.daily_stmt_parse_amount_strict(v_line ->> 'signed_amount'),
          public.daily_stmt_parse_amount_strict(v_line ->> 'running_balance'),
          v_line ->> 'direction', btrim(v_line ->> 'currency')
        );
      END LOOP;
    END IF;

    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_attempt_id, v_staging_unit_id, v_active_id,
      v_day_unit_ids[v_i], v_rth,
      CASE v_final
        WHEN 'staged'       THEN 'unit_staged'
        WHEN 'provisional'  THEN 'unit_provisional_held'
        WHEN 'duplicate'    THEN 'unit_duplicate'
        WHEN 'conflict'     THEN 'unit_conflict'
        ELSE 'unit_needs_review'
      END,
      NULL, v_final,
      CASE v_final
        WHEN 'staged'       THEN 'daily unit staged'
        WHEN 'provisional'  THEN 'non-closed day held provisional (never promotable)'
        WHEN 'duplicate'    THEN 'exact duplicate of the active canonical day (R1)'
        WHEN 'conflict'     THEN 'same day_unit_id with different day_content_hash than active canonical (R2)'
        ELSE 'active daily_line_hash overlap with another day unit (R3)'
      END,
      jsonb_build_object('day_unit_id', v_day_unit_ids[v_i],
                         'day_content_hash', v_content_hashes[v_i],
                         'line_count', v_line_counts[v_i])
    );

    v_result_units := v_result_units || jsonb_build_object(
      'day_unit_id', v_day_unit_ids[v_i],
      'unit_status', v_final,
      'staging_unit_id', v_staging_unit_id,
      'active_canonical_unit_id', v_active_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'requested_mode', v_mode,
    'units', v_result_units
  );
END;
$$;

-- 4.2 promote_daily_statement_unit — admin seul, UNE unité journalière.
--     R1/R2/R3 re-vérifiés SOUS VERROU (état re-lu après acquisition).
--     Une unité provisional n'est JAMAIS promouvable (doctrine 9 + trigger).
CREATE OR REPLACE FUNCTION public.promote_daily_statement_unit(p_staging_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid;
  v_unit    public.daily_statement_units_staging%ROWTYPE;
  v_active  public.daily_statement_units_canonical%ROWTYPE;
  v_new_id  uuid;
  v_overlap boolean;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_ROLE_DENIED: admin role required (fail-closed)';
  END IF;

  SELECT * INTO v_unit
  FROM public.daily_statement_units_staging WHERE id = p_staging_unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_STAGING_NOT_FOUND (fail-closed)';
  END IF;

  PERFORM public.daily_stmt_acquire_day_lock(v_unit.day_unit_id);

  -- Re-lecture APRÈS verrou : l'état pré-verrou peut être périmé.
  SELECT * INTO v_unit
  FROM public.daily_statement_units_staging WHERE id = p_staging_unit_id;

  IF v_unit.status = 'provisional' THEN
    RAISE EXCEPTION 'DAILY_STMT_PROVISIONAL_NOT_PROMOTABLE: a non-closed day is never promotable (fail-closed)';
  END IF;
  IF v_unit.status <> 'staged' THEN
    RAISE EXCEPTION 'DAILY_STMT_PROMOTE_GATE: staging unit status % is not promotable (fail-closed)', v_unit.status;
  END IF;

  -- R1/R2 sous verrou.
  SELECT * INTO v_active
  FROM public.daily_statement_units_canonical
  WHERE day_unit_id = v_unit.day_unit_id AND status = 'ingested';

  IF FOUND AND v_active.active_day_content_hash = v_unit.day_content_hash THEN
    UPDATE public.daily_statement_units_staging
      SET status = 'duplicate' WHERE id = v_unit.id;
    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_unit.attempt_id, v_unit.id, v_active.id,
      v_unit.day_unit_id, NULL,
      'unit_duplicate', 'staged', 'duplicate',
      'promotion aborted: exact duplicate of active canonical day (R1)', NULL);
    RETURN jsonb_build_object('outcome', 'duplicate',
                              'active_canonical_unit_id', v_active.id);
  ELSIF FOUND THEN
    UPDATE public.daily_statement_units_staging
      SET status = 'conflict' WHERE id = v_unit.id;
    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_unit.attempt_id, v_unit.id, v_active.id,
      v_unit.day_unit_id, NULL,
      'unit_conflict', 'staged', 'conflict',
      'promotion aborted: active canonical day holds different content (R2)', NULL);
    RETURN jsonb_build_object('outcome', 'conflict',
                              'active_canonical_unit_id', v_active.id);
  END IF;

  -- R3 sous verrou : chevauchement de daily_line_hash actifs d'une autre journée.
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_statement_lines_staging ls
    JOIN public.daily_statement_lines_canonical lc
      ON lc.daily_line_hash = ls.daily_line_hash AND lc.is_active
    WHERE ls.staging_unit_id = v_unit.id
      AND lc.day_unit_id <> v_unit.day_unit_id
  ) INTO v_overlap;
  IF v_overlap THEN
    UPDATE public.daily_statement_units_staging
      SET status = 'needs_review' WHERE id = v_unit.id;
    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_unit.attempt_id, v_unit.id, NULL,
      v_unit.day_unit_id, NULL,
      'unit_needs_review', 'staged', 'needs_review',
      'promotion aborted: active daily_line_hash overlap with another day unit (R3)',
      jsonb_build_object('reason_code', 'daily_line_hash_scope_conflict'));
    RETURN jsonb_build_object('outcome', 'needs_review');
  END IF;

  v_new_id := gen_random_uuid();
  PERFORM public.daily_stmt_promote_unit_core(v_unit.id, v_new_id, v_actor);

  RETURN jsonb_build_object('outcome', 'promoted',
                            'canonical_unit_id', v_new_id);
END;
$$;

-- 4.3 supersede_daily_statement_unit — admin seul. Correction JOURNÉE PAR
--     JOURNÉE : remplace l'unité canonical active par une unité staging en
--     'conflict' du même day_unit_id. FK superseded_by différée ; jamais de
--     DELETE ; audit obligatoire.
CREATE OR REPLACE FUNCTION public.supersede_daily_statement_unit(
  p_old_canonical_unit_id uuid,
  p_new_staging_unit_id   uuid,
  p_reason                text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor            uuid;
  v_new_unit         public.daily_statement_units_staging%ROWTYPE;
  v_old              public.daily_statement_units_canonical%ROWTYPE;
  v_new_id           uuid;
  v_overlap          boolean;
  v_active_count     integer;
  v_old_active_lines integer;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_ROLE_DENIED: admin role required (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_assert_safe_reason(p_reason);

  SELECT * INTO v_new_unit
  FROM public.daily_statement_units_staging WHERE id = p_new_staging_unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_STAGING_NOT_FOUND (fail-closed)';
  END IF;

  PERFORM public.daily_stmt_acquire_day_lock(v_new_unit.day_unit_id);

  SELECT * INTO v_new_unit
  FROM public.daily_statement_units_staging WHERE id = p_new_staging_unit_id;
  IF v_new_unit.status <> 'conflict' THEN
    RAISE EXCEPTION 'DAILY_STMT_SUPERSEDE_GATE: new unit must be a recorded conflict (fail-closed)';
  END IF;

  -- Re-lecture du canonical visé SOUS VERROU LIGNE.
  SELECT * INTO v_old
  FROM public.daily_statement_units_canonical
  WHERE id = p_old_canonical_unit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_OLD_CANONICAL_NOT_FOUND (fail-closed)';
  END IF;
  IF v_old.status <> 'ingested' THEN
    RAISE EXCEPTION 'DAILY_STMT_STALE_CANONICAL: target is no longer the active canonical day (fail-closed)';
  END IF;
  IF v_old.day_unit_id <> v_new_unit.day_unit_id THEN
    RAISE EXCEPTION 'DAILY_STMT_SUPERSEDE_DAY_MISMATCH: not the same accounting day (fail-closed)';
  END IF;

  -- R1 : contenu identique => supersede sans objet, duplicate contrôlé.
  IF v_new_unit.day_content_hash = v_old.active_day_content_hash THEN
    UPDATE public.daily_statement_units_staging
      SET status = 'duplicate' WHERE id = v_new_unit.id;
    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_new_unit.attempt_id, v_new_unit.id, v_old.id,
      v_new_unit.day_unit_id, NULL,
      'unit_duplicate', 'conflict', 'duplicate',
      'supersede aborted: identical content to active canonical day', NULL);
    RETURN jsonb_build_object('outcome', 'duplicate',
                              'active_canonical_unit_id', v_old.id);
  END IF;

  -- R3 : chevauchement actif avec une AUTRE journée => résolution préalable.
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_statement_lines_staging ls
    JOIN public.daily_statement_lines_canonical lc
      ON lc.daily_line_hash = ls.daily_line_hash AND lc.is_active
    WHERE ls.staging_unit_id = v_new_unit.id
      AND lc.day_unit_id <> v_new_unit.day_unit_id
  ) INTO v_overlap;
  IF v_overlap THEN
    RAISE EXCEPTION 'DAILY_STMT_R3_ACTIVE_OVERLAP: resolve the other active day unit first (fail-closed)';
  END IF;

  v_new_id := gen_random_uuid();

  -- Bascule de l'ancien (FK superseded_by différée jusqu'au COMMIT), puis
  -- désactivation de ses lignes AVANT insertion des nouvelles (index partiel).
  UPDATE public.daily_statement_units_canonical
    SET status = 'superseded', superseded_by = v_new_id, superseded_at = now()
    WHERE id = v_old.id;
  UPDATE public.daily_statement_lines_canonical
    SET is_active = false
    WHERE canonical_unit_id = v_old.id AND is_active;

  PERFORM public.daily_stmt_append_audit_event(
    v_actor, v_new_unit.attempt_id, NULL, v_old.id,
    v_old.day_unit_id, NULL,
    'unit_superseded', 'ingested', 'superseded',
    p_reason, jsonb_build_object('resolution', 'superseded',
                                 'day_unit_id', v_old.day_unit_id));

  PERFORM public.daily_stmt_promote_unit_core(v_new_unit.id, v_new_id, v_actor);

  -- Postconditions (toute violation => exception => ROLLBACK TOTAL).
  SELECT count(*) INTO v_active_count
  FROM public.daily_statement_units_canonical
  WHERE day_unit_id = v_new_unit.day_unit_id AND status = 'ingested';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'DAILY_STMT_SUPERSEDE_POSTCONDITION: active canonical count <> 1 (rollback)';
  END IF;
  SELECT count(*) INTO v_old_active_lines
  FROM public.daily_statement_lines_canonical
  WHERE canonical_unit_id = v_old.id AND is_active;
  IF v_old_active_lines <> 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_SUPERSEDE_POSTCONDITION: superseded lines still active (rollback)';
  END IF;

  RETURN jsonb_build_object('outcome', 'superseded',
                            'old_canonical_unit_id', v_old.id,
                            'new_canonical_unit_id', v_new_id);
END;
$$;

-- ============================================================================
-- SECTION 5 — RLS (lecture seule par rôle ; écritures = RPC uniquement)
-- ============================================================================

ALTER TABLE public.daily_statement_export_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_units_staging   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_lines_staging   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_units_canonical ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_lines_canonical ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_import_events   ENABLE ROW LEVEL SECURITY;

-- Aucune policy INSERT/UPDATE/DELETE sur aucune table : défaut RLS = deny ;
-- les RPC SECURITY DEFINER (owner) ne sont pas soumises. Rôle user : aucune
-- policy => aucun accès (modèle v1 conservé).

CREATE POLICY "daily_statement_export_attempts_select"
  ON public.daily_statement_export_attempts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "daily_statement_units_staging_select"
  ON public.daily_statement_units_staging
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- Lignes staging : libellés sensibles => admin seul.
CREATE POLICY "daily_statement_lines_staging_select"
  ON public.daily_statement_lines_staging
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "daily_statement_units_canonical_select"
  ON public.daily_statement_units_canonical
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "daily_statement_lines_canonical_select"
  ON public.daily_statement_lines_canonical
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

CREATE POLICY "daily_statement_import_events_select"
  ON public.daily_statement_import_events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

-- ============================================================================
-- SECTION 6 — PRIVILÈGES TABLES (ceinture + bretelles)
-- ============================================================================

REVOKE ALL ON TABLE public.daily_statement_export_attempts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_statement_units_staging   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_statement_lines_staging   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_statement_units_canonical FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_statement_lines_canonical FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_statement_import_events   FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.daily_statement_export_attempts TO authenticated, service_role;
GRANT SELECT ON TABLE public.daily_statement_units_staging   TO authenticated, service_role;
GRANT SELECT ON TABLE public.daily_statement_lines_staging   TO authenticated, service_role;
GRANT SELECT ON TABLE public.daily_statement_units_canonical TO authenticated, service_role;
GRANT SELECT ON TABLE public.daily_statement_lines_canonical TO authenticated, service_role;
GRANT SELECT ON TABLE public.daily_statement_import_events   TO authenticated, service_role;

-- ============================================================================
-- SECTION 7 — PRIVILÈGES FONCTIONS
-- ============================================================================

-- 7.a Helpers internes : EXECUTE révoqué de TOUS les rôles applicatifs.
REVOKE ALL ON FUNCTION public.daily_stmt_parse_date_strict(text)                       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_parse_amount_strict(text)                     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_assert_hex64(text, text)                      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_assert_object_keys(jsonb, text[], text)       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_assert_no_forbidden_keys(jsonb, text)         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_assert_masked_account(text)                   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_assert_safe_file_name(text)                   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_assert_safe_reason(text)                      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_day_content_hash(text, text[])                FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_day_unit_id(text, text, text, text)           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_assert_safe_details(jsonb)                    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_append_audit_event(uuid, uuid, uuid, uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_acquire_day_lock(text)                        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_promote_unit_core(uuid, uuid, uuid)           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_assert_canonical_insert_allowed()             FROM PUBLIC, anon, authenticated, service_role;

-- 7.b RPC exposées : EXECUTE pour authenticated uniquement (le contrôle fin
--     est fait PAR RÔLE dans chaque fonction). service_role volontairement
--     NON accordé (doctrine E-2 : aucun compte technique comme acteur).
REVOKE ALL ON FUNCTION public.pre_ingest_daily_statement_units(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pre_ingest_daily_statement_units(jsonb, jsonb, jsonb, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.promote_daily_statement_unit(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.promote_daily_statement_unit(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.supersede_daily_statement_unit(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.supersede_daily_statement_unit(uuid, uuid, text) TO authenticated;

-- ============================================================================
-- FIN — DAILY-RPC-V2-MIGRATION-DRAFT-0H — MIGRATION CANDIDATE v2
-- ============================================================================
