-- ============================================================================
-- POC-BANK-STRUCTURED-EXPORTS-0P — révisé par 0R (corrections post-audit 0Q)
-- ============================================================================
-- DRAFT SQL — REVIEW ONLY — DO NOT APPLY
--
--   * Not a migration.
--   * Do not place this file in supabase/migrations.
--   * No live DB execution.
--   * Ce fichier sert uniquement de support de revue pour discuter la future
--     migration DB issue du design validé en 0O (CLOSED / PASS_DESIGN).
--   * Révision 0R : corrections issues de l'audit 0Q (line_hash vs supersede,
--     parser_validation_status nullable, UNIQUE(attempt_id) staging,
--     conversion dates DD/MM/YYYY, description_sanitized non anonymisé,
--     TEXT+CHECK recommandé v1, safe_details anti-raw, RPC et tests complétés).
--
-- HEAD canonique attendu (main) :
--   d26dfc6b4dc9233bc05ccbd9204e5f95531d2b9b
--
-- Rappels de sécurité données (invariants hérités des lots 0J/0K/0O) :
--   * no raw CSV        — jamais de texte CSV brut en base ;
--   * no raw bytes      — jamais d'octets bruts du fichier en base ;
--   * no full account   — jamais de numéro de compte complet en clair ;
--   * no full IBAN      — jamais d'IBAN complet en clair.
--   Seuls `account_fingerprint` (hash déterministe) et
--   `account_number_masked` (version masquée, ex: "****1234") sont admis.
--
-- Alignement avec le runtime TypeScript existant (Node-only, lots 0J→0N) :
--   * import_id       = identité logique du relevé
--                       (source_format, bank, account_fingerprint, période) ;
--   * raw_text_hash   = empreinte exacte du texte CSV décodé ;
--   * line_hash       = identité logique d'une ligne de transaction
--                       (import_id, dates, direction, montant, description
--                       canonicalisée, occurrenceOrdinal) — jamais dépendant
--                       de l'index de ligne ni du nom de fichier.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GARDE-FOU ANTI-EXÉCUTION ACCIDENTELLE
-- ----------------------------------------------------------------------------
-- Ce bloc est volontairement ACTIF : si quelqu'un exécute ce fichier par
-- erreur (psql -f, pipeline CI, supabase db push d'un fichier déplacé…),
-- l'exécution échoue immédiatement avant toute création d'objet.
DO $$
BEGIN
  RAISE EXCEPTION
    'POC-BANK-STRUCTURED-EXPORTS-0P: DRAFT REVIEW-ONLY — DO NOT APPLY. '
    'Ce fichier n''est pas une migration et ne doit jamais etre execute.';
END
$$;

-- ============================================================================
-- SECTION 2 — TYPES / ENUMS PROPOSÉS (DRAFT)
-- ============================================================================
-- RECOMMANDATION v1 (révision 0R) : TEXT + CHECK plutôt qu'enums Postgres.
--   * Les domaines de statuts sont encore mouvants en phase POC : une liste
--     TEXT + CHECK évolue par simple DROP/ADD CONSTRAINT, transactionnel et
--     rollbackable, alors qu'ALTER TYPE ne permet ni retrait ni renommage de
--     valeur et impose des restrictions d'usage en transaction. Objectif :
--     éviter des migrations ALTER TYPE inutiles pendant la phase POC.
--   * Les CREATE TYPE ci-dessous restent DOCUMENTAIRES : ils décrivent les
--     domaines de valeurs. Les enums restent une option future si le domaine
--     se stabilise (décision CTO au moment de la vraie migration).

-- 2.1 Statut d'une tentative d'import (cycle de vie complet).
-- Couvre le minimum requis par 0P :
--   received, rejected, pre_ingested, ingestion_ready, needs_review,
--   duplicate, conflict, ingested, superseded, failed.
CREATE TYPE structured_import_attempt_status AS ENUM (
  'received',        -- tentative reçue, rien décidé
  'rejected',        -- rejet fail-closed (parse invalide, unsupported, fingerprint absent…)
  'pre_ingested',    -- pré-ingestion OK, clés d'idempotence calculées
  'ingestion_ready', -- toutes les gates passées, promotable
  'needs_review',    -- anomalies non bloquantes, promotion humaine uniquement
  'duplicate',       -- doublon exact (même import_id + même raw_text_hash déjà canonical)
  'conflict',        -- même import_id mais raw_text_hash différent du canonical actif
  'ingested',        -- promu en canonical
  'superseded',      -- ancien import remplacé par une promotion plus récente
  'failed'           -- erreur technique pendant le traitement
);

-- 2.2 Statut de validation parser — aligné strictement sur le type TS
-- StructuredBankStatementStatus ('valid' | 'needs_review' | 'invalid' | 'unsupported').
CREATE TYPE structured_parser_validation_status AS ENUM (
  'valid',
  'needs_review',
  'invalid',
  'unsupported'
);

-- 2.3 Type d'événement d'audit (append-only).
CREATE TYPE structured_import_event_type AS ENUM (
  'attempt_received',
  'attempt_rejected',
  'attempt_failed',
  'pre_ingested',
  'marked_ingestion_ready',
  'marked_needs_review',
  'duplicate_detected',
  'conflict_detected',
  'review_requested',
  'promotion_requested',
  'promoted',
  'promotion_failed',
  'superseded',
  'status_changed'    -- filet de sécurité pour transitions non listées
);

-- 2.4 Statut de promotion (vue côté staging → canonical).
CREATE TYPE structured_promotion_status AS ENUM (
  'not_promoted',
  'promotion_pending',
  'promoted',
  'promotion_failed',
  'superseded'
);

-- 2.5 Statut de conflit (si retenu — sinon dérivable du statut attempt).
CREATE TYPE structured_conflict_status AS ENUM (
  'none',
  'raw_text_hash_conflict',   -- même import_id, contenu différent
  'line_hash_conflict',       -- ligne déjà canonical sous un autre relevé
  'resolved_keep_existing',   -- arbitrage humain : canonical existant conservé
  'resolved_superseded'       -- arbitrage humain : canonical existant remplacé
);

-- ============================================================================
-- SECTION 3 — TABLES DRAFT PROPOSÉES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3.A  bank_statement_import_attempts
-- ----------------------------------------------------------------------------
-- Rôle : tentative d'import / audit technique initial.
--   * Chaque dépôt de fichier CSV structuré crée UNE ligne, même en rejet.
--   * Les rejets et duplications restent visibles (pas de suppression).
--   * Ne stocke JAMAIS le CSV brut : uniquement hash, compteurs, statuts.
CREATE TABLE bank_statement_import_attempts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users (id),

  -- Provenance (métadonnées safe uniquement).
  source_format             text NOT NULL,          -- ex: 'structured_csv_v1'
  source_file_name_redacted text,                   -- nom de fichier expurgé (jamais de n° de compte dedans)
  bank                      text NOT NULL,          -- code banque normalisé (ex: 'BDK'), pas de donnée client

  -- Identité de compte — formes safe uniquement.
  account_fingerprint       text,                   -- hash déterministe ; NULL uniquement si rejet précoce
  account_number_masked     text,                   -- ex: '****1234' ; jamais le numéro complet

  -- Clés d'idempotence (voir SECTION 5).
  -- raw_text_hash est NULLABLE : le runtime 0M peut rejeter une entrée AVANT
  -- décodage (non-CSV, erreur runtime contrôlée avant pré-ingestion) ; la
  -- tentative doit rester journalisable sans hash disponible.
  raw_text_hash             text,                   -- empreinte exacte du texte CSV décodé ; NULL si rejet avant décodage
  import_id                 text,                   -- identité logique ; NULL si statut invalid/unsupported

  -- Résultat parser / pré-ingestion.
  -- NULLABLE (révision 0R) : le runtime 0M rejette certains dépôts AVANT toute
  -- validation parser complète (nom de fichier non .csv rejeté avant décodage,
  -- échec runtime inattendu) ; dans ces cas aucun importResult n'existe, donc
  -- aucun statut parser. NULL = jamais parsé. Fabriquer 'invalid'/'unsupported'
  -- ici serait une traçabilité artificielle (interdite, SECURITY_CONTRACT §7).
  parser_validation_status  structured_parser_validation_status,
  success                   boolean NOT NULL DEFAULT false,  -- parsing techniquement abouti
  ingestion_ready           boolean NOT NULL DEFAULT false,  -- toutes les gates passées
  rejected_reason           text,                   -- code de rejet safe (pas de contenu CSV)
  errors_count              integer NOT NULL DEFAULT 0 CHECK (errors_count >= 0),
  warnings_count            integer NOT NULL DEFAULT 0 CHECK (warnings_count >= 0),

  status                    structured_import_attempt_status NOT NULL DEFAULT 'received',

  -- Traçabilité des versions (utile pour rejouer/diagnostiquer).
  runtime_version           text,
  parser_version            text,

  -- Garde-fous colonne-niveau.
  CONSTRAINT attempts_masked_never_full_account
    CHECK (account_number_masked IS NULL OR account_number_masked LIKE '%*%'),
  CONSTRAINT attempts_ingestion_ready_requires_success
    CHECK (NOT ingestion_ready OR success),
  CONSTRAINT attempts_ingestion_ready_requires_import_id
    CHECK (NOT ingestion_ready OR import_id IS NOT NULL),
  CONSTRAINT attempts_ingestion_ready_requires_fingerprint
    CHECK (NOT ingestion_ready OR account_fingerprint IS NOT NULL),
  -- Compense la nullabilité (révision 0R) : une tentative promotable a
  -- forcément traversé le parser, donc porte un statut de validation.
  CONSTRAINT attempts_ingestion_ready_requires_parser_status
    CHECK (NOT ingestion_ready OR parser_validation_status IS NOT NULL),
  CONSTRAINT attempts_rejected_has_reason
    CHECK (status <> 'rejected' OR rejected_reason IS NOT NULL),
  -- Hash requis dès que la tentative dépasse la phase de décodage : seuls les
  -- statuts pré-décodage ou d'échec peuvent rester sans raw_text_hash.
  -- NOTE revue : à affiner éventuellement avec un statut plus explicite
  -- (ex. 'rejected_before_decode') si la distinction doit être requêtable.
  CONSTRAINT attempts_hash_required_after_decode
    CHECK (
      raw_text_hash IS NOT NULL
      OR status IN ('received', 'rejected', 'failed')
    )
);

