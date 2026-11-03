-- ============================================================================
-- DAILY V2 — DÉCISIONS OPÉRATIONNELLES (Trésorerie V1, Lot 1 opérationnel)
-- GO_IMPLEMENT_TREASURY_V1_LOT1_OPERATIONAL_FIX — conception R6 (PASS_WITH_RESERVES).
-- ============================================================================
-- Ajouts :
--   - attestations d'identité et de devise d'un export Excel (C2, C3) ;
--   - écartement d'une livraison, statut `rejected` (C4) ;
--   - version financière d'une livraison et comparaison à trois issues (C4 bis) ;
--   - correction des seuls soldes (C4 bis) ;
--   - réfutation d'une version, justifiée source par source, par livraison
--     fraîche ou par pièce corrective archivée hors application (C4 bis, J) ;
--   - approbation groupée par fichier (C8) ;
--   - clés de commande et verrou de tentative (C9).
-- Objets existants modifiés, et seulement eux :
--   - contrainte `units_staging_status_domain` : valeur `rejected` ;
--   - exception H1 dans les deux cœurs vivants du dépôt
--     (`daily_stmt_pre_ingest_legacy_core_0u`, `daily_stmt_pre_ingest_bis_backfill_core_0v`) :
--     un doublon R1 de l'unité canonique active dont la version financière
--     diffère, dérivée et cohérente, conserve ses lignes, sauf si un autre
--     doublon de même version en détient déjà une copie conforme ;
--   - commentaire de la garde serveur de lecture seule.
-- Inchangés : enveloppes du dépôt, classification R1/R2/R3, empreintes, réponse
-- et idempotence du dépôt ; promotion unitaire, cœur de promotion, supersede ;
-- domaine des événements et liste blanche des détails.
-- Aucun stockage de fichier : une pièce corrective est archivée par SODATRA hors
-- de l'application ; seules sa référence, son empreinte, sa date et son auteur
-- sont conservés.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Statut `rejected` (arbitrage 2)
-- --------------------------------------------------------------------------
ALTER TABLE public.daily_statement_units_staging
  DROP CONSTRAINT units_staging_status_domain;
ALTER TABLE public.daily_statement_units_staging
  ADD CONSTRAINT units_staging_status_domain CHECK (status IN (
    'staged', 'provisional', 'duplicate', 'conflict', 'needs_review',
    'promoted', 'promotion_failed', 'superseded', 'rejected'));