-- ANTI-RAW (invariant structurel, à vérifier aussi par test DB, cf. SECTION 8) :
--   cette table NE DOIT JAMAIS recevoir de colonne raw_text, raw_csv,
--   raw_bytes, raw_content, file_content ou équivalent.

-- ----------------------------------------------------------------------------
-- 3.B  bank_statement_staging
-- ----------------------------------------------------------------------------
-- Rôle : header de relevé en staging, avant promotion canonical.
--   * 1 attempt réussie → 0..1 ligne de staging.
--   * Zone de quarantaine : relit/vérifie/refuse sans toucher au canonical.
CREATE TABLE bank_statement_staging (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id                uuid NOT NULL REFERENCES bank_statement_import_attempts (id),
  import_id                 text NOT NULL,
  raw_text_hash             text NOT NULL,

  bank                      text NOT NULL,
  account_fingerprint       text NOT NULL,          -- obligatoire en staging (gate pré-promotion)
  account_number_masked     text,
  currency                  text NOT NULL,          -- code ISO 4217, ex: 'XOF'

  -- Période et dates du relevé.
  period_start_date         date NOT NULL,
  period_end_date           date NOT NULL,
  statement_date            date,

  -- Agrégats déclarés par le relevé (montants en numeric, jamais float).
  opening_balance           numeric(18, 2) NOT NULL,
  total_debits              numeric(18, 2) NOT NULL,
  total_credits             numeric(18, 2) NOT NULL,
  closing_balance           numeric(18, 2) NOT NULL,

  -- Résultat de validation arithmétique.
  validation_status         structured_parser_validation_status NOT NULL,
  calculated_closing        numeric(18, 2),         -- opening + credits - debits recalculé
  discrepancy               numeric(18, 2),         -- closing déclaré - closing recalculé
  line_count                integer NOT NULL CHECK (line_count >= 0),

  status                    structured_promotion_status NOT NULL DEFAULT 'not_promoted',
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users (id),

  -- Cardinalité contractuelle (révision 0R) : « 1 attempt réussie => 0..1
  -- staging » était promis en commentaire mais non contraint ; sans UNIQUE,
  -- plusieurs stagings par attempt rendraient la promotion ambiguë.
  CONSTRAINT staging_one_per_attempt UNIQUE (attempt_id),
  CONSTRAINT staging_period_coherent
    CHECK (period_end_date >= period_start_date),
  CONSTRAINT staging_masked_never_full_account
    CHECK (account_number_masked IS NULL OR account_number_masked LIKE '%*%')
);

-- ----------------------------------------------------------------------------
-- 3.C  bank_statement_lines_staging
-- ----------------------------------------------------------------------------
-- Rôle : lignes de transaction en staging, identifiées par line_hash.
CREATE TABLE bank_statement_lines_staging (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_statement_id      uuid NOT NULL REFERENCES bank_statement_staging (id) ON DELETE CASCADE,
  attempt_id                uuid NOT NULL REFERENCES bank_statement_import_attempts (id),
  import_id                 text NOT NULL,
  line_hash                 text NOT NULL,

  source_line_index         integer NOT NULL CHECK (source_line_index >= 0),
  transaction_date          date NOT NULL,
  value_date                date,

  -- Libellé bancaire NORMALISÉ, PAS ANONYMISÉ (révision 0R — précision
  -- honnête) : la sanitization runtime actuelle (parser 0B) se limite à un
  -- collapse d'espaces + trim. Le libellé reste une donnée SENSIBLE : il peut
  -- contenir noms de contreparties, références, numéros de chèques, voire des
  -- identifiants de comptes tiers présents dans le libellé d'origine.
  -- Interdits stricts : jamais la ligne CSV brute complète, jamais le numéro
  -- de compte complet ni l'IBAN complet du relevé (masqués en amont).
  -- Conséquence RLS (SECTION 6) : accès aux lignes minimal et fail-closed.
  description_sanitized     text NOT NULL,

  debit_amount              numeric(18, 2),
  credit_amount             numeric(18, 2),
  signed_amount             numeric(18, 2) NOT NULL, -- négatif = débit, positif = crédit
  running_balance           numeric(18, 2),
  direction                 text NOT NULL CHECK (direction IN ('debit', 'credit')),
  currency                  text NOT NULL,

  status                    structured_promotion_status NOT NULL DEFAULT 'not_promoted',
  created_at                timestamptz NOT NULL DEFAULT now(),

  -- Exactement un des deux montants renseigné, cohérent avec direction.
  CONSTRAINT lines_staging_one_amount
    CHECK (
      (direction = 'debit'  AND debit_amount  IS NOT NULL AND credit_amount IS NULL) OR
      (direction = 'credit' AND credit_amount IS NOT NULL AND debit_amount  IS NULL)
    ),
  -- Un même line_hash ne peut apparaître qu'une fois par relevé staging.
  CONSTRAINT lines_staging_unique_per_statement
    UNIQUE (staging_statement_id, line_hash)
);