-- --------------------------------------------------------------------------
-- 2. Version financière : faits, cohérence, clé, comparaison (C4 bis)
-- --------------------------------------------------------------------------
-- Relations 1 à 4 : statut dans le domaine ; `derived` <=> ouverture et
-- clôture présentes ; totaux positifs ou nuls ; si `derived`, clôture =
-- ouverture + crédits - débits, exactement. Une valeur absente reste absente.
CREATE FUNCTION public.daily_stmt_version_coherent(
  p_aggregates_status text, p_opening numeric, p_closing numeric, p_debits numeric, p_credits numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(
    p_debits IS NOT NULL AND p_credits IS NOT NULL AND p_debits >= 0 AND p_credits >= 0
    AND CASE p_aggregates_status
          WHEN 'derived' THEN p_opening IS NOT NULL AND p_closing IS NOT NULL
                              AND p_closing = p_opening + p_credits - p_debits
          WHEN 'unavailable' THEN p_opening IS NULL AND p_closing IS NULL
          ELSE false
        END, false)
$$;

-- Clé textuelle d'une version : identité des mouvements et version financière.
-- Ce n'est pas une empreinte : aucune empreinte existante n'est modifiée.
CREATE FUNCTION public.daily_stmt_version_key(
  p_content_hash text, p_aggregates_status text, p_opening numeric, p_closing numeric,
  p_debits numeric, p_credits numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_content_hash || '|' || coalesce(p_aggregates_status, '-') || '|' || coalesce(p_opening::text, '-')
         || '|' || coalesce(p_closing::text, '-') || '|' || coalesce(p_debits::text, '-') || '|' || coalesce(p_credits::text, '-')
$$;

-- Comparaison d'une livraison W à la version retenue R, dans l'ordre de la R6 :
--   SAME_VERSION ; CONTRADICTION (nets différents, ou soldes dérivés et
--   cohérents différents) ; AGREEMENT_BREAKDOWN / AGREEMENT_DETAIL (soldes
--   dérivés, cohérents et concordants) ; INSUFFICIENT_UNAVAILABLE /
--   INSUFFICIENT_INCOHERENT (même net, accord non établi).
CREATE FUNCTION public.daily_stmt_version_compare(
  w_hash text, w_aggregates text, w_opening numeric, w_closing numeric, w_debits numeric, w_credits numeric,
  r_hash text, r_aggregates text, r_opening numeric, r_closing numeric, r_debits numeric, r_credits numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_w_coherent boolean := public.daily_stmt_version_coherent(w_aggregates, w_opening, w_closing, w_debits, w_credits);
  v_r_coherent boolean := public.daily_stmt_version_coherent(r_aggregates, r_opening, r_closing, r_debits, r_credits);
  -- Relation 5 : mêmes mouvements => mêmes totaux.
  v_pair_ok boolean := NOT (w_hash = r_hash AND (w_debits IS DISTINCT FROM r_debits OR w_credits IS DISTINCT FROM r_credits));
BEGIN
  IF w_hash = r_hash AND w_aggregates IS NOT DISTINCT FROM r_aggregates
     AND w_opening IS NOT DISTINCT FROM r_opening AND w_closing IS NOT DISTINCT FROM r_closing
     AND w_debits IS NOT DISTINCT FROM r_debits AND w_credits IS NOT DISTINCT FROM r_credits THEN
    RETURN 'SAME_VERSION';
  END IF;
  -- Une différence de mouvement net démontre une contradiction dans tous les cas.
  IF (w_credits - w_debits) IS DISTINCT FROM (r_credits - r_debits) THEN
    RETURN 'CONTRADICTION';
  END IF;
  IF v_w_coherent AND v_r_coherent AND v_pair_ok
     AND w_aggregates = 'derived' AND r_aggregates = 'derived' THEN
    IF w_opening <> r_opening OR w_closing <> r_closing THEN
      RETURN 'CONTRADICTION';
    END IF;
    IF w_debits <> r_debits OR w_credits <> r_credits THEN
      RETURN 'AGREEMENT_BREAKDOWN';
    END IF;
    RETURN 'AGREEMENT_DETAIL';
  END IF;
  IF NOT v_w_coherent OR NOT v_r_coherent OR NOT v_pair_ok THEN
    RETURN 'INSUFFICIENT_INCOHERENT';
  END IF;
  RETURN 'INSUFFICIENT_UNAVAILABLE';
END;
$$;

-- Relation 6 : lignes stockées conformes aux faits de leur unité (nombre,
-- totaux et, si `derived`, chaîne des soldes courants de l'ouverture à la
-- clôture). L'ordre de chaînage du pipeline est l'ordre du fichier ou son
-- inverse (profils Excel décroissants) : l'un des deux doit être cohérent.
CREATE FUNCTION public.daily_stmt_staging_lines_conform(p_staging_unit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH u AS (
    SELECT s.* FROM public.daily_statement_units_staging s WHERE s.id = p_staging_unit_id
  ), l AS (
    SELECT ls.signed_amount, ls.direction, ls.running_balance,
           row_number() OVER (ORDER BY ls.source_line_index, ls.daily_occurrence_ordinal, ls.id) AS rn_asc,
           row_number() OVER (ORDER BY ls.source_line_index DESC, ls.daily_occurrence_ordinal, ls.id) AS rn_desc,
           lag(ls.running_balance) OVER (ORDER BY ls.source_line_index, ls.daily_occurrence_ordinal, ls.id) AS prev_asc,
           lag(ls.running_balance) OVER (ORDER BY ls.source_line_index DESC, ls.daily_occurrence_ordinal, ls.id) AS prev_desc
    FROM public.daily_statement_lines_staging ls
    WHERE ls.staging_unit_id = p_staging_unit_id
  ), agg AS (
    SELECT count(*) AS n,
           coalesce(sum(-l.signed_amount) FILTER (WHERE l.direction = 'debit'), 0) AS debits,
           coalesce(sum(l.signed_amount) FILTER (WHERE l.direction = 'credit'), 0) AS credits,
           coalesce(bool_and(l.running_balance IS NOT NULL), false) AS all_balances,
           coalesce(bool_and(l.rn_asc = 1 OR l.running_balance = l.prev_asc + l.signed_amount), false) AS chain_asc,
           coalesce(bool_and(l.rn_desc = 1 OR l.running_balance = l.prev_desc + l.signed_amount), false) AS chain_desc,
           max(l.running_balance - l.signed_amount) FILTER (WHERE l.rn_asc = 1) AS open_asc,
           max(l.running_balance - l.signed_amount) FILTER (WHERE l.rn_desc = 1) AS open_desc,
           max(l.running_balance) FILTER (WHERE l.rn_desc = 1) AS close_asc,
           max(l.running_balance) FILTER (WHERE l.rn_asc = 1) AS close_desc
    FROM l
  )
  SELECT coalesce((
    SELECT agg.n = u.line_count AND agg.debits = u.day_total_debits AND agg.credits = u.day_total_credits
           AND (u.aggregates_status = 'unavailable'
                OR (agg.all_balances
                    AND ((agg.chain_asc AND agg.open_asc = u.opening_balance_derived AND agg.close_asc = u.closing_balance_derived)
                      OR (agg.chain_desc AND agg.open_desc = u.opening_balance_derived AND agg.close_desc = u.closing_balance_derived))))
    FROM u, agg), false)
$$;

-- Exception H1 : faut-il conserver les lignes d'un doublon R1 ?
CREATE FUNCTION public.daily_stmt_h1_keep_lines(
  p_day_unit_id text, p_content_hash text, p_aggregates_status text, p_opening numeric, p_closing numeric,
  p_debits numeric, p_credits numeric, p_canonical_unit_id uuid, p_exclude_staging_unit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_aggregates_status = 'derived'
     AND public.daily_stmt_version_coherent(p_aggregates_status, p_opening, p_closing, p_debits, p_credits)
     AND EXISTS (
       SELECT 1 FROM public.daily_statement_units_canonical c
       WHERE c.id = p_canonical_unit_id AND c.status = 'ingested' AND c.day_unit_id = p_day_unit_id
         AND c.active_day_content_hash = p_content_hash
         AND (c.aggregates_status, c.opening_balance_derived, c.closing_balance_derived,
              c.day_total_debits, c.day_total_credits)
             IS DISTINCT FROM (p_aggregates_status, p_opening, p_closing, p_debits, p_credits))
     -- Réserve CTO 4.2 : seule une copie complète et conforme dispense.
     AND NOT EXISTS (
       SELECT 1 FROM public.daily_statement_units_staging s
       WHERE s.day_unit_id = p_day_unit_id AND s.status = 'duplicate'
         AND s.id IS DISTINCT FROM p_exclude_staging_unit_id
         AND s.day_content_hash = p_content_hash AND s.aggregates_status = p_aggregates_status
         AND s.opening_balance_derived IS NOT DISTINCT FROM p_opening
         AND s.closing_balance_derived IS NOT DISTINCT FROM p_closing
         AND s.day_total_debits = p_debits AND s.day_total_credits = p_credits
         AND public.daily_stmt_staging_lines_conform(s.id))
$$;

-- Faits d'une livraison, pour l'interface et les commandes (lecture seule).
CREATE FUNCTION public.daily_stmt_version_facts(p_staging_unit_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'staging_unit_id', s.id, 'day_unit_id', s.day_unit_id, 'accounting_date', s.accounting_date,
    'day_content_hash', s.day_content_hash, 'aggregates_status', s.aggregates_status,
    'opening', s.opening_balance_derived::text, 'closing', s.closing_balance_derived::text,
    'debits', s.day_total_debits::text, 'credits', s.day_total_credits::text,
    'net', (s.day_total_credits - s.day_total_debits)::text,
    'coherent', public.daily_stmt_version_coherent(s.aggregates_status, s.opening_balance_derived,
                  s.closing_balance_derived, s.day_total_debits, s.day_total_credits),
    'version_key', public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status, s.opening_balance_derived,
                  s.closing_balance_derived, s.day_total_debits, s.day_total_credits))
  FROM public.daily_statement_units_staging s WHERE s.id = p_staging_unit_id
$$;

-- Sources d'une version pour une journée : fichiers (empreinte brute) qui la
-- portent, dans le contexte du compte, et leur première apparition (instant
-- serveur du premier dépôt). Un redépôt identique ne change pas la première
-- apparition ; les livraisons provisoires (et leur balayage) sont exclues.
CREATE FUNCTION public.daily_stmt_version_sources(p_day_unit_id text, p_version_key text)
RETURNS TABLE (raw_text_hash text, account_registry_id uuid, first_seen_at timestamptz, deliveries integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.raw_text_hash, a.account_registry_id, min(a.created_at), count(*)::integer
  FROM public.daily_statement_units_staging s
  JOIN public.daily_statement_export_attempts a ON a.id = s.attempt_id
  WHERE s.day_unit_id = p_day_unit_id
    AND s.status NOT IN ('provisional', 'superseded')
    AND public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status, s.opening_balance_derived,
          s.closing_balance_derived, s.day_total_debits, s.day_total_credits) = p_version_key
  GROUP BY a.raw_text_hash, a.account_registry_id
$$;

-- --------------------------------------------------------------------------
-- 3. Clés de commande (C9) et verrou de tentative
-- --------------------------------------------------------------------------
CREATE TABLE daily_v2_private.decision_commands (
  command_key  text PRIMARY KEY CHECK (command_key ~ '^[A-Za-z0-9._:-]{8,120}$'),
  command_name text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES auth.users (id),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result       jsonb,
  created_at   timestamptz NOT NULL DEFAULT statement_timestamp(),
  finished_at  timestamptz
);

CREATE FUNCTION daily_v2_private.guard_decision_commands()
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
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DAILY_STMT_APPEND_ONLY';
END;
$$;

CREATE TRIGGER daily_v2_decision_commands_guard
  BEFORE UPDATE OR DELETE ON daily_v2_private.decision_commands
  FOR EACH ROW EXECUTE FUNCTION daily_v2_private.guard_decision_commands();
CREATE TRIGGER daily_v2_decision_commands_no_truncate
  BEFORE TRUNCATE ON daily_v2_private.decision_commands
  FOR EACH STATEMENT EXECUTE FUNCTION daily_v2_private.guard_decision_commands();

-- Même sémantique que treasury_private.command_begin / command_finish : la clé
-- est réservée avant tout effet ; rejeu identique = résultat enregistré.
CREATE FUNCTION daily_v2_private.command_begin(p_actor uuid, p_command text, p_key text, p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_hash text := encode(sha256(convert_to(p_command || ':' || p_request::text, 'UTF8')), 'hex');
  v_row daily_v2_private.decision_commands%ROWTYPE;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9._:-]{8,120}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DAILY_STMT_COMMAND_KEY_INVALID';
  END IF;
  SELECT * INTO v_row FROM daily_v2_private.decision_commands c WHERE c.command_key = p_key;
  IF NOT FOUND THEN
    BEGIN
      INSERT INTO daily_v2_private.decision_commands (command_key, command_name, actor_id, request_hash)
      VALUES (p_key, p_command, p_actor, v_hash);
      RETURN NULL;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_row FROM daily_v2_private.decision_commands c WHERE c.command_key = p_key;
    END;
  END IF;
  IF v_row.command_name <> p_command OR v_row.actor_id <> p_actor OR v_row.request_hash <> v_hash THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DAILY_STMT_COMMAND_KEY_REUSED';
  END IF;
  IF v_row.result IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'DAILY_STMT_COMMAND_IN_PROGRESS';
  END IF;
  RETURN v_row.result;
END;
$$;

CREATE FUNCTION daily_v2_private.command_finish(p_key text, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE daily_v2_private.decision_commands
     SET result = p_result, finished_at = statement_timestamp()
   WHERE command_key = p_key AND result IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'DAILY_STMT_COMMAND_IN_PROGRESS';
  END IF;
  RETURN p_result;
END;
$$;

-- Verrou de tentative : exclusif pour attester ou révoquer, partagé pour les
-- commandes qui lisent les attestations. Ordre global (C9) : autorité de
-- l'administrateur unique, verrous de journée triés, puis tentative.
CREATE FUNCTION public.daily_stmt_acquire_attempt_lock(p_attempt_id uuid, p_exclusive boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_LOCK_ATTEMPT: attempt id required (fail-closed)';
  END IF;
  IF p_exclusive THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('daily_v2:attempt:' || p_attempt_id::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('daily_v2:attempt:' || p_attempt_id::text, 0));
  END IF;
END;
$$;

-- Acteur des décisions : rôle `admin` Daily v2, et administrateur unique quand
-- la décision l'exige (arbitrage 1). L'autorité de l'administrateur unique est
-- prise en partage AVANT tout autre verrou.
CREATE FUNCTION public.daily_stmt_require_decision_actor(p_single_admin boolean)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_AUTH_REQUIRED: authenticated actor required (fail-closed)';
  END IF;
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_ROLE_DENIED: admin role required (fail-closed)';
  END IF;
  IF p_single_admin THEN
    PERFORM payables_private.require_admin(v_actor);
  END IF;
  RETURN v_actor;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Tables de décision, en ajout seul
-- --------------------------------------------------------------------------
-- Attestations par fichier (C2, C3). Unicité structurelle : la première
-- attestation est unique par fichier et par type ; chaque attestation suivante
-- consomme une révocation distincte de la même chaîne ; chaque révocation vise
-- une attestation distincte de la même chaîne. Au plus une active.
CREATE TABLE public.daily_statement_attempt_attestations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id          uuid NOT NULL REFERENCES public.daily_statement_export_attempts (id),
  attestation_type    text NOT NULL CHECK (attestation_type IN ('ACCOUNT_IDENTITY', 'TRUSTED_CURRENCY')),
  action              text NOT NULL CHECK (action IN ('ATTEST', 'REVOKE')),
  raw_text_hash       text NOT NULL CHECK (raw_text_hash ~ '^[0-9a-f]{64}$'),
  account_registry_id uuid NOT NULL REFERENCES public.daily_statement_account_registry (id),
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  revokes_id          uuid,
  revokes_kind        text GENERATED ALWAYS AS (CASE WHEN revokes_id IS NULL THEN NULL ELSE 'ATTEST' END) STORED,
  after_revocation_id uuid,
  after_revocation_kind text GENERATED ALWAYS AS (CASE WHEN after_revocation_id IS NULL THEN NULL ELSE 'REVOKE' END) STORED,
  evidence_ref        text,
  reason              text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  actor_id            uuid NOT NULL REFERENCES auth.users (id),
  created_at          timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT attempt_attestations_chain_key UNIQUE (id, attempt_id, attestation_type, action),
  CONSTRAINT attempt_attestations_shape CHECK (
    (action = 'ATTEST' AND revokes_id IS NULL AND evidence_ref IS NOT NULL
       AND char_length(btrim(evidence_ref)) BETWEEN 1 AND 200)
    OR (action = 'REVOKE' AND revokes_id IS NOT NULL AND after_revocation_id IS NULL)),
  CONSTRAINT attempt_attestations_revokes_fk FOREIGN KEY (revokes_id, attempt_id, attestation_type, revokes_kind)
    REFERENCES public.daily_statement_attempt_attestations (id, attempt_id, attestation_type, action),
  CONSTRAINT attempt_attestations_after_fk FOREIGN KEY (after_revocation_id, attempt_id, attestation_type, after_revocation_kind)
    REFERENCES public.daily_statement_attempt_attestations (id, attempt_id, attestation_type, action)
);
CREATE UNIQUE INDEX uq_attempt_attestations_first
  ON public.daily_statement_attempt_attestations (attempt_id, attestation_type)
  WHERE action = 'ATTEST' AND after_revocation_id IS NULL;
CREATE UNIQUE INDEX uq_attempt_attestations_revokes
  ON public.daily_statement_attempt_attestations (revokes_id) WHERE revokes_id IS NOT NULL;
CREATE UNIQUE INDEX uq_attempt_attestations_after
  ON public.daily_statement_attempt_attestations (after_revocation_id) WHERE after_revocation_id IS NOT NULL;

-- Pièces correctives bancaires (G3), archivées par SODATRA HORS de
-- l'application : seules la référence, l'emplacement d'archivage déclaré,
-- l'empreinte, la date d'émission et l'auteur sont conservés. Empreinte
-- unique dans toute la table : une pièce, un compte.
CREATE TABLE public.daily_statement_correction_pieces (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_registry_id uuid NOT NULL REFERENCES public.daily_statement_account_registry (id),
  piece_sha256        text NOT NULL UNIQUE CHECK (piece_sha256 ~ '^[0-9a-f]{64}$'),
  piece_reference     text NOT NULL CHECK (char_length(btrim(piece_reference)) BETWEEN 1 AND 200),
  archive_reference   text NOT NULL CHECK (char_length(btrim(archive_reference)) BETWEEN 1 AND 200),
  issued_on           date NOT NULL,
  archive_attested    boolean NOT NULL CHECK (archive_attested),
  nature              text NOT NULL DEFAULT 'ARCHIVED_PIECE_ATTESTATION' CHECK (nature = 'ARCHIVED_PIECE_ATTESTATION'),
  actor_id            uuid NOT NULL REFERENCES auth.users (id),
  created_at          timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT correction_pieces_account_key UNIQUE (id, account_registry_id)
);

-- Réfutations de versions (C4 bis). Même schéma de chaîne que les
-- attestations, clé (journée, version réfutée). Au plus une active.
CREATE TABLE public.daily_statement_version_refutations (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action                     text NOT NULL CHECK (action IN ('REFUTE', 'REVOKE')),
  day_unit_id                text NOT NULL,
  account_registry_id        uuid NOT NULL REFERENCES public.daily_statement_account_registry (id),
  accounting_date            date NOT NULL,
  refuted_version_key        text NOT NULL,
  retained_canonical_unit_id uuid NOT NULL REFERENCES public.daily_statement_units_canonical (id),
  retained_version_key       text NOT NULL,
  comparison                 text NOT NULL CHECK (comparison IN (
                               'CONTRADICTION', 'INSUFFICIENT_UNAVAILABLE', 'INSUFFICIENT_INCOHERENT', 'NOT_APPLICABLE')),
  proof_kind                 text CHECK (proof_kind IN ('FRESH_DELIVERY', 'BANK_PIECE')),
  proof_staging_unit_id      uuid REFERENCES public.daily_statement_units_staging (id),
  proof_bound_day            date,
  piece_id                   uuid,
  piece_opening              numeric(18, 2),
  piece_closing              numeric(18, 2),
  piece_debits               numeric(18, 2),
  piece_credits              numeric(18, 2),
  revokes_id                 uuid,
  revokes_kind               text GENERATED ALWAYS AS (CASE WHEN revokes_id IS NULL THEN NULL ELSE 'REFUTE' END) STORED,
  after_revocation_id        uuid,
  after_revocation_kind      text GENERATED ALWAYS AS (CASE WHEN after_revocation_id IS NULL THEN NULL ELSE 'REVOKE' END) STORED,
  reason                     text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  actor_id                   uuid NOT NULL REFERENCES auth.users (id),
  created_at                 timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT version_refutations_chain_key UNIQUE (id, day_unit_id, refuted_version_key, action),
  CONSTRAINT version_refutations_shape CHECK (
    (action = 'REFUTE' AND revokes_id IS NULL AND comparison <> 'NOT_APPLICABLE' AND proof_bound_day IS NOT NULL
       AND ((proof_kind = 'FRESH_DELIVERY' AND proof_staging_unit_id IS NOT NULL AND piece_id IS NULL)
         OR (proof_kind = 'BANK_PIECE' AND piece_id IS NOT NULL AND proof_staging_unit_id IS NULL)))
    OR (action = 'REVOKE' AND revokes_id IS NOT NULL AND after_revocation_id IS NULL AND proof_kind IS NULL
        AND comparison = 'NOT_APPLICABLE')),
  CONSTRAINT version_refutations_refuted_not_retained CHECK (refuted_version_key <> retained_version_key),
  CONSTRAINT version_refutations_piece_fk FOREIGN KEY (piece_id, account_registry_id)
    REFERENCES public.daily_statement_correction_pieces (id, account_registry_id),
  CONSTRAINT version_refutations_revokes_fk FOREIGN KEY (revokes_id, day_unit_id, refuted_version_key, revokes_kind)
    REFERENCES public.daily_statement_version_refutations (id, day_unit_id, refuted_version_key, action),
  CONSTRAINT version_refutations_after_fk FOREIGN KEY (after_revocation_id, day_unit_id, refuted_version_key, after_revocation_kind)
    REFERENCES public.daily_statement_version_refutations (id, day_unit_id, refuted_version_key, action)
);
CREATE UNIQUE INDEX uq_version_refutations_first
  ON public.daily_statement_version_refutations (day_unit_id, refuted_version_key)
  WHERE action = 'REFUTE' AND after_revocation_id IS NULL;
CREATE UNIQUE INDEX uq_version_refutations_revokes
  ON public.daily_statement_version_refutations (revokes_id) WHERE revokes_id IS NOT NULL;
CREATE UNIQUE INDEX uq_version_refutations_after
  ON public.daily_statement_version_refutations (after_revocation_id) WHERE after_revocation_id IS NOT NULL;
CREATE INDEX ix_version_refutations_day ON public.daily_statement_version_refutations (day_unit_id);

-- Sources justifiées d'une réfutation : une ligne par source (empreinte,
-- contexte, première apparition, borne de la preuve). Une réfutation couvre
-- exactement ces sources.
CREATE TABLE public.daily_statement_refutation_sources (
  refutation_id       uuid NOT NULL REFERENCES public.daily_statement_version_refutations (id),
  raw_text_hash       text NOT NULL CHECK (raw_text_hash ~ '^[0-9a-f]{64}$'),
  account_registry_id uuid NOT NULL REFERENCES public.daily_statement_account_registry (id),
  first_seen_at       timestamptz NOT NULL,
  proof_bound_day     date NOT NULL,
  verdict             text NOT NULL CHECK (verdict = 'JUSTIFIED'),
  PRIMARY KEY (refutation_id, raw_text_hash, account_registry_id),
  CONSTRAINT refutation_sources_justified CHECK (proof_bound_day > (first_seen_at AT TIME ZONE 'Africa/Dakar')::date)
);

-- Gardes : ajout seul, garde serveur de lecture seule, RLS en lecture.
CREATE FUNCTION public.daily_stmt_block_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DAILY_STMT_APPEND_ONLY';
END;
$$;

CREATE TRIGGER daily_stmt_attestations_append_only
  BEFORE UPDATE OR DELETE ON public.daily_statement_attempt_attestations
  FOR EACH ROW EXECUTE FUNCTION public.daily_stmt_block_decision_mutation();
CREATE TRIGGER daily_stmt_attestations_no_truncate
  BEFORE TRUNCATE ON public.daily_statement_attempt_attestations
  FOR EACH STATEMENT EXECUTE FUNCTION public.daily_stmt_block_decision_mutation();
CREATE TRIGGER daily_stmt_pieces_append_only
  BEFORE UPDATE OR DELETE ON public.daily_statement_correction_pieces
  FOR EACH ROW EXECUTE FUNCTION public.daily_stmt_block_decision_mutation();
CREATE TRIGGER daily_stmt_pieces_no_truncate
  BEFORE TRUNCATE ON public.daily_statement_correction_pieces
  FOR EACH STATEMENT EXECUTE FUNCTION public.daily_stmt_block_decision_mutation();
CREATE TRIGGER daily_stmt_refutations_append_only
  BEFORE UPDATE OR DELETE ON public.daily_statement_version_refutations
  FOR EACH ROW EXECUTE FUNCTION public.daily_stmt_block_decision_mutation();
CREATE TRIGGER daily_stmt_refutations_no_truncate
  BEFORE TRUNCATE ON public.daily_statement_version_refutations
  FOR EACH STATEMENT EXECUTE FUNCTION public.daily_stmt_block_decision_mutation();
CREATE TRIGGER daily_stmt_refutation_sources_append_only
  BEFORE UPDATE OR DELETE ON public.daily_statement_refutation_sources
  FOR EACH ROW EXECUTE FUNCTION public.daily_stmt_block_decision_mutation();
CREATE TRIGGER daily_stmt_refutation_sources_no_truncate
  BEFORE TRUNCATE ON public.daily_statement_refutation_sources
  FOR EACH STATEMENT EXECUTE FUNCTION public.daily_stmt_block_decision_mutation();

-- Garde serveur existante de lecture seule, fonction inchangée.
CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.daily_statement_attempt_attestations
FOR EACH STATEMENT EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();
CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.daily_statement_correction_pieces
FOR EACH STATEMENT EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();
CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.daily_statement_version_refutations
FOR EACH STATEMENT EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();
CREATE TRIGGER daily_v2_server_readonly_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.daily_statement_refutation_sources
FOR EACH STATEMENT EXECUTE FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard();

COMMENT ON FUNCTION daily_v2_private.enforce_daily_statement_mutation_guard() IS
  'Garde trigger interne fail-closed : bloque INSERT/UPDATE/DELETE/TRUNCATE sur les treize tables Daily v2 (neuf historiques, quatre de décision) tant que le singleton opérateur n''est pas explicitement activé.';

-- --------------------------------------------------------------------------
-- 5. Commandes
-- --------------------------------------------------------------------------
-- 5.1 Attestation d'identité ou de devise d'un export Excel (C2, C3).
CREATE FUNCTION public.attest_daily_statement_attempt(
  p_command_key text, p_attempt_id uuid, p_attestation_type text, p_raw_text_hash text,
  p_account_registry_id uuid, p_currency text, p_evidence_ref text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid;
  v_prior   jsonb;
  v_reason  text;
  v_ref     text;
  v_attempt public.daily_statement_export_attempts%ROWTYPE;
  v_reg     public.daily_statement_account_registry%ROWTYPE;
  v_code    text;
  v_after   uuid;
  v_id      uuid;
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('admin');
  v_actor := public.daily_stmt_require_decision_actor(true);
  v_prior := daily_v2_private.command_begin(v_actor, 'ATTEST_ATTEMPT', p_command_key, jsonb_build_object(
    'attempt', p_attempt_id, 'type', p_attestation_type, 'raw', p_raw_text_hash, 'account', p_account_registry_id,
    'currency', p_currency, 'evidence', p_evidence_ref, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := public.daily_stmt_assert_safe_operator_reason(p_reason);
  v_ref := public.daily_stmt_assert_safe_operator_reason(p_evidence_ref);
  IF p_attestation_type IS NULL OR p_attestation_type NOT IN ('ACCOUNT_IDENTITY', 'TRUSTED_CURRENCY') THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTESTATION_TYPE_INVALID (fail-closed)';
  END IF;

  PERFORM public.daily_stmt_acquire_attempt_lock(p_attempt_id, true);
  SELECT * INTO v_attempt FROM public.daily_statement_export_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTEMPT_NOT_FOUND (fail-closed)';
  END IF;
  IF v_attempt.source_format NOT IN ('structured_bank_statement_xls', 'structured_bank_statement_xlsx') THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTESTATION_EXCEL_ONLY: only an Excel export can be attested (fail-closed)';
  END IF;
  IF p_attestation_type = 'ACCOUNT_IDENTITY' AND v_attempt.account_number_masked IS NOT NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTESTATION_MASKED_PRESENT: identity is corroborated by the masked label (fail-closed)';
  END IF;
  IF p_raw_text_hash IS DISTINCT FROM v_attempt.raw_text_hash THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTESTATION_FILE_MISMATCH: reselected file differs from the deposit (fail-closed)';
  END IF;
  IF p_account_registry_id IS DISTINCT FROM v_attempt.account_registry_id THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTESTATION_ACCOUNT_MISMATCH (fail-closed)';
  END IF;
  SELECT * INTO v_reg FROM public.daily_statement_account_registry WHERE id = p_account_registry_id;
  IF NOT FOUND OR v_reg.status <> 'active' THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTESTATION_ACCOUNT_INACTIVE (fail-closed)';
  END IF;
  IF p_attestation_type = 'TRUSTED_CURRENCY'
     AND (upper(btrim(coalesce(p_currency, ''))) <> v_attempt.currency OR v_attempt.currency <> v_reg.currency) THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTESTATION_CURRENCY_MISMATCH (fail-closed)';
  END IF;
  v_code := CASE p_attestation_type WHEN 'ACCOUNT_IDENTITY' THEN 'ACCOUNT_IDENTITY_NOT_CORROBORATED'
                                    ELSE 'TRUSTED_CURRENCY_UNCORROBORATED' END;
  IF NOT (v_code = ANY (coalesce(v_attempt.review_reason_codes, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTESTATION_NOT_NEEDED: the attempt does not carry %', v_code;
  END IF;
  IF EXISTS (SELECT 1 FROM public.daily_statement_attempt_attestations a
             WHERE a.attempt_id = p_attempt_id AND a.attestation_type = p_attestation_type AND a.action = 'ATTEST'
               AND NOT EXISTS (SELECT 1 FROM public.daily_statement_attempt_attestations r WHERE r.revokes_id = a.id)) THEN
    RAISE EXCEPTION 'DAILY_STMT_ALREADY_ATTESTED (fail-closed)';
  END IF;
  SELECT r.id INTO v_after
  FROM public.daily_statement_attempt_attestations r
  WHERE r.attempt_id = p_attempt_id AND r.attestation_type = p_attestation_type AND r.action = 'REVOKE'
    AND NOT EXISTS (SELECT 1 FROM public.daily_statement_attempt_attestations a WHERE a.after_revocation_id = r.id)
  ORDER BY r.created_at DESC, r.id LIMIT 1;

  INSERT INTO public.daily_statement_attempt_attestations (
    attempt_id, attestation_type, action, raw_text_hash, account_registry_id, currency,
    after_revocation_id, evidence_ref, reason, actor_id)
  VALUES (p_attempt_id, p_attestation_type, 'ATTEST', v_attempt.raw_text_hash, v_attempt.account_registry_id,
          v_attempt.currency, v_after, v_ref, v_reason, v_actor)
  RETURNING id INTO v_id;

  RETURN daily_v2_private.command_finish(p_command_key, jsonb_build_object(
    'outcome', 'attested', 'attestation_id', v_id, 'attempt_id', p_attempt_id, 'attestation_type', p_attestation_type));
END;
$$;

-- 5.2 Révocation d'une attestation.
CREATE FUNCTION public.revoke_daily_statement_attempt_attestation(
  p_command_key text, p_attestation_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid;
  v_prior  jsonb;
  v_reason text;
  v_att    public.daily_statement_attempt_attestations%ROWTYPE;
  v_id     uuid;
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('admin');
  v_actor := public.daily_stmt_require_decision_actor(true);
  v_prior := daily_v2_private.command_begin(v_actor, 'REVOKE_ATTESTATION', p_command_key,
    jsonb_build_object('attestation', p_attestation_id, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := public.daily_stmt_assert_safe_operator_reason(p_reason);
  SELECT * INTO v_att FROM public.daily_statement_attempt_attestations WHERE id = p_attestation_id AND action = 'ATTEST';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTESTATION_NOT_FOUND (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_acquire_attempt_lock(v_att.attempt_id, true);
  IF EXISTS (SELECT 1 FROM public.daily_statement_attempt_attestations r WHERE r.revokes_id = p_attestation_id) THEN
    RAISE EXCEPTION 'DAILY_STMT_ALREADY_REVOKED (fail-closed)';
  END IF;
  INSERT INTO public.daily_statement_attempt_attestations (
    attempt_id, attestation_type, action, raw_text_hash, account_registry_id, currency, revokes_id, reason, actor_id)
  VALUES (v_att.attempt_id, v_att.attestation_type, 'REVOKE', v_att.raw_text_hash, v_att.account_registry_id,
          v_att.currency, v_att.id, v_reason, v_actor)
  RETURNING id INTO v_id;
  RETURN daily_v2_private.command_finish(p_command_key, jsonb_build_object(
    'outcome', 'revoked', 'revocation_id', v_id, 'attestation_id', p_attestation_id));
END;
$$;

-- 5.3 Écartement d'une livraison (C4). R1/R2 rejouées sous verrou, puis
-- comparaison des versions : contradiction démontrée refusée ; accord établi
-- ou données insuffisantes admis (sortie de l'attente seulement).
CREATE FUNCTION public.reject_daily_statement_unit(
  p_command_key text, p_staging_unit_id uuid, p_expected_status text,
  p_expected_canonical_unit_id uuid, p_expected_canonical_content_hash text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor      uuid;
  v_prior      jsonb;
  v_reason     text;
  v_unit       public.daily_statement_units_staging%ROWTYPE;
  v_active     public.daily_statement_units_canonical%ROWTYPE;
  v_has_active boolean;
  v_comparison text;
  v_result     jsonb;
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('daily');
  v_actor := public.daily_stmt_require_decision_actor(true);
  v_prior := daily_v2_private.command_begin(v_actor, 'REJECT_UNIT', p_command_key, jsonb_build_object(
    'unit', p_staging_unit_id, 'status', p_expected_status, 'canonical', p_expected_canonical_unit_id,
    'hash', p_expected_canonical_content_hash, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := public.daily_stmt_assert_safe_operator_reason(p_reason);

  SELECT * INTO v_unit FROM public.daily_statement_units_staging WHERE id = p_staging_unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_STAGING_NOT_FOUND (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_acquire_day_lock(v_unit.day_unit_id);
  SELECT * INTO v_unit FROM public.daily_statement_units_staging WHERE id = p_staging_unit_id;

  IF v_unit.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'DAILY_STMT_REJECT_STALE: status changed since display (fail-closed)';
  END IF;
  IF v_unit.status NOT IN ('staged', 'needs_review', 'promotion_failed') THEN
    RAISE EXCEPTION 'DAILY_STMT_REJECT_ORIGIN_FORBIDDEN: status % cannot be rejected (fail-closed)', v_unit.status;
  END IF;
  SELECT * INTO v_active FROM public.daily_statement_units_canonical
  WHERE day_unit_id = v_unit.day_unit_id AND status = 'ingested';
  v_has_active := FOUND;
  IF (v_has_active AND (p_expected_canonical_unit_id IS DISTINCT FROM v_active.id
                        OR p_expected_canonical_content_hash IS DISTINCT FROM v_active.active_day_content_hash))
     OR (NOT v_has_active AND (p_expected_canonical_unit_id IS NOT NULL OR p_expected_canonical_content_hash IS NOT NULL)) THEN
    RAISE EXCEPTION 'DAILY_STMT_REJECT_STALE: retained day changed since display (fail-closed)';
  END IF;

  IF v_has_active THEN
    -- R1 rejouée : mêmes mouvements => doublon, jamais écartée.
    IF v_active.active_day_content_hash = v_unit.day_content_hash THEN
      UPDATE public.daily_statement_units_staging SET status = 'duplicate' WHERE id = v_unit.id;
      PERFORM public.daily_stmt_append_audit_event(
        v_actor, v_unit.attempt_id, v_unit.id, v_active.id, v_unit.day_unit_id, NULL,
        'unit_duplicate', v_unit.status, 'duplicate',
        'rejection replayed R1: same movements as the active canonical day',
        jsonb_build_object('reason_code', 'reject_replayed_r1', 'previous_status', v_unit.status, 'new_status', 'duplicate'));
      v_result := jsonb_build_object('outcome', 'duplicate', 'staging_unit_id', v_unit.id,
                                     'active_canonical_unit_id', v_active.id);
      RETURN daily_v2_private.command_finish(p_command_key, v_result);
    END IF;
    v_comparison := public.daily_stmt_version_compare(
      v_unit.day_content_hash, v_unit.aggregates_status, v_unit.opening_balance_derived, v_unit.closing_balance_derived,
      v_unit.day_total_debits, v_unit.day_total_credits,
      v_active.active_day_content_hash, v_active.aggregates_status, v_active.opening_balance_derived,
      v_active.closing_balance_derived, v_active.day_total_debits, v_active.day_total_credits);
    IF v_comparison = 'CONTRADICTION' THEN
      RAISE EXCEPTION 'DAILY_STMT_REJECT_CONTRADICTS_RETAINED: a contradicting version is lifted only by a bank proof (fail-closed)';
    END IF;
  END IF;

  UPDATE public.daily_statement_units_staging SET status = 'rejected' WHERE id = v_unit.id;
  PERFORM public.daily_stmt_append_audit_event(
    v_actor, v_unit.attempt_id, v_unit.id, CASE WHEN v_has_active THEN v_active.id END, v_unit.day_unit_id, NULL,
    'status_changed', v_unit.status, 'rejected', v_reason,
    jsonb_build_object('reason_code', 'unit_rejected', 'previous_status', v_unit.status, 'new_status', 'rejected'));
  v_result := jsonb_build_object('outcome', 'rejected', 'staging_unit_id', v_unit.id, 'comparison', v_comparison);
  RETURN daily_v2_private.command_finish(p_command_key, v_result);
END;
$$;

-- Motifs résiduels d'une tentative après ses attestations actives (C2, C3).
CREATE FUNCTION public.daily_stmt_attempt_resolved_codes(p_attempt_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(DISTINCT CASE a.attestation_type
           WHEN 'ACCOUNT_IDENTITY' THEN 'ACCOUNT_IDENTITY_NOT_CORROBORATED'
           ELSE 'TRUSTED_CURRENCY_UNCORROBORATED' END), ARRAY[]::text[])
  FROM public.daily_statement_attempt_attestations a
  WHERE a.attempt_id = p_attempt_id AND a.action = 'ATTEST'
    AND NOT EXISTS (SELECT 1 FROM public.daily_statement_attempt_attestations r WHERE r.revokes_id = a.id)
$$;

-- Liste des journées admissibles à l'approbation groupée d'un fichier sain (C8).
CREATE FUNCTION public.daily_stmt_batch_candidates(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH a AS (
    SELECT t.*, public.daily_stmt_attempt_resolved_codes(t.id) AS resolved
    FROM public.daily_statement_export_attempts t WHERE t.id = p_attempt_id
  ), healthy AS (
    SELECT a.*, NOT EXISTS (
             SELECT 1 FROM unnest(coalesce(a.review_reason_codes, ARRAY[]::text[])) c WHERE NOT (c = ANY (a.resolved))) AS ok
    FROM a
  ), days AS (
    SELECT s.id, s.day_unit_id, s.day_content_hash, s.validation_status, c.id AS canonical_id,
           c.active_day_content_hash AS canonical_hash
    FROM healthy h
    JOIN public.daily_statement_units_staging s ON s.attempt_id = h.id
    LEFT JOIN public.daily_statement_units_canonical c ON c.day_unit_id = s.day_unit_id AND c.status = 'ingested'
    WHERE h.ok AND s.status = 'staged' AND s.aggregates_status = 'derived'
      AND (s.validation_status = 'valid'
           OR (s.validation_status = 'needs_review' AND cardinality(s.review_reason_codes) > 0
               AND NOT EXISTS (SELECT 1 FROM unnest(s.review_reason_codes) c2
                               WHERE NOT (c2 = ANY (h.resolved))
                                  OR c2 NOT IN ('ACCOUNT_IDENTITY_NOT_CORROBORATED', 'TRUSTED_CURRENCY_UNCORROBORATED'))))
  )
  SELECT jsonb_build_object(
    'days', coalesce((SELECT jsonb_agg(jsonb_build_object(
              'staging_unit_id', d.id, 'day_unit_id', d.day_unit_id, 'day_content_hash', d.day_content_hash,
              'canonical_unit_id', d.canonical_id, 'canonical_content_hash', d.canonical_hash)
              ORDER BY d.day_unit_id COLLATE "C", d.id) FROM days d), '[]'::jsonb),
    'attestation_ids', coalesce((SELECT jsonb_agg(x.id ORDER BY x.id)
              FROM public.daily_statement_attempt_attestations x
              WHERE x.attempt_id = p_attempt_id AND x.action = 'ATTEST'
                AND NOT EXISTS (SELECT 1 FROM public.daily_statement_attempt_attestations r WHERE r.revokes_id = x.id)),
              '[]'::jsonb))
$$;

-- 5.4 Approbation groupée par fichier (C8) : exactement la logique de la
-- promotion unitaire existante, journée par journée, dans une transaction.
CREATE FUNCTION public.promote_daily_statement_attempt_units(
  p_command_key text, p_attempt_id uuid, p_expected jsonb, p_approval_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid;
  v_prior    jsonb;
  v_reason   text;
  v_day      text;
  v_actual   jsonb;
  v_expected jsonb;
  v_item     jsonb;
  v_unit     public.daily_statement_units_staging%ROWTYPE;
  v_r        jsonb;
  v_event    uuid;
  v_results  jsonb := '[]'::jsonb;
  v_rank     integer := 0;
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('daily');
  v_actor := public.daily_stmt_require_decision_actor(false);
  v_prior := daily_v2_private.command_begin(v_actor, 'PROMOTE_ATTEMPT_UNITS', p_command_key, jsonb_build_object(
    'attempt', p_attempt_id, 'expected', p_expected, 'reason', p_approval_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := public.daily_stmt_assert_safe_operator_reason(p_approval_reason);
  IF NOT EXISTS (SELECT 1 FROM public.daily_statement_export_attempts WHERE id = p_attempt_id) THEN
    RAISE EXCEPTION 'DAILY_STMT_ATTEMPT_NOT_FOUND (fail-closed)';
  END IF;

  -- Verrous de journée dans l'ordre contractuel du dépôt, puis tentative en partage.
  FOR v_day IN SELECT x.day_unit_id
                 FROM (SELECT DISTINCT s.day_unit_id FROM public.daily_statement_units_staging s
                       WHERE s.attempt_id = p_attempt_id) x
                ORDER BY x.day_unit_id COLLATE "C" LOOP
    PERFORM public.daily_stmt_acquire_day_lock(v_day);
  END LOOP;
  PERFORM public.daily_stmt_acquire_attempt_lock(p_attempt_id, false);

  v_actual := public.daily_stmt_batch_candidates(p_attempt_id);
  v_expected := jsonb_build_object(
    'days', coalesce((SELECT jsonb_agg(e ORDER BY e ->> 'day_unit_id' COLLATE "C", e ->> 'staging_unit_id')
                      FROM jsonb_array_elements(coalesce(p_expected -> 'days', '[]'::jsonb)) e), '[]'::jsonb),
    'attestation_ids', coalesce((SELECT jsonb_agg(e ORDER BY e #>> '{}')
                      FROM jsonb_array_elements(coalesce(p_expected -> 'attestation_ids', '[]'::jsonb)) e), '[]'::jsonb));
  IF jsonb_array_length(v_actual -> 'days') = 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_BATCH_EMPTY: no admissible day in this file (fail-closed)';
  END IF;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'DAILY_STMT_BATCH_LIST_STALE: admissible list changed since display (fail-closed)';
  END IF;
  IF jsonb_array_length(v_actual -> 'days') > 45 THEN
    RAISE EXCEPTION 'DAILY_STMT_BATCH_TOO_LARGE (fail-closed)';
  END IF;

  FOR v_item IN SELECT e FROM jsonb_array_elements(v_actual -> 'days') e LOOP
    v_rank := v_rank + 1;
    SELECT * INTO v_unit FROM public.daily_statement_units_staging WHERE id = (v_item ->> 'staging_unit_id')::uuid;
    v_r := public.daily_stmt_promote_scoped_core_0w(
      v_unit.id, CASE WHEN v_unit.validation_status = 'needs_review' OR v_unit.aggregates_status = 'unavailable'
                      THEN v_reason END);
    SELECT e.id INTO v_event FROM public.daily_statement_import_events e
    WHERE e.staging_unit_id = v_unit.id AND e.event_type = 'unit_promotion_approved'
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'rank', v_rank, 'staging_unit_id', v_unit.id, 'outcome', v_r ->> 'outcome',
      'canonical_unit_id', v_r ->> 'canonical_unit_id', 'approval_event_id', v_event));
  END LOOP;

  RETURN daily_v2_private.command_finish(p_command_key, jsonb_build_object(
    'outcome', 'batch_processed', 'attempt_id', p_attempt_id, 'days', v_results));
END;
$$;

-- 5.5 Correction des seuls soldes (C4 bis) : adopte une version aux mêmes
-- mouvements et à la version financière différente, dérivée et cohérente,
-- dont les lignes conservées (H1) sont conformes. Construite sur le cœur de
-- promotion existant, inchangé.
CREATE FUNCTION public.supersede_daily_statement_unit_balances(
  p_command_key text, p_canonical_unit_id uuid, p_corrective_staging_unit_id uuid,
  p_expected_corrective_version_key text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor        uuid;
  v_prior        jsonb;
  v_reason       text;
  v_new_unit     public.daily_statement_units_staging%ROWTYPE;
  v_old          public.daily_statement_units_canonical%ROWTYPE;
  v_new_id       uuid;
  v_active_count integer;
  v_old_lines    integer;
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('daily');
  v_actor := public.daily_stmt_require_decision_actor(false);
  v_prior := daily_v2_private.command_begin(v_actor, 'SUPERSEDE_BALANCES', p_command_key, jsonb_build_object(
    'canonical', p_canonical_unit_id, 'corrective', p_corrective_staging_unit_id,
    'version', p_expected_corrective_version_key, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := public.daily_stmt_assert_safe_operator_reason(p_reason);

  SELECT * INTO v_new_unit FROM public.daily_statement_units_staging WHERE id = p_corrective_staging_unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_STAGING_NOT_FOUND (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_acquire_day_lock(v_new_unit.day_unit_id);
  SELECT * INTO v_new_unit FROM public.daily_statement_units_staging WHERE id = p_corrective_staging_unit_id;
  IF v_new_unit.status <> 'duplicate' THEN
    RAISE EXCEPTION 'DAILY_STMT_BALANCES_GATE: corrective delivery must be a recorded duplicate (fail-closed)';
  END IF;
  IF public.daily_stmt_version_key(v_new_unit.day_content_hash, v_new_unit.aggregates_status,
       v_new_unit.opening_balance_derived, v_new_unit.closing_balance_derived, v_new_unit.day_total_debits,
       v_new_unit.day_total_credits) IS DISTINCT FROM p_expected_corrective_version_key THEN
    RAISE EXCEPTION 'DAILY_STMT_BALANCES_STALE: corrective version changed since display (fail-closed)';
  END IF;

  SELECT * INTO v_old FROM public.daily_statement_units_canonical WHERE id = p_canonical_unit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_OLD_CANONICAL_NOT_FOUND (fail-closed)';
  END IF;
  IF v_old.status <> 'ingested' THEN
    RAISE EXCEPTION 'DAILY_STMT_STALE_CANONICAL: target is no longer the active canonical day (fail-closed)';
  END IF;
  IF v_old.day_unit_id <> v_new_unit.day_unit_id THEN
    RAISE EXCEPTION 'DAILY_STMT_SUPERSEDE_DAY_MISMATCH: not the same accounting day (fail-closed)';
  END IF;
  IF v_old.active_day_content_hash <> v_new_unit.day_content_hash THEN
    RAISE EXCEPTION 'DAILY_STMT_BALANCES_MOVEMENTS_DIFFER: use supersede for different movements (fail-closed)';
  END IF;
  IF (v_old.aggregates_status, v_old.opening_balance_derived, v_old.closing_balance_derived,
      v_old.day_total_debits, v_old.day_total_credits)
     IS NOT DISTINCT FROM (v_new_unit.aggregates_status, v_new_unit.opening_balance_derived,
      v_new_unit.closing_balance_derived, v_new_unit.day_total_debits, v_new_unit.day_total_credits) THEN
    RAISE EXCEPTION 'DAILY_STMT_BALANCES_SAME_VERSION (fail-closed)';
  END IF;
  IF v_new_unit.aggregates_status <> 'derived'
     OR NOT public.daily_stmt_version_coherent(v_new_unit.aggregates_status, v_new_unit.opening_balance_derived,
              v_new_unit.closing_balance_derived, v_new_unit.day_total_debits, v_new_unit.day_total_credits) THEN
    RAISE EXCEPTION 'DAILY_STMT_BALANCES_VERSION_UNUSABLE: corrective version must be derived and coherent (fail-closed)';
  END IF;
  IF NOT public.daily_stmt_staging_lines_conform(v_new_unit.id) THEN
    RAISE EXCEPTION 'DAILY_STMT_BALANCES_LINES_UNUSABLE: corrective lines missing or not conforming; redeposit (fail-closed)';
  END IF;

  UPDATE public.daily_statement_units_staging SET status = 'conflict' WHERE id = v_new_unit.id;
  PERFORM public.daily_stmt_append_audit_event(
    v_actor, v_new_unit.attempt_id, v_new_unit.id, v_old.id, v_new_unit.day_unit_id, NULL,
    'status_changed', 'duplicate', 'conflict', 'corrective delivery queued for a balance-only correction',
    jsonb_build_object('reason_code', 'balances_correction_requeued', 'previous_status', 'duplicate', 'new_status', 'conflict'));

  v_new_id := gen_random_uuid();
  UPDATE public.daily_statement_units_canonical
    SET status = 'superseded', superseded_by = v_new_id, superseded_at = now()
    WHERE id = v_old.id;
  UPDATE public.daily_statement_lines_canonical
    SET is_active = false
    WHERE canonical_unit_id = v_old.id AND is_active;
  PERFORM public.daily_stmt_append_audit_event(
    v_actor, v_new_unit.attempt_id, NULL, v_old.id, v_old.day_unit_id, NULL,
    'unit_superseded', 'ingested', 'superseded', v_reason,
    jsonb_build_object('resolution', 'balances_superseded', 'day_unit_id', v_old.day_unit_id));

  PERFORM public.daily_stmt_promote_unit_core(v_new_unit.id, v_new_id, v_actor);

  SELECT count(*) INTO v_active_count FROM public.daily_statement_units_canonical
  WHERE day_unit_id = v_new_unit.day_unit_id AND status = 'ingested';
  IF v_active_count <> 1 THEN
    RAISE EXCEPTION 'DAILY_STMT_SUPERSEDE_POSTCONDITION: active canonical count <> 1 (rollback)';
  END IF;
  SELECT count(*) INTO v_old_lines FROM public.daily_statement_lines_canonical
  WHERE canonical_unit_id = v_old.id AND is_active;
  IF v_old_lines <> 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_SUPERSEDE_POSTCONDITION: superseded lines still active (rollback)';
  END IF;

  RETURN daily_v2_private.command_finish(p_command_key, jsonb_build_object(
    'outcome', 'balances_superseded', 'old_canonical_unit_id', v_old.id, 'new_canonical_unit_id', v_new_id));
END;
$$;

-- 5.6 Réfutation d'une version non retenue, justifiée source par source (C4 bis).
CREATE FUNCTION public.refute_daily_statement_version(
  p_command_key text, p_day_unit_id text, p_refuted_version_key text, p_expected_retained_version_key text,
  p_expected_sources jsonb, p_proof jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor        uuid;
  v_prior        jsonb;
  v_reason       text;
  v_active       public.daily_statement_units_canonical%ROWTYPE;
  v_retained_key text;
  v_rep          public.daily_statement_units_staging%ROWTYPE;
  v_comparison   text;
  v_actual_src   jsonb;
  v_expected_src jsonb;
  v_kind         text := p_proof ->> 'kind';
  v_proof_unit   public.daily_statement_units_staging%ROWTYPE;
  v_proof_att    public.daily_statement_export_attempts%ROWTYPE;
  v_bound        date;
  v_piece_id     uuid;
  v_piece        public.daily_statement_correction_pieces%ROWTYPE;
  v_sha          text;
  v_piece_ref    text;
  v_archive_ref  text;
  v_issued       date;
  v_today        date := (statement_timestamp() AT TIME ZONE 'Africa/Dakar')::date;
  v_open         numeric;
  v_close        numeric;
  v_deb          numeric;
  v_cred         numeric;
  v_need_bal     boolean;
  v_need_tot     boolean;
  v_unjustified  integer;
  v_active_ref   uuid;
  v_after        uuid;
  v_id           uuid;
  v_n_sources    integer;
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('daily');
  v_actor := public.daily_stmt_require_decision_actor(true);
  v_prior := daily_v2_private.command_begin(v_actor, 'REFUTE_VERSION', p_command_key, jsonb_build_object(
    'day', p_day_unit_id, 'refuted', p_refuted_version_key, 'retained', p_expected_retained_version_key,
    'sources', p_expected_sources, 'proof', p_proof, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := public.daily_stmt_assert_safe_operator_reason(p_reason);

  PERFORM public.daily_stmt_acquire_day_lock(p_day_unit_id);
  SELECT * INTO v_active FROM public.daily_statement_units_canonical
  WHERE day_unit_id = p_day_unit_id AND status = 'ingested';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_NO_RETAINED_DAY (fail-closed)';
  END IF;
  v_retained_key := public.daily_stmt_version_key(v_active.active_day_content_hash, v_active.aggregates_status,
    v_active.opening_balance_derived, v_active.closing_balance_derived, v_active.day_total_debits, v_active.day_total_credits);
  IF v_retained_key IS DISTINCT FROM p_expected_retained_version_key THEN
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_STALE: retained version changed since display (fail-closed)';
  END IF;
  IF p_refuted_version_key = v_retained_key THEN
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_TARGET_RETAINED (fail-closed)';
  END IF;
  SELECT * INTO v_rep FROM public.daily_statement_units_staging s
  WHERE s.day_unit_id = p_day_unit_id AND s.status NOT IN ('provisional', 'superseded')
    AND public.daily_stmt_version_key(s.day_content_hash, s.aggregates_status, s.opening_balance_derived,
          s.closing_balance_derived, s.day_total_debits, s.day_total_credits) = p_refuted_version_key
  ORDER BY s.created_at, s.id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_VERSION_UNKNOWN (fail-closed)';
  END IF;
  v_comparison := public.daily_stmt_version_compare(
    v_rep.day_content_hash, v_rep.aggregates_status, v_rep.opening_balance_derived, v_rep.closing_balance_derived,
    v_rep.day_total_debits, v_rep.day_total_credits,
    v_active.active_day_content_hash, v_active.aggregates_status, v_active.opening_balance_derived,
    v_active.closing_balance_derived, v_active.day_total_debits, v_active.day_total_credits);
  IF v_comparison NOT IN ('CONTRADICTION', 'INSUFFICIENT_UNAVAILABLE', 'INSUFFICIENT_INCOHERENT') THEN
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_NOT_APPLICABLE: % is not refutable (fail-closed)', v_comparison;
  END IF;
  IF v_comparison LIKE 'INSUFFICIENT%' AND (v_active.aggregates_status <> 'derived'
     OR NOT public.daily_stmt_version_coherent(v_active.aggregates_status, v_active.opening_balance_derived,
              v_active.closing_balance_derived, v_active.day_total_debits, v_active.day_total_credits)) THEN
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_RETAINED_UNPROVABLE: the retained version has no coherent derived balances (fail-closed)';
  END IF;

  -- État attendu : liste exacte des sources affichées.
  SELECT coalesce(jsonb_agg(jsonb_build_object('raw_text_hash', s.raw_text_hash, 'account_registry_id', s.account_registry_id,
                    'first_seen_at', s.first_seen_at) ORDER BY s.raw_text_hash, s.account_registry_id), '[]'::jsonb)
    INTO v_actual_src FROM public.daily_stmt_version_sources(p_day_unit_id, p_refuted_version_key) s;
  SELECT coalesce(jsonb_agg(jsonb_build_object('raw_text_hash', e ->> 'raw_text_hash',
                    'account_registry_id', (e ->> 'account_registry_id')::uuid,
                    'first_seen_at', (e ->> 'first_seen_at')::timestamptz)
                    ORDER BY e ->> 'raw_text_hash', e ->> 'account_registry_id'), '[]'::jsonb)
    INTO v_expected_src FROM jsonb_array_elements(coalesce(p_expected_sources, '[]'::jsonb)) e;
  IF v_actual_src IS DISTINCT FROM v_expected_src THEN
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_STALE: sources changed since display (fail-closed)';
  END IF;

  IF v_kind = 'FRESH_DELIVERY' THEN
    SELECT * INTO v_proof_unit FROM public.daily_statement_units_staging
    WHERE id = (p_proof ->> 'staging_unit_id')::uuid;
    IF NOT FOUND OR v_proof_unit.day_unit_id <> p_day_unit_id OR v_proof_unit.status NOT IN ('promoted', 'duplicate')
       OR public.daily_stmt_version_key(v_proof_unit.day_content_hash, v_proof_unit.aggregates_status,
            v_proof_unit.opening_balance_derived, v_proof_unit.closing_balance_derived, v_proof_unit.day_total_debits,
            v_proof_unit.day_total_credits) <> v_retained_key THEN
      RAISE EXCEPTION 'DAILY_STMT_REFUTATION_PROOF_INVALID: fresh delivery must carry the retained version (fail-closed)';
    END IF;
    SELECT * INTO v_proof_att FROM public.daily_statement_export_attempts WHERE id = v_proof_unit.attempt_id;
    -- Borne : dernière journée livrée par le fichier, au plus tard le jour de son dépôt.
    SELECT max(s.accounting_date) INTO v_bound FROM public.daily_statement_units_staging s
    WHERE s.attempt_id = v_proof_att.id
      AND s.accounting_date <= (v_proof_att.created_at AT TIME ZONE 'Africa/Dakar')::date;
    IF v_bound IS NULL THEN
      RAISE EXCEPTION 'DAILY_STMT_REFUTATION_PROOF_INVALID: no delivered day bounds the fresh delivery (fail-closed)';
    END IF;
  ELSIF v_kind = 'BANK_PIECE' THEN
    v_sha := lower(btrim(coalesce(p_proof ->> 'piece_sha256', '')));
    IF v_sha !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'DAILY_STMT_PIECE_HASH_INVALID (fail-closed)';
    END IF;
    IF coalesce((p_proof ->> 'archive_attested')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'DAILY_STMT_PIECE_ARCHIVE_ATTESTATION_REQUIRED (fail-closed)';
    END IF;
    v_piece_ref := public.daily_stmt_assert_safe_operator_reason(p_proof ->> 'piece_reference');
    v_archive_ref := public.daily_stmt_assert_safe_operator_reason(p_proof ->> 'archive_reference');
    -- Date d'émission au format ISO strict (AAAA-MM-JJ), valide au calendrier.
    IF coalesce(p_proof ->> 'issued_on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'DAILY_STMT_PIECE_DATE_INVALID (fail-closed)';
    END IF;
    v_issued := to_date(p_proof ->> 'issued_on', 'YYYY-MM-DD');
    IF to_char(v_issued, 'YYYY-MM-DD') <> p_proof ->> 'issued_on'
       OR v_issued < v_active.accounting_date OR v_issued > v_today THEN
      RAISE EXCEPTION 'DAILY_STMT_PIECE_DATE_INVALID (fail-closed)';
    END IF;
    v_open := public.daily_stmt_parse_amount_strict(p_proof ->> 'opening');
    v_close := public.daily_stmt_parse_amount_strict(p_proof ->> 'closing');
    v_deb := public.daily_stmt_parse_amount_strict(p_proof ->> 'debits');
    v_cred := public.daily_stmt_parse_amount_strict(p_proof ->> 'credits');
    -- Valeurs exigées : celles qui portent la contradiction ; elles s'additionnent.
    v_need_tot := (v_rep.day_total_credits - v_rep.day_total_debits) <> (v_active.day_total_credits - v_active.day_total_debits);
    v_need_bal := v_comparison LIKE 'INSUFFICIENT%'
                  OR (v_active.aggregates_status = 'derived' AND v_rep.aggregates_status = 'derived'
                      AND (v_rep.opening_balance_derived <> v_active.opening_balance_derived
                           OR v_rep.closing_balance_derived <> v_active.closing_balance_derived));
    IF NOT v_need_tot AND NOT v_need_bal THEN
      v_need_bal := true;
    END IF;
    IF v_need_bal AND (v_open IS NULL OR v_close IS NULL OR v_active.opening_balance_derived IS NULL) THEN
      RAISE EXCEPTION 'DAILY_STMT_PIECE_VALUES_REQUIRED: opening and closing (fail-closed)';
    END IF;
    IF v_need_tot AND (v_deb IS NULL OR v_cred IS NULL) THEN
      RAISE EXCEPTION 'DAILY_STMT_PIECE_VALUES_REQUIRED: total debits and credits (fail-closed)';
    END IF;
    IF v_active.currency = 'XOF' AND (
         (v_need_bal AND (v_active.opening_balance_derived <> trunc(v_active.opening_balance_derived)
                          OR v_active.closing_balance_derived <> trunc(v_active.closing_balance_derived)))
      OR (v_need_tot AND (v_active.day_total_debits <> trunc(v_active.day_total_debits)
                          OR v_active.day_total_credits <> trunc(v_active.day_total_credits)))) THEN
      RAISE EXCEPTION 'DAILY_STMT_PIECE_VALUE_NOT_WHOLE_XOF: retained values are not whole francs (fail-closed)';
    END IF;
    IF v_active.currency = 'XOF' AND (
         (v_need_bal AND (v_open <> trunc(v_open) OR v_close <> trunc(v_close)))
      OR (v_need_tot AND (v_deb <> trunc(v_deb) OR v_cred <> trunc(v_cred)))) THEN
      RAISE EXCEPTION 'DAILY_STMT_PIECE_VALUE_NOT_WHOLE_XOF: entered values must be whole francs (fail-closed)';
    END IF;
    IF (v_need_bal AND (v_open <> v_active.opening_balance_derived OR v_close <> v_active.closing_balance_derived))
       OR (v_need_tot AND (v_deb <> v_active.day_total_debits OR v_cred <> v_active.day_total_credits)) THEN
      RAISE EXCEPTION 'DAILY_STMT_PIECE_VALUES_MISMATCH: entered values differ from the retained version (fail-closed)';
    END IF;
    SELECT * INTO v_piece FROM public.daily_statement_correction_pieces WHERE piece_sha256 = v_sha;
    IF FOUND THEN
      IF v_piece.account_registry_id <> v_active.account_registry_id THEN
        RAISE EXCEPTION 'DAILY_STMT_PIECE_REUSED_OTHER_ACCOUNT (fail-closed)';
      END IF;
      IF v_piece.issued_on <> v_issued OR v_piece.piece_reference <> v_piece_ref
         OR v_piece.archive_reference <> v_archive_ref THEN
        RAISE EXCEPTION 'DAILY_STMT_PIECE_MISMATCH: same file recorded with another reference, archive or date (fail-closed)';
      END IF;
      v_piece_id := v_piece.id;
    ELSE
      INSERT INTO public.daily_statement_correction_pieces (
        account_registry_id, piece_sha256, piece_reference, archive_reference, issued_on, archive_attested, actor_id)
      VALUES (v_active.account_registry_id, v_sha, v_piece_ref, v_archive_ref, v_issued, true, v_actor)
      RETURNING id INTO v_piece_id;
    END IF;
    v_bound := v_issued;
  ELSE
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_PROOF_KIND_INVALID (fail-closed)';
  END IF;

  -- Justification de CHAQUE source : la preuve est strictement postérieure,
  -- au jour près, à sa première apparition.
  SELECT count(*), count(*) FILTER (WHERE NOT (v_bound > (s.first_seen_at AT TIME ZONE 'Africa/Dakar')::date))
    INTO v_n_sources, v_unjustified
  FROM public.daily_stmt_version_sources(p_day_unit_id, p_refuted_version_key) s;
  IF v_unjustified > 0 THEN
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_SOURCE_NOT_JUSTIFIED: % source(s) not justified by this proof (fail-closed)', v_unjustified;
  END IF;

  -- Une réfutation active de cette version est remplacée dans la même commande.
  SELECT a.id INTO v_active_ref FROM public.daily_statement_version_refutations a
  WHERE a.day_unit_id = p_day_unit_id AND a.refuted_version_key = p_refuted_version_key AND a.action = 'REFUTE'
    AND NOT EXISTS (SELECT 1 FROM public.daily_statement_version_refutations r WHERE r.revokes_id = a.id);
  IF v_active_ref IS NOT NULL THEN
    INSERT INTO public.daily_statement_version_refutations (
      action, day_unit_id, account_registry_id, accounting_date, refuted_version_key, retained_canonical_unit_id,
      retained_version_key, comparison, revokes_id, reason, actor_id)
    SELECT 'REVOKE', a.day_unit_id, a.account_registry_id, a.accounting_date, a.refuted_version_key,
           a.retained_canonical_unit_id, a.retained_version_key, 'NOT_APPLICABLE', a.id,
           'replaced by a refutation covering every source', v_actor
    FROM public.daily_statement_version_refutations a WHERE a.id = v_active_ref;
  END IF;
  SELECT r.id INTO v_after FROM public.daily_statement_version_refutations r
  WHERE r.day_unit_id = p_day_unit_id AND r.refuted_version_key = p_refuted_version_key AND r.action = 'REVOKE'
    AND NOT EXISTS (SELECT 1 FROM public.daily_statement_version_refutations a WHERE a.after_revocation_id = r.id)
  ORDER BY r.created_at DESC, r.id LIMIT 1;

  INSERT INTO public.daily_statement_version_refutations (
    action, day_unit_id, account_registry_id, accounting_date, refuted_version_key, retained_canonical_unit_id,
    retained_version_key, comparison, proof_kind, proof_staging_unit_id, proof_bound_day, piece_id,
    piece_opening, piece_closing, piece_debits, piece_credits, after_revocation_id, reason, actor_id)
  VALUES ('REFUTE', p_day_unit_id, v_active.account_registry_id, v_active.accounting_date, p_refuted_version_key,
          v_active.id, v_retained_key, v_comparison, v_kind,
          CASE WHEN v_kind = 'FRESH_DELIVERY' THEN v_proof_unit.id END, v_bound, v_piece_id,
          CASE WHEN v_kind = 'BANK_PIECE' AND v_need_bal THEN v_open END,
          CASE WHEN v_kind = 'BANK_PIECE' AND v_need_bal THEN v_close END,
          CASE WHEN v_kind = 'BANK_PIECE' AND v_need_tot THEN v_deb END,
          CASE WHEN v_kind = 'BANK_PIECE' AND v_need_tot THEN v_cred END,
          v_after, v_reason, v_actor)
  RETURNING id INTO v_id;
  INSERT INTO public.daily_statement_refutation_sources (
    refutation_id, raw_text_hash, account_registry_id, first_seen_at, proof_bound_day, verdict)
  SELECT v_id, s.raw_text_hash, s.account_registry_id, s.first_seen_at, v_bound, 'JUSTIFIED'
  FROM public.daily_stmt_version_sources(p_day_unit_id, p_refuted_version_key) s;

  RETURN daily_v2_private.command_finish(p_command_key, jsonb_build_object(
    'outcome', 'refuted', 'refutation_id', v_id, 'proof_kind', v_kind, 'sources', v_n_sources,
    'comparison', v_comparison, 'replaced_refutation_id', v_active_ref, 'piece_id', v_piece_id));
END;
$$;

-- 5.7 Révocation d'une réfutation.
CREATE FUNCTION public.revoke_daily_statement_version_refutation(
  p_command_key text, p_refutation_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid;
  v_prior  jsonb;
  v_reason text;
  v_ref    public.daily_statement_version_refutations%ROWTYPE;
  v_id     uuid;
BEGIN
  PERFORM daily_v2_private.assert_runtime_scope('daily');
  v_actor := public.daily_stmt_require_decision_actor(true);
  v_prior := daily_v2_private.command_begin(v_actor, 'REVOKE_REFUTATION', p_command_key,
    jsonb_build_object('refutation', p_refutation_id, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  v_reason := public.daily_stmt_assert_safe_operator_reason(p_reason);
  SELECT * INTO v_ref FROM public.daily_statement_version_refutations WHERE id = p_refutation_id AND action = 'REFUTE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY_STMT_REFUTATION_NOT_FOUND (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_acquire_day_lock(v_ref.day_unit_id);
  IF EXISTS (SELECT 1 FROM public.daily_statement_version_refutations r WHERE r.revokes_id = p_refutation_id) THEN
    RAISE EXCEPTION 'DAILY_STMT_ALREADY_REVOKED (fail-closed)';
  END IF;
  INSERT INTO public.daily_statement_version_refutations (
    action, day_unit_id, account_registry_id, accounting_date, refuted_version_key, retained_canonical_unit_id,
    retained_version_key, comparison, revokes_id, reason, actor_id)
  VALUES ('REVOKE', v_ref.day_unit_id, v_ref.account_registry_id, v_ref.accounting_date, v_ref.refuted_version_key,
          v_ref.retained_canonical_unit_id, v_ref.retained_version_key, 'NOT_APPLICABLE', v_ref.id, v_reason, v_actor)
  RETURNING id INTO v_id;
  RETURN daily_v2_private.command_finish(p_command_key, jsonb_build_object(
    'outcome', 'revoked', 'revocation_id', v_id, 'refutation_id', p_refutation_id));
END;
$$;

-- --------------------------------------------------------------------------
-- 6. RLS et privilèges minimaux
-- --------------------------------------------------------------------------
ALTER TABLE public.daily_statement_attempt_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_correction_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_version_refutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_statement_refutation_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_v2_private.decision_commands ENABLE ROW LEVEL SECURITY;

-- Lecture par les rôles qui lisent déjà les tentatives ; aucune écriture directe.
CREATE POLICY daily_statement_attempt_attestations_select ON public.daily_statement_attempt_attestations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role)
      OR public.has_role(auth.uid(), 'auditor'::public.app_role));
CREATE POLICY daily_statement_correction_pieces_select ON public.daily_statement_correction_pieces
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role)
      OR public.has_role(auth.uid(), 'auditor'::public.app_role));
CREATE POLICY daily_statement_version_refutations_select ON public.daily_statement_version_refutations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role)
      OR public.has_role(auth.uid(), 'auditor'::public.app_role));
CREATE POLICY daily_statement_refutation_sources_select ON public.daily_statement_refutation_sources
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role)
      OR public.has_role(auth.uid(), 'auditor'::public.app_role));

REVOKE ALL ON TABLE public.daily_statement_attempt_attestations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_statement_correction_pieces FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_statement_version_refutations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.daily_statement_refutation_sources FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE daily_v2_private.decision_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.daily_statement_attempt_attestations TO authenticated;
GRANT SELECT ON TABLE public.daily_statement_correction_pieces TO authenticated;
GRANT SELECT ON TABLE public.daily_statement_version_refutations TO authenticated;
GRANT SELECT ON TABLE public.daily_statement_refutation_sources TO authenticated;

REVOKE ALL ON FUNCTION public.daily_stmt_version_coherent(text, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_version_key(text, text, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_version_compare(text, text, numeric, numeric, numeric, numeric,
  text, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_staging_lines_conform(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_h1_keep_lines(text, text, text, numeric, numeric, numeric, numeric, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_version_facts(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_version_sources(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_attempt_resolved_codes(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_batch_candidates(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_acquire_attempt_lock(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_require_decision_actor(boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.daily_stmt_block_decision_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION daily_v2_private.guard_decision_commands() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION daily_v2_private.command_begin(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION daily_v2_private.command_finish(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.attest_daily_statement_attempt(text, uuid, text, text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_daily_statement_attempt_attestation(text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_daily_statement_unit(text, uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.promote_daily_statement_attempt_units(text, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.supersede_daily_statement_unit_balances(text, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refute_daily_statement_version(text, text, text, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_daily_statement_version_refutation(text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.attest_daily_statement_attempt(text, uuid, text, text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_daily_statement_attempt_attestation(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_daily_statement_unit(text, uuid, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_daily_statement_attempt_units(text, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_daily_statement_unit_balances(text, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refute_daily_statement_version(text, text, text, text, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_daily_statement_version_refutation(text, uuid, text) TO authenticated;

COMMENT ON TABLE public.daily_statement_correction_pieces IS
  'Pièces correctives bancaires archivées par SODATRA hors de l''application : attestation sur pièce archivée, contenu non vérifié automatiquement. Aucun fichier n''est stocké.';
COMMENT ON FUNCTION public.refute_daily_statement_version(text, text, text, text, jsonb, jsonb, text) IS
  'Réfute une version non retenue : chaque source (empreinte, compte, journée, version) doit être justifiée par une preuve bancaire strictement postérieure à sa première apparition.';

-- --------------------------------------------------------------------------
-- 7. Exception H1 dans les deux cœurs vivants du dépôt
-- --------------------------------------------------------------------------
-- Redéfinition à signature identique ; seules changent la condition de
-- stockage des lignes d'un doublon R1 et le `reason_code` de son événement.

CREATE OR REPLACE FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(
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
  v_keep_lines       boolean;
  v_new_unit         public.daily_statement_units_staging%ROWTYPE;

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

  -- cycle de vie provisional (0Z)
  v_prev_provisional   public.daily_statement_units_staging%ROWTYPE;
  v_keep_provisional   uuid;
  v_dup_of_provisional boolean;
  v_swept              record;
  v_live_provisional   integer;
  v_unit_event_type    text;
  v_unit_event_message text;

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
  -- Plafonds STRUCTURELS du backfill (0K) : un dépôt BIS reste massif mais
  -- borné — jamais de payload illimité, même sous grant admin.
  c_max_backfill_period_days constant integer := 4000;
  c_max_backfill_units       constant integer := 4000;
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
    -- Plafonds structurels 0K. Le cap d'unités est contrôlé ICI, AVANT la
    -- boucle de validation de p_units : un payload massif accidentel est
    -- rejeté sans être parsé unité par unité.
    IF v_period_days > c_max_backfill_period_days THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_PERIOD_CAP: backfill window above the structural %-day cap (fail-closed)', c_max_backfill_period_days;
    END IF;
    IF jsonb_array_length(p_units) > c_max_backfill_units THEN
      RAISE EXCEPTION 'DAILY_STMT_BACKFILL_UNITS_CAP: backfill deposit above the structural %-unit cap (fail-closed)', c_max_backfill_units;
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
    v_keep_provisional := NULL;
    v_dup_of_provisional := false;

    IF v_req_status[v_i] = 'provisional' THEN
      -- D-0H-4 conservé : jamais promouvable, hors arbitrage canonical.
      -- 0Z (D-0Z-1/D-0Z-2) : arbitrage R1-provisional contre la provisional
      -- VIVANTE la plus récente du même day_unit_id, sous le verrou journée.
      SELECT * INTO v_prev_provisional
      FROM public.daily_statement_units_staging
      WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'provisional'
      ORDER BY created_at DESC, id DESC
      LIMIT 1;

      IF FOUND AND v_prev_provisional.day_content_hash = v_content_hashes[v_i] THEN
        -- Redépôt strictement identique : duplicate contrôlé, AUCUNE ligne
        -- sensible re-stagée ; la provisional d'origine reste la version
        -- vivante unique de la journée.
        v_final := 'duplicate';
        v_dup_of_provisional := true;
        v_keep_provisional := v_prev_provisional.id;
      ELSE
        v_final := 'provisional';
      END IF;
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

    -- 0Z (D-0Z-2/D-0Z-3/D-0Z-4) : balayage des provisional vivantes périmées
    -- du même day_unit_id, sous le même verrou journée. Journée non close :
    -- seule la version courante survit (la plus récente identique, ou la
    -- nouvelle unité insérée ci-dessous). Journée close (chemin 'staged',
    -- quel que soit le verdict R1/R2/R3) : plus aucune provisional vivante.
    -- Append-only préservé : UPDATE de statut + événement, jamais de DELETE.
    FOR v_swept IN
      SELECT id FROM public.daily_statement_units_staging
      WHERE day_unit_id = v_day_unit_ids[v_i]
        AND status = 'provisional'
        AND (v_keep_provisional IS NULL OR id <> v_keep_provisional)
      ORDER BY created_at, id
    LOOP
      UPDATE public.daily_statement_units_staging
        SET status = 'superseded'
        WHERE id = v_swept.id;
      PERFORM public.daily_stmt_append_audit_event(
        v_actor, v_attempt_id, v_swept.id, NULL,
        v_day_unit_ids[v_i], v_rth,
        'status_changed', 'provisional', 'superseded',
        CASE WHEN v_req_status[v_i] = 'provisional'
             THEN 'stale provisional unit superseded by redeposit of the same non-closed day'
             ELSE 'stale provisional unit superseded: the day is now closed'
        END,
        jsonb_build_object(
          'reason_code', CASE WHEN v_req_status[v_i] = 'provisional'
                              THEN 'provisional_superseded_by_redeposit'
                              ELSE 'provisional_superseded_by_day_closure' END,
          'day_unit_id', v_day_unit_ids[v_i],
          'previous_status', 'provisional',
          'new_status', 'superseded')
      );
    END LOOP;

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

    -- R1 duplicate (canonical OU provisional) : AUCUNE ligne stagée — le
    -- contenu identique vit déjà en canonical ou dans la provisional vivante
    -- (ne pas dupliquer des libellés sensibles). Tous les autres statuts
    -- conservent leurs lignes (conflict = matière du futur supersede).
    -- Exception H1 : un doublon R1 de l'unité canonique active dont la version
    -- financière diffère, dérivée et cohérente, conserve ses lignes (matière de
    -- la correction des seuls soldes), sauf si un autre doublon de même version
    -- en détient déjà une copie conforme. Jamais pour un doublon R1-provisional.
    v_keep_lines := false;
    IF v_final = 'duplicate' AND NOT v_dup_of_provisional AND v_active_id IS NOT NULL THEN
      SELECT * INTO v_new_unit FROM public.daily_statement_units_staging WHERE id = v_staging_unit_id;
      v_keep_lines := public.daily_stmt_h1_keep_lines(
        v_new_unit.day_unit_id, v_new_unit.day_content_hash, v_new_unit.aggregates_status,
        v_new_unit.opening_balance_derived, v_new_unit.closing_balance_derived,
        v_new_unit.day_total_debits, v_new_unit.day_total_credits, v_active_id, v_new_unit.id);
    END IF;
    IF v_final <> 'duplicate' OR v_keep_lines THEN
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

    v_unit_event_type := CASE v_final
      WHEN 'staged'       THEN 'unit_staged'
      WHEN 'provisional'  THEN 'unit_provisional_held'
      WHEN 'duplicate'    THEN 'unit_duplicate'
      WHEN 'conflict'     THEN 'unit_conflict'
      ELSE 'unit_needs_review'
    END;
    v_unit_event_message := CASE
      WHEN v_final = 'duplicate' AND v_dup_of_provisional
        THEN 'exact duplicate of the live provisional day unit (R1-provisional, 0Z)'
      WHEN v_final = 'staged'      THEN 'daily unit staged'
      WHEN v_final = 'provisional' THEN 'non-closed day held provisional (never promotable)'
      WHEN v_final = 'duplicate'   THEN 'exact duplicate of the active canonical day (R1)'
      WHEN v_final = 'conflict'    THEN 'same day_unit_id with different day_content_hash than active canonical (R2)'
      ELSE 'active daily_line_hash overlap with another day unit (R3)'
    END;

    PERFORM public.daily_stmt_append_audit_event(
      v_actor, v_attempt_id, v_staging_unit_id, v_active_id,
      v_day_unit_ids[v_i], v_rth,
      v_unit_event_type,
      NULL, v_final,
      v_unit_event_message,
      jsonb_build_object('day_unit_id', v_day_unit_ids[v_i],
                         'day_content_hash', v_content_hashes[v_i],
                         'line_count', v_line_counts[v_i])
      || CASE WHEN v_dup_of_provisional
              THEN jsonb_build_object('reason_code', 'provisional_redeposit_duplicate')
              WHEN v_keep_lines
              THEN jsonb_build_object('reason_code', 'duplicate_financial_version_differs')
              ELSE '{}'::jsonb END
    );

    -- 0Z (D-0Z-5) postcondition : nombre de provisional vivantes déterministe
    -- par journée après traitement (toute violation => rollback intégral).
    SELECT count(*) INTO v_live_provisional
    FROM public.daily_statement_units_staging
    WHERE day_unit_id = v_day_unit_ids[v_i] AND status = 'provisional';
    IF v_req_status[v_i] = 'provisional' AND v_live_provisional <> 1 THEN
      RAISE EXCEPTION 'DAILY_STMT_PROVISIONAL_POSTCONDITION: exactly one live provisional unit expected for a non-closed day (rollback)';
    ELSIF v_req_status[v_i] <> 'provisional' AND v_live_provisional <> 0 THEN
      RAISE EXCEPTION 'DAILY_STMT_PROVISIONAL_POSTCONDITION: no live provisional unit may survive a closed-day deposit (rollback)';
    END IF;

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

COMMENT ON FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(jsonb, jsonb, jsonb, jsonb) IS
  'Cœur interne du dépôt Daily v2 (0H, renommé par 0U, cycle de vie provisional fermé par 0Z, exception H1 du Lot 1 opérationnel). Jamais exposé : seule l''enveloppe pre_ingest_daily_statement_units l''appelle.';

-- Double verrou re-affirmé : le cœur interne reste inexécutable par tout rôle
-- applicatif (CREATE OR REPLACE préserve l'ACL ; ceinture explicite).
REVOKE ALL ON FUNCTION public.daily_stmt_pre_ingest_legacy_core_0u(jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.daily_stmt_pre_ingest_bis_backfill_core_0v(
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
  v_actor uuid := auth.uid();
  v_attempt_id uuid;
  v_source_format text;
  v_currency text;
  v_fingerprint text;
  v_masked text;
  v_file_name text;
  v_raw_hash text;
  v_period_start date;
  v_period_end date;
  v_period_days integer;
  v_parser_status text;
  v_errors_count integer;
  v_warnings_count integer;
  v_units_count integer;
  v_decisions jsonb;
  v_events jsonb;
  v_expected integer;
  v_inserted integer;
  v_lock_day_unit_id text;
  c_attempt_allowed constant text[] := ARRAY[
    'requested_mode','source_format','bank','currency','account_fingerprint',
    'account_number_masked','source_file_name_redacted','raw_text_hash',
    'export_period_start','export_period_end','statement_date',
    'export_reference_date','parser_validation_status','errors_count',
    'warnings_count','runtime_version','parser_version'
  ];
  c_unit_allowed constant text[] := ARRAY[
    'day_unit_id','accounting_date','day_content_hash','line_count',
    'day_total_debits','day_total_credits','opening_balance_derived',
    'closing_balance_derived','aggregates_status','validation_status',
    'requested_unit_status'
  ];
  c_line_allowed constant text[] := ARRAY[
    'day_unit_id','daily_line_hash','daily_occurrence_ordinal',
    'source_line_index','accounting_date','value_date',
    'description_sanitized','debit_amount','credit_amount','signed_amount',
    'running_balance','direction','currency'
  ];
  c_guard_allowed constant text[] := ARRAY[
    'ingestion_ready','period_days','bridge_guard_passed',
    'backfill_grant_reference'
  ];
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor,'admin'::public.app_role) THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_ADMIN_ONLY: backfill deposits require the admin role (fail-closed)';
  END IF;
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_attempt,'$.p_attempt');
  PERFORM public.daily_stmt_assert_no_forbidden_keys(p_guard_context,'$.p_guard_context');
  PERFORM public.daily_stmt_assert_object_keys(p_attempt,c_attempt_allowed,'p_attempt');
  PERFORM public.daily_stmt_assert_object_keys(p_guard_context,c_guard_allowed,'p_guard_context');
  IF p_units IS NULL OR jsonb_typeof(p_units) <> 'array' OR jsonb_array_length(p_units)=0
     OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_ARRAYS_REQUIRED: non-empty unit and line arrays required (fail-closed)';
  END IF;

  IF p_attempt ->> 'requested_mode' <> 'backfill'
     OR btrim(coalesce(p_attempt ->> 'bank','')) <> 'BIS' THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_SCOPE: optimized core accepts BIS backfill only (fail-closed)';
  END IF;
  -- Un backfill historique ne contient aucune journée non close. Ce contrat
  -- réduit la surface du chemin massif ; tout autre cas reste fail-closed.
  IF p_attempt ->> 'export_reference_date' IS NOT NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_REFERENCE_DATE_FORBIDDEN: historical backfill must contain closed days only (fail-closed)';
  END IF;
  v_source_format := nullif(btrim(coalesce(p_attempt ->> 'source_format','')),'');
  v_currency := nullif(btrim(coalesce(p_attempt ->> 'currency','')),'');
  v_fingerprint := nullif(btrim(coalesce(p_attempt ->> 'account_fingerprint','')),'');
  IF v_source_format IS NULL OR v_currency IS NULL OR v_fingerprint IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_SOURCE_REQUIRED: source format, currency and fingerprint required (fail-closed)';
  END IF;
  v_masked := nullif(btrim(coalesce(p_attempt ->> 'account_number_masked','')),'');
  PERFORM public.daily_stmt_assert_masked_account(v_masked);
  v_file_name := nullif(btrim(coalesce(p_attempt ->> 'source_file_name_redacted','')),'');
  PERFORM public.daily_stmt_assert_safe_file_name(v_file_name);
  v_raw_hash := public.daily_stmt_assert_hex64(p_attempt ->> 'raw_text_hash','raw_text_hash');
  v_period_start := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_start');
  v_period_end := public.daily_stmt_parse_date_strict(p_attempt ->> 'export_period_end');
  IF v_period_end < v_period_start THEN
    RAISE EXCEPTION 'DAILY_STMT_PERIOD_INCOHERENT: invalid export window (fail-closed)';
  END IF;
  v_parser_status := p_attempt ->> 'parser_validation_status';
  IF v_parser_status NOT IN ('valid','needs_review') THEN
    RAISE EXCEPTION 'DAILY_STMT_PARSER_STATUS: invalid parser status (fail-closed)';
  END IF;
  IF coalesce(p_attempt ->> 'errors_count','0') !~ '^[0-9]+$'
     OR coalesce(p_attempt ->> 'warnings_count','0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DAILY_STMT_COUNT_INVALID: non-negative integer counts required (fail-closed)';
  END IF;
  v_errors_count := coalesce(p_attempt ->> 'errors_count','0')::integer;
  v_warnings_count := coalesce(p_attempt ->> 'warnings_count','0')::integer;
  IF jsonb_typeof(p_guard_context -> 'ingestion_ready') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_guard_context -> 'bridge_guard_passed') IS DISTINCT FROM 'boolean'
     OR (p_guard_context ->> 'bridge_guard_passed')::boolean IS NOT TRUE
     OR coalesce(p_guard_context ->> 'period_days','') !~ '^[0-9]+$'
     OR nullif(btrim(coalesce(p_guard_context ->> 'backfill_grant_reference','')),'') IS NULL THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_GUARD_INVALID: explicit valid guard and grant required (fail-closed)';
  END IF;
  v_period_days := (p_guard_context ->> 'period_days')::integer;
  IF v_period_days <> v_period_end-v_period_start+1 OR v_period_days > 4000 THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_PERIOD_CAP: period mismatch or structural cap exceeded (fail-closed)';
  END IF;
  v_units_count := jsonb_array_length(p_units);
  IF v_units_count > 4000 THEN
    RAISE EXCEPTION 'DAILY_STMT_BACKFILL_UNITS_CAP: structural unit cap exceeded (fail-closed)';
  END IF;

  -- Formes plates et whitelists : les valeurs objet/tableau sont interdites,
  -- donc aucune clé profonde ne peut contourner l'anti-smuggling.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_units) WITH ORDINALITY u(value,ord)
    WHERE jsonb_typeof(value) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) k WHERE NOT k=ANY(c_unit_allowed))
       OR EXISTS (SELECT 1 FROM jsonb_each(value) kv WHERE jsonb_typeof(kv.value) IN ('object','array'))
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) WITH ORDINALITY l(value,ord)
    WHERE jsonb_typeof(value) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(value) k WHERE NOT k=ANY(c_line_allowed))
       OR EXISTS (SELECT 1 FROM jsonb_each(value) kv WHERE jsonb_typeof(kv.value) IN ('object','array'))
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_PAYLOAD_KEY: BIS backfill row outside flat whitelist (fail-closed)';
  END IF;

  -- Validation des unités en un statement : identités recalculées, domaines,
  -- agrégats et unicité restent strictement contrôlés côté serveur.
  IF EXISTS (
    WITH u AS MATERIALIZED (
      SELECT ord, value,
        btrim(value ->> 'accounting_date') AS accounting_raw,
        public.daily_stmt_parse_date_strict(value ->> 'accounting_date') AS accounting_date
      FROM jsonb_array_elements(p_units) WITH ORDINALITY x(value,ord)
    )
    SELECT 1 FROM u
    WHERE value ->> 'day_unit_id' !~ '^[0-9a-f]{64}$'
       OR value ->> 'day_content_hash' !~ '^[0-9a-f]{64}$'
       OR value ->> 'day_unit_id' <>
          public.daily_stmt_day_unit_id('BIS',v_fingerprint,v_currency,accounting_raw)
       OR coalesce(value ->> 'line_count','') !~ '^[0-9]+$'
       OR (value ->> 'line_count')::integer < 1
       OR value ->> 'day_total_debits' IS NULL
       OR value ->> 'day_total_credits' IS NULL
       OR public.daily_stmt_parse_amount_strict(value ->> 'day_total_debits') IS NULL
       OR public.daily_stmt_parse_amount_strict(value ->> 'day_total_credits') IS NULL
       OR value ->> 'aggregates_status' NOT IN ('derived','unavailable')
       OR value ->> 'validation_status' NOT IN ('valid','needs_review')
       OR value ->> 'requested_unit_status' <> 'staged'
       OR (value ->> 'aggregates_status'='derived' AND
           (value ->> 'opening_balance_derived' IS NULL OR value ->> 'closing_balance_derived' IS NULL))
       OR (value ->> 'aggregates_status'='unavailable' AND
           (value ->> 'opening_balance_derived' IS NOT NULL OR value ->> 'closing_balance_derived' IS NOT NULL))
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_units) u(value)
    GROUP BY value ->> 'day_unit_id' HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_UNIT_INVALID: identity, aggregate or status invariant failed (fail-closed)';
  END IF;

  -- Validation des lignes et de leur jointure à l'unité, également ensembliste.
  IF EXISTS (
    WITH units AS MATERIALIZED (
      SELECT value ->> 'day_unit_id' AS day_unit_id,
             public.daily_stmt_parse_date_strict(value ->> 'accounting_date') AS accounting_date
      FROM jsonb_array_elements(p_units) u(value)
    ), lines AS MATERIALIZED (
      SELECT ord, value,
        public.daily_stmt_parse_amount_strict(value ->> 'signed_amount') AS signed_amount,
        public.daily_stmt_parse_amount_strict(value ->> 'debit_amount') AS debit_amount,
        public.daily_stmt_parse_amount_strict(value ->> 'credit_amount') AS credit_amount
      FROM jsonb_array_elements(p_lines) WITH ORDINALITY l(value,ord)
    )
    SELECT 1 FROM lines l LEFT JOIN units u ON u.day_unit_id=l.value ->> 'day_unit_id'
    WHERE u.day_unit_id IS NULL
       OR l.value ->> 'daily_line_hash' !~ '^[0-9a-f]{64}$'
       OR coalesce(l.value ->> 'daily_occurrence_ordinal','') !~ '^[0-9]+$'
       OR (l.value ->> 'daily_occurrence_ordinal')::integer < 1
       OR coalesce(l.value ->> 'source_line_index','') !~ '^[0-9]+$'
       OR public.daily_stmt_parse_date_strict(l.value ->> 'accounting_date') <> u.accounting_date
       OR (l.value ->> 'value_date' IS NOT NULL AND
           public.daily_stmt_parse_date_strict(l.value ->> 'value_date') IS NULL)
       OR nullif(btrim(coalesce(l.value ->> 'description_sanitized','')),'') IS NULL
       OR l.value ->> 'direction' NOT IN ('debit','credit')
       OR l.signed_amount IS NULL
       OR NOT ((l.value ->> 'direction'='debit' AND l.debit_amount IS NOT NULL
                 AND l.credit_amount IS NULL AND l.signed_amount < 0
                 AND abs(l.signed_amount)=l.debit_amount)
            OR (l.value ->> 'direction'='credit' AND l.credit_amount IS NOT NULL
                 AND l.debit_amount IS NULL AND l.signed_amount > 0
                 AND l.signed_amount=l.credit_amount))
       OR btrim(coalesce(l.value ->> 'currency','')) <> v_currency
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) l(value)
    GROUP BY value ->> 'day_unit_id', value ->> 'daily_line_hash'
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_LINE_INVALID: line identity, amount or join invariant failed (fail-closed)';
  END IF;

  IF EXISTS (
    WITH declared AS MATERIALIZED (
      SELECT value ->> 'day_unit_id' AS day_unit_id,
             (value ->> 'line_count')::integer AS line_count,
             value ->> 'day_content_hash' AS content_hash
      FROM jsonb_array_elements(p_units) u(value)
    ), actual AS MATERIALIZED (
      SELECT value ->> 'day_unit_id' AS day_unit_id,
             count(*)::integer AS line_count,
             array_agg(value ->> 'daily_line_hash') AS hashes
      FROM jsonb_array_elements(p_lines) l(value)
      GROUP BY value ->> 'day_unit_id'
    )
    SELECT 1 FROM declared d LEFT JOIN actual a USING(day_unit_id)
    WHERE a.line_count IS NULL OR a.line_count<>d.line_count
       OR public.daily_stmt_day_content_hash(d.day_unit_id,a.hashes)<>d.content_hash
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_CONTENT_MISMATCH: line count or content hash mismatch (fail-closed)';
  END IF;

  INSERT INTO public.daily_statement_export_attempts (
    created_by,requested_mode,source_format,bank,currency,account_fingerprint,
    account_number_masked,source_file_name_redacted,raw_text_hash,
    export_period_start,export_period_end,statement_date,export_reference_date,
    parser_validation_status,errors_count,warnings_count,runtime_version,
    parser_version,ingestion_ready,bridge_guard_passed,period_days,
    backfill_grant_reference,units_total
  ) VALUES (
    v_actor,'backfill',v_source_format,'BIS',v_currency,v_fingerprint,v_masked,
    v_file_name,v_raw_hash,v_period_start,v_period_end,
    CASE WHEN p_attempt ->> 'statement_date' IS NULL THEN NULL
         ELSE public.daily_stmt_parse_date_strict(p_attempt ->> 'statement_date') END,
    NULL,v_parser_status,v_errors_count,v_warnings_count,
    nullif(btrim(coalesce(p_attempt ->> 'runtime_version','')),''),
    nullif(btrim(coalesce(p_attempt ->> 'parser_version','')),''),
    (p_guard_context ->> 'ingestion_ready')::boolean,TRUE,v_period_days,
    p_guard_context ->> 'backfill_grant_reference',v_units_count
  ) RETURNING id INTO v_attempt_id;

  PERFORM public.daily_stmt_append_audit_event(
    v_actor,v_attempt_id,NULL,NULL,NULL,v_raw_hash,'attempt_received',NULL,NULL,
    'daily statement export deposit received',
    jsonb_build_object('requested_mode','backfill','units_total',v_units_count,'period_days',v_period_days)
  );
  PERFORM public.daily_stmt_append_audit_event(
    v_actor,v_attempt_id,NULL,NULL,NULL,v_raw_hash,'backfill_deposit',NULL,NULL,
    'backfill deposit under explicit grant',
    jsonb_build_object('backfill_grant_reference',p_guard_context ->> 'backfill_grant_reference',
                       'period_days',v_period_days,'units_total',v_units_count)
  );

  -- Le curseur PL/pgSQL porte l'ordre contractuel d'acquisition. Une simple
  -- sous-requête ORDER BY ne garantit pas l'ordre d'évaluation des fonctions
  -- VOLATILE dans la requête englobante.
  FOR v_lock_day_unit_id IN
    SELECT value ->> 'day_unit_id' AS day_unit_id
    FROM jsonb_array_elements(p_units) u(value)
    ORDER BY value ->> 'day_unit_id' COLLATE "C"
  LOOP
    PERFORM public.daily_stmt_acquire_day_lock(v_lock_day_unit_id);
  END LOOP;

  WITH units AS MATERIALIZED (
    SELECT value ->> 'day_unit_id' AS day_unit_id,
           value ->> 'day_content_hash' AS content_hash,
           (value ->> 'line_count')::integer AS line_count,
           value ->> 'aggregates_status' AS aggregates_status,
           public.daily_stmt_parse_amount_strict(value ->> 'opening_balance_derived') AS opening,
           public.daily_stmt_parse_amount_strict(value ->> 'closing_balance_derived') AS closing,
           public.daily_stmt_parse_amount_strict(value ->> 'day_total_debits') AS debits,
           public.daily_stmt_parse_amount_strict(value ->> 'day_total_credits') AS credits
    FROM jsonb_array_elements(p_units) u(value)
  ), overlap_days AS MATERIALIZED (
    SELECT DISTINCT l.value ->> 'day_unit_id' AS day_unit_id
    FROM jsonb_array_elements(p_lines) l(value)
    JOIN public.daily_statement_lines_canonical c
      ON c.daily_line_hash=l.value ->> 'daily_line_hash' AND c.is_active
    WHERE c.day_unit_id<>l.value ->> 'day_unit_id'
  ), decisions AS (
    SELECT u.day_unit_id,u.content_hash,u.line_count,gen_random_uuid() AS staging_unit_id,
           c.id AS active_id,
           CASE WHEN c.id IS NOT NULL AND c.active_day_content_hash=u.content_hash THEN 'duplicate'
                WHEN c.id IS NOT NULL THEN 'conflict'
                WHEN o.day_unit_id IS NOT NULL THEN 'needs_review'
                ELSE 'staged' END AS final_status,
           -- Exception H1 : doublon R1 à version financière différente, dérivée et
           -- cohérente, sans copie conforme d'un autre doublon de même version.
           CASE WHEN c.id IS NOT NULL AND c.active_day_content_hash=u.content_hash
                THEN public.daily_stmt_h1_keep_lines(u.day_unit_id, u.content_hash, u.aggregates_status,
                       u.opening, u.closing, u.debits, u.credits, c.id, NULL)
                ELSE false END AS keep_lines
    FROM units u
    LEFT JOIN public.daily_statement_units_canonical c
      ON c.day_unit_id=u.day_unit_id AND c.status='ingested'
    LEFT JOIN overlap_days o ON o.day_unit_id=u.day_unit_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'day_unit_id',day_unit_id,'day_content_hash',content_hash,
    'line_count',line_count,
    'staging_unit_id',staging_unit_id,'active_id',active_id,
    'final_status',final_status,'keep_lines',keep_lines
  ) ORDER BY day_unit_id COLLATE "C") INTO v_decisions FROM decisions;

  -- Toute provisional de ces journées historiques devient superseded avant
  -- l'insertion des versions closes, avec audit append-only en masse.
  WITH input_days AS MATERIALIZED (
    SELECT value ->> 'day_unit_id' AS day_unit_id FROM jsonb_array_elements(p_units) u(value)
  ), swept AS (
    UPDATE public.daily_statement_units_staging s SET status='superseded'
    FROM input_days d
    WHERE s.day_unit_id=d.day_unit_id AND s.status='provisional'
    RETURNING s.id,s.day_unit_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'actor_id',v_actor,'attempt_id',v_attempt_id,'staging_unit_id',id,
    'canonical_unit_id',NULL,'day_unit_id',day_unit_id,'raw_text_hash',v_raw_hash,
    'event_type','status_changed','previous_status','provisional','new_status','superseded',
    'safe_message','stale provisional unit superseded: the day is now closed',
    'safe_details',jsonb_build_object('reason_code','provisional_superseded_by_day_closure',
      'day_unit_id',day_unit_id,'previous_status','provisional','new_status','superseded')
  )),'[]'::jsonb) INTO v_events FROM swept;
  IF jsonb_array_length(v_events)>0 THEN
    v_inserted := public.daily_stmt_append_audit_events_0v(v_events);
    IF v_inserted<>jsonb_array_length(v_events) THEN
      RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_SWEEP_AUDIT: audit cardinality mismatch (rollback)';
    END IF;
  END IF;

  INSERT INTO public.daily_statement_units_staging (
    id,attempt_id,day_unit_id,bank,account_fingerprint,currency,accounting_date,
    day_content_hash,line_count,day_total_debits,day_total_credits,
    opening_balance_derived,closing_balance_derived,aggregates_status,
    validation_status,status,created_by
  )
  SELECT (d.value ->> 'staging_unit_id')::uuid,v_attempt_id,
    u.value ->> 'day_unit_id','BIS',v_fingerprint,v_currency,
    public.daily_stmt_parse_date_strict(u.value ->> 'accounting_date'),
    u.value ->> 'day_content_hash',(u.value ->> 'line_count')::integer,
    public.daily_stmt_parse_amount_strict(u.value ->> 'day_total_debits'),
    public.daily_stmt_parse_amount_strict(u.value ->> 'day_total_credits'),
    public.daily_stmt_parse_amount_strict(u.value ->> 'opening_balance_derived'),
    public.daily_stmt_parse_amount_strict(u.value ->> 'closing_balance_derived'),
    u.value ->> 'aggregates_status',u.value ->> 'validation_status',
    d.value ->> 'final_status',v_actor
  FROM jsonb_array_elements(p_units) u(value)
  JOIN jsonb_array_elements(v_decisions) d(value)
    ON d.value ->> 'day_unit_id'=u.value ->> 'day_unit_id';
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  IF v_inserted<>v_units_count THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_UNIT_CARDINALITY: every unit must stage (rollback)';
  END IF;

  INSERT INTO public.daily_statement_lines_staging (
    staging_unit_id,attempt_id,day_unit_id,daily_line_hash,
    daily_occurrence_ordinal,source_line_index,accounting_date,value_date,
    description_sanitized,debit_amount,credit_amount,signed_amount,
    running_balance,direction,currency
  )
  SELECT (d.value ->> 'staging_unit_id')::uuid,v_attempt_id,
    l.value ->> 'day_unit_id',l.value ->> 'daily_line_hash',
    (l.value ->> 'daily_occurrence_ordinal')::integer,
    (l.value ->> 'source_line_index')::integer,
    public.daily_stmt_parse_date_strict(l.value ->> 'accounting_date'),
    CASE WHEN l.value ->> 'value_date' IS NULL THEN NULL
         ELSE public.daily_stmt_parse_date_strict(l.value ->> 'value_date') END,
    l.value ->> 'description_sanitized',
    public.daily_stmt_parse_amount_strict(l.value ->> 'debit_amount'),
    public.daily_stmt_parse_amount_strict(l.value ->> 'credit_amount'),
    public.daily_stmt_parse_amount_strict(l.value ->> 'signed_amount'),
    public.daily_stmt_parse_amount_strict(l.value ->> 'running_balance'),
    l.value ->> 'direction',btrim(l.value ->> 'currency')
  FROM jsonb_array_elements(p_lines) l(value)
  JOIN jsonb_array_elements(v_decisions) d(value)
    ON d.value ->> 'day_unit_id'=l.value ->> 'day_unit_id'
  WHERE d.value ->> 'final_status'<>'duplicate' OR (d.value ->> 'keep_lines')::boolean;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  SELECT coalesce(sum((d.value ->> 'line_count')::integer),0)::integer INTO v_expected
  FROM jsonb_array_elements(v_decisions) d(value)
  WHERE d.value ->> 'final_status'<>'duplicate' OR (d.value ->> 'keep_lines')::boolean;
  IF v_inserted<>v_expected THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_LINE_CARDINALITY: every non-duplicate line must stage (rollback)';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'actor_id',v_actor,'attempt_id',v_attempt_id,
    'staging_unit_id',value ->> 'staging_unit_id',
    'canonical_unit_id',value ->> 'active_id','day_unit_id',value ->> 'day_unit_id',
    'raw_text_hash',v_raw_hash,
    'event_type',CASE value ->> 'final_status'
      WHEN 'staged' THEN 'unit_staged' WHEN 'duplicate' THEN 'unit_duplicate'
      WHEN 'conflict' THEN 'unit_conflict' ELSE 'unit_needs_review' END,
    'previous_status',NULL,'new_status',value ->> 'final_status',
    'safe_message',CASE value ->> 'final_status'
      WHEN 'staged' THEN 'daily unit staged'
      WHEN 'duplicate' THEN 'exact duplicate of the active canonical day (R1)'
      WHEN 'conflict' THEN 'same day_unit_id with different day_content_hash than active canonical (R2)'
      ELSE 'active daily_line_hash overlap with another day unit (R3)' END,
    'safe_details',jsonb_build_object('day_unit_id',value ->> 'day_unit_id',
      'day_content_hash',value ->> 'day_content_hash',
      'line_count',(value ->> 'line_count')::integer
    ) || CASE WHEN (value ->> 'keep_lines')::boolean
              THEN jsonb_build_object('reason_code','duplicate_financial_version_differs')
              ELSE '{}'::jsonb END
  )),'[]'::jsonb) INTO v_events
  FROM jsonb_array_elements(v_decisions) d(value);
  v_inserted:=public.daily_stmt_append_audit_events_0v(v_events);
  IF v_inserted<>v_units_count THEN
    RAISE EXCEPTION 'DAILY_STMT_BIS_BACKFILL_AUDIT_CARDINALITY: one unit event required (rollback)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.daily_statement_units_staging s
    JOIN jsonb_array_elements(v_decisions) d(value)
      ON d.value ->> 'day_unit_id'=s.day_unit_id
    WHERE s.status='provisional'
  ) THEN
    RAISE EXCEPTION 'DAILY_STMT_PROVISIONAL_POSTCONDITION: no live provisional may survive historical backfill (rollback)';
  END IF;

  RETURN jsonb_build_object(
    'attempt_id',v_attempt_id,'requested_mode','backfill','units',
    (SELECT jsonb_agg(jsonb_build_object(
      'day_unit_id',value ->> 'day_unit_id','unit_status',value ->> 'final_status',
      'staging_unit_id',value ->> 'staging_unit_id',
      'active_canonical_unit_id',value ->> 'active_id'
    ) ORDER BY value ->> 'day_unit_id' COLLATE "C")
     FROM jsonb_array_elements(v_decisions) d(value))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.daily_stmt_pre_ingest_bis_backfill_core_0v(jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