-- ----------------------------------------------------------------------------
-- 3.D  bank_statement_canonical
-- ----------------------------------------------------------------------------
-- Rôle : relevés promus (source de vérité).
--   * Écrit UNIQUEMENT par la future RPC de promotion (SECURITY DEFINER).
--   * Jamais d'UPDATE/DELETE direct : correction = supersede + nouvelle promotion.
CREATE TABLE bank_statement_canonical (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoted_from_staging_id  uuid NOT NULL REFERENCES bank_statement_staging (id),
  import_id                 text NOT NULL,
  active_raw_text_hash      text NOT NULL,          -- hash du contenu effectivement promu

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

  validation_status         structured_parser_validation_status NOT NULL,
  status                    structured_import_attempt_status NOT NULL DEFAULT 'ingested',

  ingested_at               timestamptz NOT NULL DEFAULT now(),
  ingested_by               uuid REFERENCES auth.users (id),

  -- Chaîne de remplacement (option retenue en 0O : supersede plutôt que delete).
  -- (révision 0R) Dans la vraie migration, cette self-FK doit être déclarée
  -- DEFERRABLE INITIALLY DEFERRED : la séquence normative 7.7 référence l'id
  -- du nouveau canonical AVANT son insertion (vérification FK au COMMIT).
  superseded_by             uuid REFERENCES bank_statement_canonical (id),
  superseded_at             timestamptz,

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

-- ----------------------------------------------------------------------------
-- 3.E  bank_statement_lines_canonical
-- ----------------------------------------------------------------------------
-- Rôle : lignes promues (source de vérité, immuables).
CREATE TABLE bank_statement_lines_canonical (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_statement_id    uuid NOT NULL REFERENCES bank_statement_canonical (id),
  import_id                 text NOT NULL,
  line_hash                 text NOT NULL,

  transaction_date          date NOT NULL,
  value_date                date,
  -- Même statut de sensibilité qu'en 3.C (révision 0R) : libellé normalisé,
  -- PAS anonymisé — jamais la ligne CSV brute, accès RLS minimal.
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

-- ----------------------------------------------------------------------------
-- 3.F  bank_statement_import_events
-- ----------------------------------------------------------------------------
-- Rôle : audit append-only spécifique à l'import CSV structuré.
--   * INSERT uniquement — jamais d'UPDATE ni de DELETE (policies SECTION 6).
--   * safe_message / safe_details : strictement safe — jamais de CSV brut,
--     jamais de payload de transaction complet, jamais de numéro de compte.
CREATE TABLE bank_statement_import_events (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  actor_id                  uuid REFERENCES auth.users (id),   -- NULL = runtime système

  -- Références facultatives selon l'étape du cycle de vie.
  attempt_id                uuid REFERENCES bank_statement_import_attempts (id),
  staging_statement_id      uuid REFERENCES bank_statement_staging (id),
  canonical_statement_id    uuid REFERENCES bank_statement_canonical (id),
  import_id                 text,
  raw_text_hash             text,

  event_type                structured_import_event_type NOT NULL,
  previous_status           text,
  new_status                text,

  safe_message              text,    -- phrase courte, codes d'erreur, compteurs — rien de brut
  safe_details              jsonb,   -- clés whitelistées uniquement (compteurs, hashes, codes)

  -- Un événement doit référencer au moins un objet du pipeline.
  CONSTRAINT events_reference_something
    CHECK (
      attempt_id IS NOT NULL OR
      staging_statement_id IS NOT NULL OR
      canonical_statement_id IS NOT NULL
    ),
  -- Ceinture structurelle anti-raw (révision 0R) : refus au niveau table des
  -- clés top-level interdites. Limite connue : ce CHECK ne couvre que le
  -- premier niveau de clés JSONB ; la profondeur (objets imbriqués) est
  -- couverte par la whitelist de la RPC 7.8 + tests négatifs (T15).
  CONSTRAINT events_safe_details_no_banned_keys
    CHECK (
      safe_details IS NULL
      OR NOT (safe_details ?| ARRAY[
        'raw_csv', 'raw_text', 'raw_bytes', 'raw_content', 'file_content',
        'account_number', 'iban'
      ])
    )
);

-- ANTI-RAW / DOCTRINE safe_details (renforcée en révision 0R) :
--   * WHITELIST STRICTE de clés autorisées, appliquée par la RPC 7.8 AVANT
--     tout INSERT (toute clé hors whitelist => exception fail-closed).
--     Whitelist proposée (à figer en revue) : reason_code, errors_count,
--     warnings_count, line_count, import_id, raw_text_hash, line_hash,
--     previous_status, new_status, resolution, parser_version,
--     runtime_version.
--   * INTERDITS ABSOLUS (clés ET valeurs) : raw_csv, raw_text, raw_bytes,
--     raw_content, file_content, account_number, iban, ainsi que tout payload
--     transactionnel complet (ligne de relevé recopiée, libellé intégral).
--   * ÉCRITURE UNIQUEMENT via la RPC safe 7.8 : aucune policy INSERT directe
--     pour les rôles applicatifs sur cette table.
--   * TESTS DB NÉGATIFS attendus (T15) : clé bannie => échec CHECK + refus
--     RPC ; clé non bannie mais hors whitelist => refus RPC.

-- ============================================================================
-- SECTION 4 — CONTRAINTES / INDEXES DRAFT
-- ============================================================================

-- 4.1 Unicité canonical : un seul relevé ACTIF par import_id.
--     Index partiel : les 'superseded' n'entrent pas en collision, ce qui
--     permet l'historique de remplacements.
CREATE UNIQUE INDEX uq_canonical_active_import_id
  ON bank_statement_canonical (import_id)
  WHERE status = 'ingested';

-- 4.2 Unicité canonical des lignes — RÉVISÉE EN 0R (audit 0Q, point bloquant).
--     L'unicité GLOBALE initialement proposée
--       (CREATE UNIQUE INDEX ... ON bank_statement_lines_canonical (line_hash))
--     est INCOMPATIBLE avec le workflow supersede et est ABANDONNÉE :
--     line_hash est déterministe sur (import_id, dates, direction, montant
--     signé, devise, description canonicalisée, occurrenceOrdinal) et ne
--     dépend PAS du relevé canonical porteur. Un supersede re-promeut le même
--     import_id corrigé : toute ligne inchangée reproduit le même line_hash
--     que celle — conservée, append-only — de l'ancien canonical superseded,
--     donc l'unicité globale rendrait tout supersede impossible.
--
--     Invariant conservé, exprimable immédiatement : un line_hash unique PAR
--     relevé canonical. Deux lignes métier strictement identiques d'un même
--     relevé restent différenciées par occurrenceOrdinal (socle 0H/0I) et
--     produisent deux line_hash distincts.
CREATE UNIQUE INDEX uq_lines_canonical_line_hash_per_statement
  ON bank_statement_lines_canonical (canonical_statement_id, line_hash);

--     L'invariant « un line_hash n'est ACTIF qu'une seule fois » (R3) doit
--     être garanti par l'UNE des deux options sûres suivantes — choix à
--     trancher au design de la vraie migration ; NE PAS revenir à l'unicité
--     globale :
--
--     Option A — statut dénormalisé + index partiel actif :
--       * colonne is_active boolean NOT NULL sur bank_statement_lines_canonical,
--         maintenue EXCLUSIVEMENT par les RPC promote/supersede, dans la même
--         transaction que la bascule du relevé parent ;
--       * CREATE UNIQUE INDEX uq_lines_canonical_line_hash_active
--           ON bank_statement_lines_canonical (line_hash) WHERE is_active;
--       * garantie structurelle forte ; coût : dénormalisation + discipline
--         RPC (une divergence is_active/statut parent doit être testée, T13).
--
--     Option B — enforcement transactionnel dans les RPC SECURITY DEFINER :
--       * aucune contrainte globale en schéma ; la RPC de promotion vérifie,
--         SOUS VERROU (7.9), qu'aucun canonical ACTIF ne contient déjà l'un
--         des line_hash à promouvoir (R3) avant d'insérer ;
--       * schéma plus simple ; la garantie repose entièrement sur la RPC et
--         le locking : tests de concurrence obligatoires (T16).

-- 4.3 Indexes de recherche attempts.
--     Index partiel : raw_text_hash est nullable (rejets avant décodage) ;
--     on n'indexe que les tentatives disposant d'un hash.
CREATE INDEX idx_attempts_raw_text_hash
  ON bank_statement_import_attempts (raw_text_hash)
  WHERE raw_text_hash IS NOT NULL;
CREATE INDEX idx_attempts_import_id     ON bank_statement_import_attempts (import_id);
CREATE INDEX idx_attempts_status        ON bank_statement_import_attempts (status);

-- 4.4 Indexes staging / lignes.
--     (révision 0R) idx_staging_attempt_id supprimé : la contrainte
--     staging_one_per_attempt (UNIQUE attempt_id, SECTION 3.B) porte déjà
--     l'index sous-jacent.
CREATE INDEX idx_lines_staging_import_id    ON bank_statement_lines_staging (import_id);
CREATE INDEX idx_lines_canonical_import_id  ON bank_statement_lines_canonical (import_id);

-- 4.5 Contrainte anti-promote (PSEUDO-SQL — cross-table, donc non exprimable
--     en simple CHECK ; à implémenter dans la RPC de promotion et/ou par
--     trigger BEFORE INSERT sur bank_statement_canonical) :
--
--       CREATE FUNCTION assert_attempt_ingestion_ready() ...
--         -- lève une exception si l'attempt liée au staging promu
--         -- a ingestion_ready = false OU status NOT IN ('ingestion_ready')
--         -- (exception : promotion humaine explicite d'un 'needs_review',
--         --  tracée par un event 'promotion_requested' avec actor_id non NULL).
--       CREATE TRIGGER trg_canonical_anti_promote
--         BEFORE INSERT ON bank_statement_canonical
--         FOR EACH ROW EXECUTE FUNCTION assert_attempt_ingestion_ready();

-- 4.6 Contrainte anti-raw (structurelle) :
--     Aucune table de ce draft ne possède — et ne doit jamais recevoir —
--     de colonne raw_csv, raw_text, raw_bytes, raw_content, file_content,
--     account_number (complet) ou iban (complet).
--     Garde-fou proposé : test DB (SECTION 8) qui interroge
--     information_schema.columns et échoue si un de ces noms apparaît
--     sur les 6 tables du pipeline.

-- ============================================================================
-- SECTION 5 — IDEMPOTENCE (RÈGLES VALIDÉES 0O — BLOC NORMATIF)
-- ============================================================================
--
-- R1. Même import_id + même raw_text_hash, déjà canonical actif :
--       => duplicate EXACT. Attempt marquée 'duplicate' + event
--          'duplicate_detected'. AUCUNE nouvelle promotion, aucun staging.
--
-- R2. Même import_id + raw_text_hash DIFFÉRENT du canonical actif :
--       => conflict. Attempt marquée 'conflict' + event 'conflict_detected'.
--          JAMAIS d'upsert automatique : résolution humaine obligatoire
--          (keep existing, ou supersede via RPC dédiée).
--
-- R3. line_hash déjà présent en canonical :
--       - sous le MÊME import_id  => duplicate line (cohérent avec R1) ;
--       - sous un AUTRE import_id => conflict de périmètre (chevauchement de
--         périodes ou double export) — à router vers 'needs_review'.
--
-- R4. account_fingerprint absent ou vide :
--       => rejet fail-closed AVANT toute promotion (et avant calcul
--          d'import_id, conformément au runtime TS : accountFingerprint est
--          obligatoire, sans fallback silencieux). Attempt 'rejected'.
--
-- R5. parser_validation_status = 'needs_review' :
--       => staging possible UNIQUEMENT si opt-in explicite ;
--          promotion HUMAINE seulement (jamais automatique) ;
--          import_id calculable (le TS le calcule pour 'valid' et
--          'needs_review' uniquement).
--
-- R6. parser_validation_status = 'invalid' ou 'unsupported' :
--       => attempt + event SEULEMENT. Jamais de staging, jamais de canonical,
--          pas d'import_id (aligné sur le TS : importId jamais calculé pour
--          ces statuts).
--
-- ============================================================================
-- SECTION 5B — CONVERSION DES DATES dd/mm/yyyy -> date (AJOUT 0R — NORMATIF)
-- ============================================================================
--
-- Le parser TS (0B) et les clés d'idempotence (0H) manipulent TOUTES les
-- dates comme des chaînes 'dd/mm/yyyy' (DATE_PATTERN ^\d{2}/\d{2}/\d{4}$) :
-- operationDate, valueDate, periodStart, periodEnd, statementDate.
--
-- D1. Toute écriture vers une colonne `date` de ce schéma DOIT convertir
--     EXPLICITEMENT : to_date(value, 'DD/MM/YYYY').
--     JAMAIS de cast implicite ('03/07/2026'::date) : il dépend du DateStyle
--     de session (défaut Postgres 'ISO, MDY' => '03/07/2026' lu 7 mars) et
--     fausse SILENCIEUSEMENT toute date dont le jour est <= 12.
--
-- D2. Validation round-trip obligatoire (to_date reste tolérant sur certains
--     formats/débordements) :
--       to_char(to_date(value, 'DD/MM/YYYY'), 'DD/MM/YYYY') = value
--     sinon rejet fail-closed (aucune correction silencieuse — cohérent avec
--     SECURITY_CONTRACT §7 : pas de dates artificielles). Implémentation
--     recommandée : une fonction SQL stricte dédiée (IMMUTABLE) centralisant
--     D1 + D2, utilisée par toutes les RPC d'écriture.
--
-- D3. Cas de test attendus (SECTION 8, T12) :
--       '03/07/2026' => 2026-07-03 (jamais 2026-03-07), quel que soit le
--                       DateStyle de la session ;
--       '31/02/2026' => rejet (date inexistante) ;
--       '2026-07-03' => rejet (format inattendu : pas de tolérance) ;
--       '3/7/2026'   => rejet round-trip (le pattern TS exige 2 chiffres).
--
-- D4. Conséquence assumée : line_hash est calculé côté runtime sur la chaîne
--     'dd/mm/yyyy' (et sur la représentation JS du montant). Il n'est PAS
--     recalculable depuis les colonnes DB (dates converties, numeric
--     reformaté) : c'est un identifiant opaque produit par le runtime,
--     vérifiable uniquement en repassant le texte source dans le runtime.
--
-- ============================================================================
-- SECTION 6 — PSEUDO-RLS / AUTH (DRAFT — NON APPLIQUÉ)
-- ============================================================================
-- Hypothèse : fonction existante de rôle applicatif, ex. has_role(uid, role)
-- avec rôles 'admin' | 'manager' | 'auditor' | 'user' (à confirmer contre
-- SECURITY_CONTRACT.md lors de la vraie migration).
--
-- ALTER TABLE bank_statement_import_attempts  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bank_statement_staging          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bank_statement_lines_staging    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bank_statement_canonical        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bank_statement_lines_canonical  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bank_statement_import_events    ENABLE ROW LEVEL SECURITY;
--
-- admin :
--   * SELECT sur tout ;
--   * promotion / supersede uniquement via RPC (pas d'INSERT/UPDATE direct
--     sur canonical, même pour admin).
--   -- CREATE POLICY admin_read_all ON <chaque table>
--   --   FOR SELECT USING (has_role(auth.uid(), 'admin'));
--
-- manager :
--   * INSERT attempts (dépôt d'imports) ;
--   * SELECT attempts + headers staging (PAS les lignes par défaut) ;
--   * peut demander une review (event 'review_requested' via RPC).
--   -- CREATE POLICY manager_insert_attempts ON bank_statement_import_attempts
--   --   FOR INSERT WITH CHECK (has_role(auth.uid(), 'manager'));
--   -- CREATE POLICY manager_read_attempts ON bank_statement_import_attempts
--   --   FOR SELECT USING (has_role(auth.uid(), 'manager'));
--   -- CREATE POLICY manager_read_staging_headers ON bank_statement_staging
--   --   FOR SELECT USING (has_role(auth.uid(), 'manager'));
--
-- auditor :
--   * SELECT attempts / events / canonical (headers + lignes) ;
--   * AUCUNE écriture nulle part.
--
-- user :
--   * À TRANCHER EN REVUE. Défaut proposé fail-closed : AUCUN accès aux
--     lignes (staging comme canonical) ; éventuellement SELECT sur les
--     headers canonical de ses propres comptes si un scoping par compte
--     est introduit plus tard.
--
-- Audit events (append-only) :
--   * INSERT autorisé via RPC/runtime uniquement ;
--   * AUCUNE policy UPDATE ni DELETE (donc interdits par défaut sous RLS) ;
--   * ceinture + bretelles : REVOKE UPDATE, DELETE ON bank_statement_import_events FROM authenticated;
--
-- Canonical (immutabilité) :
--   * AUCUNE policy UPDATE/DELETE pour aucun rôle applicatif ;
--   * toute mutation passe par la RPC SECURITY DEFINER de promotion/supersede ;
--   * AUCUNE mutation directe depuis le browser (le client Supabase JS ne
--     doit connaître que les RPC, jamais d'insert/update sur ces tables).
--
-- ============================================================================
-- SECTION 7 — RPC FUTURES (PSEUDO-DESIGN — NON IMPLÉMENTÉES — COMPLÉTÉ EN 0R)
-- ============================================================================
--
-- Toutes SECURITY DEFINER, search_path épinglé, EXECUTE révoqué de PUBLIC et
-- accordé explicitement (précédent Lot 2B sur has_role), vérification de rôle
-- INTERNE à chaque fonction (SECURITY DEFINER contourne RLS), et chaque appel
-- écrit un event append-only via 7.8. Toute RPC qui décide ou écrit côté
-- canonical prend d'abord le verrou 7.9.
--
-- 7.1 promote_structured_bank_statement_import(p_attempt_id uuid)
--       - verrou 7.9 sur import_id ;
--       - vérifie attempt.ingestion_ready = true (le chemin needs_review passe
--         par 7.6, jamais par cette RPC) ;
--       - applique R1/R2/R3 (duplicate/conflict) avant toute écriture ;
--       - copie staging -> canonical + lignes, transactionnellement ;
--       - marque attempt 'ingested', staging 'promoted' ;
--       - event 'promoted'.
--
-- 7.2 reject_structured_bank_statement_import(p_attempt_id uuid, p_reason text)
--       - marque attempt 'rejected' avec rejected_reason safe (code d'erreur,
--         jamais de contenu CSV) ;
--       - event 'attempt_rejected'.
--
-- 7.3 mark_structured_bank_statement_duplicate(p_attempt_id uuid,
--                                              p_canonical_statement_id uuid)
--       - marque attempt 'duplicate' ; le lien vers le canonical existant est
--         porté par l'event (colonne canonical_statement_id de 3.F — la table
--         attempts n'a volontairement pas de colonne dédiée) ;
--       - event 'duplicate_detected'.
--
-- 7.4 resolve_structured_bank_statement_conflict_keep_existing(
--        p_attempt_id uuid, p_reason text)
--       - arbitrage humain d'un conflict R2 : le canonical existant est
--         CONSERVÉ, aucune écriture staging/canonical ;
--       - actor_id humain OBLIGATOIRE (jamais automatique) ;
--       - event 'status_changed' avec safe_details
--         {"resolution": "keep_existing"} sur l'attempt en conflit.
--
-- 7.5 request_structured_bank_statement_manager_escalation(
--        p_attempt_id uuid, p_reason text)
--       - un manager demande review/promotion à un rôle habilité ;
--       - aucune écriture staging/canonical ; l'attempt ne change pas d'état ;
--       - event 'review_requested' avec actor_id = manager.
--
-- 7.6 approve_structured_bank_statement_needs_review_promotion(
--        p_attempt_id uuid, p_reason text)
--       - promotion HUMAINE d'un attempt 'needs_review' (R5) — seule
--         exception à la gate ingestion_ready ;
--       - actor_id humain obligatoire (rôle exact à trancher en revue :
--         admin seul, ou admin + manager) ;
--       - même pipeline que 7.1 (verrou 7.9, R1/R2/R3, copie
--         transactionnelle) ;
--       - events 'promotion_requested' puis 'promoted'.
--
-- 7.7 supersede_structured_bank_statement_import(
--        p_old_canonical_statement_id uuid, p_new_attempt_id uuid,
--        p_reason text)
--     Séquence transactionnelle NORMATIVE (révision 0R) :
--       a. la fonction est UNE transaction : tout échec à n'importe quelle
--          étape => ROLLBACK TOTAL, aucun état intermédiaire persistant ;
--       b. verrou 7.9 sur import_id — sérialise avec toute promotion ou
--          supersede concurrente du même relevé logique ;
--       c. re-lecture du canonical ACTIF sous verrou (SELECT ... FOR UPDATE) :
--          il doit être p_old_canonical_statement_id, sinon exception
--          (l'appelant travaillait sur un état périmé) ;
--       d. validation du staging lié à p_new_attempt_id : gates R1/R2/R3,
--          attempt 'ingestion_ready' (ou approbation humaine 7.6) ;
--       e. pré-génération de l'id du nouveau canonical :
--          v_new_id := gen_random_uuid() ;
--       f. bascule de l'ancien : status = 'superseded',
--          superseded_by = v_new_id, superseded_at = now().
--          La self-FK superseded_by doit être DEFERRABLE INITIALLY DEFERRED
--          (cf. 3.D) : v_new_id n'existe pas encore, la FK est vérifiée au
--          COMMIT. L'ordre inverse (insérer le nouveau d'abord) est
--          IMPOSSIBLE : uq_canonical_active_import_id — index partiel, non
--          déférable — interdit deux relevés 'ingested' simultanés pour un
--          même import_id ;
--       g. insertion du nouveau canonical (id = v_new_id, status 'ingested')
--          + ses lignes (avec bascule is_active si Option A de 4.2) ;
--       h. events append-only, même transaction : 'superseded' sur l'ancien
--          + 'promoted' sur le nouveau ;
--       i. postcondition vérifiée avant sortie : exactement UN canonical
--          status = 'ingested' pour cet import_id.
--
-- 7.8 append_structured_bank_statement_safe_audit_event(...)
--       - SEUL point d'écriture de bank_statement_import_events ;
--       - whitelist stricte des clés safe_details (doctrine 3.F) appliquée
--         AVANT insert : toute clé hors whitelist => exception fail-closed ;
--       - INSERT uniquement — UPDATE/DELETE inexistants (RLS + REVOKE, 6).
--
-- 7.9 Garde concurrence (helper interne, PAS une RPC exposée au client) :
--       - pg_advisory_xact_lock(hashtextextended(p_import_id, 0)) pris par
--         7.1 / 7.6 / 7.7 avant toute lecture décisionnelle ;
--       - sérialise double promotion et double supersede du même import_id
--         (T16) ; libéré automatiquement au COMMIT/ROLLBACK ;
--       - complément : SELECT ... FOR UPDATE sur le canonical actif (7.7.c).
--
-- ============================================================================
-- SECTION 8 — TESTS DB ATTENDUS (FUTURE MIGRATION — CHECKLIST DE REVUE)
-- ============================================================================
--
-- T1.  Migration dry-run : la future migration s'applique et se rollback
--      proprement sur une base jetable (supabase db reset / shadow DB).
-- T2.  RLS par rôle : admin / manager / auditor / user — chaque rôle ne voit
--      et n'écrit QUE ce que la SECTION 6 autorise (tests positifs ET négatifs).
-- T3.  Duplicate exact (R1) : re-promotion même import_id + même raw_text_hash
--      => refusée, attempt 'duplicate', aucun doublon canonical.
-- T4.  Conflict (R2) : même import_id + raw_text_hash différent => attempt
--      'conflict', pas d'upsert, canonical intact.
-- T5.  line_hash duplicate (R3) — révisé 0R : insertion de deux lignes de
--      MÊME line_hash sous le MÊME relevé canonical => rejetée par
--      uq_lines_canonical_line_hash_per_statement ; un line_hash déjà présent
--      sous un AUTRE canonical ACTIF => refusé par le mécanisme retenu en 4.2
--      (index partiel is_active en Option A, contrôle RPC sous verrou en
--      Option B).
--      Contrôle associé : deux lignes métier strictement identiques d'un même
--      relevé (différenciées par occurrenceOrdinal) produisent deux line_hash
--      distincts et sont TOUTES DEUX promues sans conflit.
-- T6.  needs_review (R5) : jamais promu automatiquement ; promotion possible
--      uniquement via RPC avec acteur humain identifié.
-- T7.  invalid / unsupported (R6) : attempt + event seulement ; aucune ligne
--      staging ni canonical créée.
-- T8.  No raw CSV storage : information_schema.columns ne contient aucune
--      colonne raw_csv / raw_text / raw_bytes / raw_content / file_content /
--      account_number / iban sur les 6 tables ; safe_details ne contient
--      aucune de ces clés (test d'insertion via RPC).
-- T9.  Audit append-only : UPDATE et DELETE sur bank_statement_import_events
--      échouent pour tous les rôles applicatifs.
-- T10. Canonical immutability : UPDATE/DELETE directs sur
--      bank_statement_canonical et bank_statement_lines_canonical échouent
--      hors RPC contrôlée.
-- T11. Rollback / supersede : la séquence normative 7.7 bascule l'ancien
--      relevé en 'superseded' avec chaîne superseded_by/superseded_at
--      cohérente (contrainte canonical_supersede_coherent, FK différée) et
--      un seul relevé actif par import_id à la fin (index
--      uq_canonical_active_import_id) ; tout échec intermédiaire => rollback
--      TOTAL (aucun canonical orphelin, aucun event partiel).
--
-- ---- Tests ajoutés en révision 0R -------------------------------------------
--
-- T12. Dates DMY sans dépendance DateStyle (SECTION 5B) :
--      '03/07/2026' => 2026-07-03 (jamais 2026-03-07), vérifié sous
--      DateStyle 'ISO, MDY' ET 'ISO, DMY' ;
--      '31/02/2026' => rejet (date inexistante) ;
--      '2026-07-03' => rejet (format inattendu) ;
--      '3/7/2026'   => rejet round-trip (2 chiffres exigés).
-- T13. Supersede avec lignes communes : re-promotion corrigée du même
--      import_id dont N lignes sont identiques (mêmes line_hash) à celles de
--      l'ancien canonical superseded => promotion RÉUSSIE (c'est le scénario
--      que l'unicité globale abandonnée en 4.2 rendait impossible) ;
--      l'invariant « un line_hash actif une seule fois » reste vérifié
--      (Option A ou B) ; les lignes de l'ancien relevé restent lisibles
--      (historique append-only).
-- T14. Escalation manager : 7.5 écrit 'review_requested' avec actor_id =
--      manager ; un manager ne peut NI promouvoir (7.1/7.6 refusent) NI
--      écrire directement staging/canonical/events.
-- T15. safe_details anti-raw négatif : insertion d'une clé bannie (raw_csv,
--      raw_text, raw_bytes, raw_content, file_content, account_number, iban)
--      => échec (CHECK events_safe_details_no_banned_keys) ET refus RPC 7.8 ;
--      clé non bannie mais hors whitelist => refusée par 7.8 ; clé bannie
--      IMBRIQUÉE dans un objet => refusée par 7.8 (le CHECK ne couvre que le
--      top-level, cf. 3.F).
-- T16. Concurrence : deux promotions simultanées du même import_id => une
--      seule gagne, l'autre sort en duplicate/conflict contrôlé (verrou 7.9) ;
--      deux supersedes simultanés du même canonical actif => un seul gagne
--      (verrou 7.9 + re-lecture 7.7.c) ; jamais deux canonical actifs.
--
-- ============================================================================
-- FIN DU DRAFT — POC-BANK-STRUCTURED-EXPORTS-0P (révisé 0R)
-- DRAFT SQL — REVIEW ONLY — DO NOT APPLY — NOT A MIGRATION
-- ============================================================================
