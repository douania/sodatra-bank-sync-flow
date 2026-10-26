-- ============================================================================
-- PAYABLES-CHEQUES-CORE — suivi bancaire multibanque et vue opérationnelle
-- ============================================================================
-- Migration additive CANDIDATE (GO_IMPLEMENT_PAYABLES_CHEQUES_CORE), à
-- appliquer après 20261026090000_payables_cheques_core.sql. Jamais appliquée à
-- un environnement par ce lot.
--
-- Arbitrage CTO du 25 octobre 2026 : une référence dérivée d'un libellé
-- bancaire par une grammaire FERMÉE et VERSIONNÉE par banque peut alimenter une
-- PROPOSITION de rapprochement. Elle ne devient jamais un code d'opération
-- bancaire officiel. Proposition puis confirmation par un comptable habilité ;
-- aucune autovalidation.
--
-- Daily v2 est lu, jamais modifié : aucun changement de ses lecteurs, hashes,
-- clés d'idempotence, RPC ou migrations ; aucune réingestion historique. La
-- projection des références est une table séparée, en ajout seul, liée à
-- l'identifiant et au hash de la ligne canonique.
--
-- Familles qualifiées (version 1) : BDK, ORA, ATB, BICIS. BIS et BRIDGE restent
-- non qualifiées ; NSIA n'existe pas dans le registre Daily v2 ; SGBS exclue.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Grammaires fermées par banque et par famille caractérisée
-- --------------------------------------------------------------------------

CREATE FUNCTION payables_private.cheque_grammar_version(p_bank text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN p_bank IN ('BDK','ORA','ATB','BICIS') THEN 'PCG-' || p_bank || '-V1'
              ELSE 'PCG-' || coalesce(p_bank, 'UNKNOWN') || '-NOT-QUALIFIED' END
$$;

-- Miroir exact de src/features/payables-cheques/bankChequeGrammar.ts (corpus de
-- parité commun). Aucune suppression de zéros, aucune conversion numérique :
-- la référence est conservée telle qu'imprimée dans le libellé.
CREATE FUNCTION payables_private.extract_cheque_reference(p_bank text, p_label text)
RETURNS TABLE (grammar_version text, family text, outcome text, reference_text text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Blancs ASCII explicites (espace, tabulation, retours, sauts) réduits à une
  -- espace puis rognés : même classe que le miroir TypeScript, indépendante de
  -- la locale. Une espace insécable n'est jamais assimilée à un séparateur.
  v_label text := btrim(regexp_replace(upper(coalesce(p_label, '')), '[ \t\n\r\f\v]+', ' ', 'g'));
  v_match text[];
BEGIN
  grammar_version := payables_private.cheque_grammar_version(p_bank);
  family := NULL;
  reference_text := NULL;
  IF p_bank IS NULL OR p_bank NOT IN ('BDK','ORA','ATB','BICIS') THEN
    outcome := 'BANK_NOT_QUALIFIED';
    RETURN NEXT; RETURN;
  END IF;
  -- Frais et retraits ne sont jamais assimilés à un chèque SODATRA.
  IF v_label ~ '(^| )(FRAIS|COMMISSION|COMMISSIONS|COM|TVA|TAF|AGIOS)( |$)' THEN
    outcome := 'EXCLUDED_FEE';
    RETURN NEXT; RETURN;
  END IF;
  IF v_label ~ '^RETRAIT( |$)' THEN
    outcome := 'EXCLUDED_WITHDRAWAL';
    RETURN NEXT; RETURN;
  END IF;
  IF p_bank = 'BDK' AND v_label ~ '^CHEQUE RECU COMPENSE( |$)' THEN
    family := 'BDK_CHEQUE_RECU_COMPENSE';
    v_match := regexp_match(v_label, '^CHEQUE RECU COMPENSE CHQ N ([0-9]{7})( |$)');
  ELSIF p_bank = 'ORA' AND v_label ~ '^CHQ RECU COMPENSE( |$)' THEN
    family := 'ORA_CHQ_RECU_COMPENSE';
    v_match := regexp_match(v_label, '^CHQ RECU COMPENSE ([0-9]{7}) CHQ OCI N\. ([0-9]{7})$');
    -- Rôle défini du second nombre : répétition obligatoire du premier.
    IF v_match IS NOT NULL AND v_match[1] <> v_match[2] THEN
      outcome := 'AMBIGUOUS';
      RETURN NEXT; RETURN;
    END IF;
  ELSIF p_bank = 'ATB' AND v_label ~ '^REGLMT CHEQUE COMPENSE( |$)' THEN
    family := 'ATB_REGLMT_CHEQUE_COMPENSE';
    v_match := regexp_match(v_label, '^REGLMT CHEQUE COMPENSE CHEQUE REF ([0-9]{7})$');
  ELSIF p_bank = 'BICIS' AND v_label ~ '^REGLMT CHQ COMPENSE( |$)' THEN
    family := 'BICIS_REGLMT_CHQ_COMPENSE';
    -- Rôle défini : le texte suivant FAVEUR désigne le bénéficiaire, jamais un numéro.
    v_match := regexp_match(v_label, '^REGLMT CHQ COMPENSE NO ([0-9]{7}) FAVEUR( |$)');
  ELSE
    family := NULL;
    outcome := CASE WHEN v_label ~ '(^| )(CHQ|CHEQUE|CHEQ|CHÈQUE|CHèQUE)( |$)' THEN 'UNKNOWN_FORM' ELSE 'NOT_CHEQUE' END;
    RETURN NEXT; RETURN;
  END IF;
  IF v_match IS NULL THEN
    outcome := 'NO_REFERENCE';
  ELSE
    outcome := 'REFERENCE';
    reference_text := v_match[1];
  END IF;
  RETURN NEXT;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Projection séparée des références et propositions de rapprochement
-- --------------------------------------------------------------------------

CREATE TABLE public.payables_bank_line_references (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id            uuid NOT NULL REFERENCES public.daily_statement_lines_canonical(id),
  daily_line_hash    text NOT NULL,
  bank               text NOT NULL,
  account_registry_id uuid NOT NULL REFERENCES public.daily_statement_account_registry(id),
  accounting_date    date NOT NULL,
  grammar_version    text NOT NULL,
  family             text,
  outcome            text NOT NULL CHECK (outcome IN ('REFERENCE','NO_REFERENCE','AMBIGUOUS','EXCLUDED_FEE',
                       'EXCLUDED_WITHDRAWAL','UNKNOWN_FORM','NOT_CHEQUE','BANK_NOT_QUALIFIED')),
  reference_text     text CHECK (reference_text IS NULL OR reference_text ~ '^[0-9]{1,16}$'),
  computed_by        uuid NOT NULL REFERENCES auth.users(id),
  computed_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (line_id, grammar_version),
  CONSTRAINT payables_bank_line_reference_shape CHECK ((outcome = 'REFERENCE') = (reference_text IS NOT NULL))
);

CREATE INDEX ix_payables_bank_line_reference_lookup
  ON public.payables_bank_line_references (account_registry_id, grammar_version, reference_text)
  WHERE outcome = 'REFERENCE';

CREATE TABLE public.payables_bank_match_proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id            uuid NOT NULL REFERENCES public.payables_cheque_forms(id),
  line_id            uuid NOT NULL REFERENCES public.daily_statement_lines_canonical(id),
  reference_id       uuid NOT NULL REFERENCES public.payables_bank_line_references(id),
  grammar_version    text NOT NULL,
  amount             numeric(18,2) NOT NULL,
  accounting_date    date NOT NULL,
  value_date         date,
  status             text NOT NULL DEFAULT 'PROPOSED'
                       CHECK (status IN ('PROPOSED','CONFIRMED','REJECTED','INVALIDATED','REVOKED','SUPERSEDED')),
  triggered_by       uuid NOT NULL REFERENCES auth.users(id),
  proposed_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  decided_by         uuid REFERENCES auth.users(id),
  decided_at         timestamptz,
  decision_reason    text,
  supersedes_id      uuid REFERENCES public.payables_bank_match_proposals(id),
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT payables_bank_match_lifecycle CHECK (
    (status = 'PROPOSED' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'PROPOSED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_payables_bank_match_pending
  ON public.payables_bank_match_proposals (form_id, line_id) WHERE status = 'PROPOSED';
-- Aucune double consommation : un chèque ↔ une ligne confirmés au plus.
CREATE UNIQUE INDEX uq_payables_bank_match_form_confirmed
  ON public.payables_bank_match_proposals (form_id) WHERE status = 'CONFIRMED';
CREATE UNIQUE INDEX uq_payables_bank_match_line_confirmed
  ON public.payables_bank_match_proposals (line_id) WHERE status = 'CONFIRMED';

ALTER TABLE public.payables_exits
  ADD CONSTRAINT payables_exits_match_fk FOREIGN KEY (match_id) REFERENCES public.payables_bank_match_proposals(id);
ALTER TABLE public.payables_exceptions
  ADD CONSTRAINT payables_exceptions_match_fk FOREIGN KEY (match_id) REFERENCES public.payables_bank_match_proposals(id);

CREATE TRIGGER payables_bank_line_references_no_delete
BEFORE DELETE OR TRUNCATE ON public.payables_bank_line_references
FOR EACH STATEMENT EXECUTE FUNCTION payables_private.block_delete();
CREATE TRIGGER payables_bank_line_references_immutable
BEFORE UPDATE ON public.payables_bank_line_references
FOR EACH STATEMENT EXECUTE FUNCTION payables_private.block_append_only_mutation();
CREATE TRIGGER payables_bank_match_proposals_no_delete
BEFORE DELETE OR TRUNCATE ON public.payables_bank_match_proposals
FOR EACH STATEMENT EXECUTE FUNCTION payables_private.block_delete();

-- --------------------------------------------------------------------------
-- 3. Fonctions internes du suivi bancaire
-- --------------------------------------------------------------------------

-- Calcule, en ajout seul, les références manquantes pour la version courante de
-- la grammaire. Une référence déjà calculée n'est jamais réinterprétée.
CREATE FUNCTION payables_private.refresh_references(p_actor uuid, p_account uuid, p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.payables_bank_line_references (line_id, daily_line_hash, bank, account_registry_id, accounting_date,
    grammar_version, family, outcome, reference_text, computed_by)
  SELECT l.id, l.daily_line_hash, u.bank, u.account_registry_id, l.accounting_date,
         x.grammar_version, x.family, x.outcome, x.reference_text, p_actor
  FROM public.daily_statement_lines_canonical l
  JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
  CROSS JOIN LATERAL payables_private.extract_cheque_reference(u.bank, l.description_sanitized) x
  WHERE u.account_registry_id = p_account AND l.is_active AND l.direction = 'debit'
    AND l.accounting_date BETWEEN p_from AND p_to
    AND NOT EXISTS (SELECT 1 FROM public.payables_bank_line_references r
                    WHERE r.line_id = l.id AND r.grammar_version = payables_private.cheque_grammar_version(u.bank))
  ON CONFLICT (line_id, grammar_version) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Population admissible au cutoff : une seule ligne active non consommée et un
-- seul chèque doivent porter la référence. Retourne la ligne unique ou NULL.
CREATE FUNCTION payables_private.unique_reference_line(p_account uuid, p_reference text, p_cutoff date)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(r.line_id::text)::uuid END
  FROM public.payables_bank_line_references r
  JOIN public.daily_statement_lines_canonical l ON l.id = r.line_id
  JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
  WHERE r.account_registry_id = p_account AND r.outcome = 'REFERENCE' AND r.reference_text = p_reference
    AND r.grammar_version = payables_private.cheque_grammar_version(u.bank)
    AND l.is_active AND l.accounting_date <= p_cutoff
    AND NOT EXISTS (SELECT 1 FROM public.payables_bank_match_proposals m
                    WHERE m.line_id = l.id AND m.status = 'CONFIRMED')
$$;

CREATE FUNCTION payables_private.revoke_bank_match(p_actor uuid, p_match uuid, p_command text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_match public.payables_bank_match_proposals;
BEGIN
  SELECT * INTO v_match FROM public.payables_bank_match_proposals WHERE id = p_match FOR UPDATE;
  IF v_match.id IS NULL OR v_match.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'PAYABLES_MATCH_STATE_INVALID'; END IF;
  UPDATE public.payables_bank_match_proposals SET status = 'REVOKED', row_version = row_version + 1
   WHERE id = p_match;
  UPDATE public.payables_exits SET status = 'REVOKED', row_version = row_version + 1
   WHERE match_id = p_match AND kind = 'BANK_MATCH' AND status = 'VALIDATED';
  -- Le chèque revient en circulation : aucune sortie sans preuve active.
  UPDATE public.payables_cheque_forms SET state = 'ISSUED', updated_at = statement_timestamp(), row_version = row_version + 1
   WHERE id = v_match.form_id AND state = 'CLEARED';
  PERFORM payables_private.append_event(p_actor, p_command, 'BANK_MATCH_REVOKED', 'CHEQUE_FORM', v_match.form_id,
    gen_random_uuid(), p_reason, NULL, jsonb_build_object('match_id', p_match));
END;
$$;

-- --------------------------------------------------------------------------
-- 4. API : suivi bancaire
-- --------------------------------------------------------------------------

CREATE FUNCTION public.payables_refresh_bank_references_v1(p_command_key text, p_bank_account_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'REFRESH_BANK_REFERENCES';
  v_replay jsonb; v_count integer;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'BANK_FOLLOWUP');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'bank_account_id', p_bank_account_id, 'from', p_from, 'to', p_to));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM payables_private.require_account(p_bank_account_id);
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 366 THEN RAISE EXCEPTION 'PAYABLES_PERIOD_INVALID'; END IF;
  v_count := payables_private.refresh_references(v_actor, p_bank_account_id, p_from, p_to);
  PERFORM payables_private.append_event(v_actor, v_cmd, 'BANK_REFERENCES_REFRESHED', 'BANK_ACCOUNT', p_bank_account_id,
    gen_random_uuid(), NULL, p_to, jsonb_build_object('inserted', v_count, 'from', p_from, 'to', p_to));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('inserted', v_count));
END;
$$;

CREATE FUNCTION public.payables_propose_bank_matches_v1(p_command_key text, p_bank_account_id uuid, p_cutoff date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'PROPOSE_BANK_MATCHES';
  v_replay jsonb; v_account public.daily_statement_account_registry; v_ref record; v_form public.payables_cheque_forms;
  v_issuance public.payables_issuances; v_unique uuid; v_proposed integer := 0; v_skipped integer := 0;
  v_alerts integer := 0; v_from date;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'BANK_FOLLOWUP');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'bank_account_id', p_bank_account_id, 'cutoff', p_cutoff));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_account := payables_private.require_account(p_bank_account_id);
  PERFORM payables_private.assert_not_future(p_cutoff, 'CUTOFF');
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:bank-followup:' || p_bank_account_id::text, 0));
  SELECT min(l.accounting_date) INTO v_from FROM public.daily_statement_lines_canonical l
    JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
   WHERE u.account_registry_id = p_bank_account_id AND l.is_active AND l.direction = 'debit';
  IF v_from IS NOT NULL THEN
    PERFORM payables_private.refresh_references(v_actor, p_bank_account_id, v_from, p_cutoff);
  END IF;
  FOR v_ref IN
    SELECT r.*, l.debit_amount, l.currency AS line_currency, l.value_date AS line_value_date
    FROM public.payables_bank_line_references r
    JOIN public.daily_statement_lines_canonical l ON l.id = r.line_id
    WHERE r.account_registry_id = p_bank_account_id AND r.outcome = 'REFERENCE'
      AND r.grammar_version = payables_private.cheque_grammar_version(v_account.bank)
      AND l.is_active AND l.direction = 'debit' AND l.accounting_date <= p_cutoff
      AND NOT EXISTS (SELECT 1 FROM public.payables_bank_match_proposals m
                      WHERE m.line_id = l.id AND m.status IN ('PROPOSED','CONFIRMED'))
    ORDER BY l.accounting_date, l.id
  LOOP
    -- Ordre fixe : facture du paiement rattaché → formule.
    PERFORM 1 FROM public.payables_invoices i JOIN public.payables_payments p ON p.invoice_id = i.id
      JOIN public.payables_cheque_forms f ON f.payment_id = p.id
     WHERE f.bank_account_id = p_bank_account_id AND f.cheque_number = v_ref.reference_text FOR UPDATE OF i;
    SELECT * INTO v_form FROM public.payables_cheque_forms f
     WHERE f.bank_account_id = p_bank_account_id AND f.cheque_number = v_ref.reference_text FOR UPDATE;
    IF v_form.id IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    v_issuance := payables_private.current_issuance(v_form.id);
    v_unique := payables_private.unique_reference_line(p_bank_account_id, v_ref.reference_text, p_cutoff);
    IF v_form.state IN ('CANCELLED','REPLACED') THEN
      -- Débit d'un chèque réputé annulé : exception bloquante, jamais ignorée.
      IF NOT EXISTS (SELECT 1 FROM public.payables_exceptions e WHERE e.kind = 'CANCELLED_CHEQUE_PRESENTED'
                     AND e.form_id = v_form.id AND e.details->>'line_id' = v_ref.line_id::text) THEN
        PERFORM payables_private.open_exception(v_actor, 'CANCELLED_CHEQUE_PRESENTED',
          'Débit portant le numéro d''un chèque annulé ou remplacé', NULL, v_form.payment_id, v_form.id,
          p_bank_account_id, false, true, jsonb_build_object('line_id', v_ref.line_id));
        v_alerts := v_alerts + 1;
      END IF;
      CONTINUE;
    END IF;
    IF v_form.state IN ('ASSIGNED','PRINT_PENDING','PRINTED','PRINT_UNCERTAIN','UNUSED','LOST','PRESIGNED_HELD') THEN
      -- Débit d'une formule que le registre ne tient pas pour émise (inutilisée,
      -- perdue, détenue, imprimée non confirmée) : exception bloquante, jamais un
      -- simple écart ignoré. La facture du paiement rattaché est bloquée.
      IF NOT EXISTS (SELECT 1 FROM public.payables_exceptions e WHERE e.kind = 'UNISSUED_FORM_PRESENTED'
                     AND e.form_id = v_form.id AND e.details->>'line_id' = v_ref.line_id::text) THEN
        PERFORM payables_private.open_exception(v_actor, 'UNISSUED_FORM_PRESENTED',
          'Débit portant le numéro d''une formule non émise au registre',
          (SELECT p.invoice_id FROM public.payables_payments p WHERE p.id = v_form.payment_id), v_form.payment_id,
          v_form.id, p_bank_account_id, v_form.payment_id IS NOT NULL, true,
          jsonb_build_object('line_id', v_ref.line_id, 'form_state', v_form.state));
        v_alerts := v_alerts + 1;
      END IF;
      CONTINUE;
    END IF;
    IF v_form.state <> 'ISSUED' OR v_issuance.id IS NULL OR v_issuance.amount IS NULL
       OR v_issuance.amount <> v_ref.debit_amount OR v_ref.line_currency <> 'XOF'
       OR v_issuance.issue_date > v_ref.accounting_date OR v_unique IS DISTINCT FROM v_ref.line_id THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    INSERT INTO public.payables_bank_match_proposals (form_id, line_id, reference_id, grammar_version, amount,
      accounting_date, value_date, triggered_by)
    VALUES (v_form.id, v_ref.line_id, v_ref.id, v_ref.grammar_version, v_ref.debit_amount, v_ref.accounting_date,
      v_ref.line_value_date, v_actor)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_proposed := v_proposed + 1; END IF;
  END LOOP;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'BANK_MATCHES_PROPOSED', 'BANK_ACCOUNT', p_bank_account_id,
    gen_random_uuid(), NULL, p_cutoff, jsonb_build_object('proposed', v_proposed, 'skipped', v_skipped, 'alerts', v_alerts));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'proposed', v_proposed, 'skipped', v_skipped, 'alerts', v_alerts));
END;
$$;

CREATE FUNCTION public.payables_decide_bank_match_v1(
  p_command_key text, p_proposal_id uuid, p_expected_version integer, p_decision text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'DECIDE_BANK_MATCH';
  v_replay jsonb; v_proposal public.payables_bank_match_proposals; v_form public.payables_cheque_forms;
  v_line record; v_ref public.payables_bank_line_references; v_issuance public.payables_issuances;
  v_reason text; v_outcome text; v_exit uuid;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'BANK_FOLLOWUP');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'proposal_id', p_proposal_id, 'expected_version', p_expected_version, 'decision', p_decision, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('CONFIRM','REJECT') THEN RAISE EXCEPTION 'PAYABLES_DECISION_REQUIRED'; END IF;
  v_reason := CASE WHEN p_decision = 'CONFIRM' AND p_reason IS NULL THEN NULL
                   ELSE payables_private.safe_text(p_reason, 'REASON', 5, 500) END;
  SELECT * INTO v_proposal FROM public.payables_bank_match_proposals WHERE id = p_proposal_id;
  IF v_proposal.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_MATCH_UNKNOWN'; END IF;
  -- Ordre fixe : formule → proposition → ligne bancaire (verrou partagé, lecture seule).
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = v_proposal.form_id FOR UPDATE;
  SELECT * INTO v_proposal FROM public.payables_bank_match_proposals WHERE id = p_proposal_id FOR UPDATE;
  PERFORM payables_private.assert_version(v_proposal.row_version, p_expected_version);
  PERFORM payables_private.assert_lock_free('FORM', v_form.id, v_actor);
  IF v_proposal.status <> 'PROPOSED' THEN RAISE EXCEPTION 'PAYABLES_MATCH_STATE_INVALID'; END IF;
  SELECT l.id, l.is_active, l.debit_amount, l.currency, l.accounting_date, l.value_date, u.bank, u.account_registry_id
    INTO v_line
    FROM public.daily_statement_lines_canonical l
    JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
   WHERE l.id = v_proposal.line_id FOR SHARE OF l;
  SELECT * INTO v_ref FROM public.payables_bank_line_references WHERE id = v_proposal.reference_id;
  IF p_decision = 'REJECT' THEN
    UPDATE public.payables_bank_match_proposals SET status = 'REJECTED', decided_by = v_actor,
           decided_at = statement_timestamp(), decision_reason = v_reason, row_version = row_version + 1
     WHERE id = p_proposal_id;
    v_outcome := 'REJECTED';
  ELSE
    v_issuance := payables_private.current_issuance(v_form.id);
    -- Recontrôle serveur complet à la confirmation.
    IF NOT v_line.is_active
       OR v_ref.grammar_version <> payables_private.cheque_grammar_version(v_line.bank)
       OR v_proposal.grammar_version <> v_ref.grammar_version
       OR v_line.account_registry_id <> v_form.bank_account_id
       OR v_form.state <> 'ISSUED'
       OR v_issuance.amount IS DISTINCT FROM v_line.debit_amount
       OR v_line.currency <> 'XOF'
       OR v_ref.reference_text IS DISTINCT FROM v_form.cheque_number
       OR payables_private.unique_reference_line(v_form.bank_account_id, v_form.cheque_number, v_line.accounting_date)
            IS DISTINCT FROM v_line.id
       OR EXISTS (SELECT 1 FROM public.payables_bank_match_proposals m
                  WHERE m.status = 'CONFIRMED' AND (m.line_id = v_line.id OR m.form_id = v_form.id)) THEN
      UPDATE public.payables_bank_match_proposals SET status = 'INVALIDATED', decided_by = v_actor,
             decided_at = statement_timestamp(), decision_reason = 'Recontrôle serveur échoué à la confirmation',
             row_version = row_version + 1
       WHERE id = p_proposal_id;
      v_outcome := 'INVALIDATED';
    ELSE
      UPDATE public.payables_bank_match_proposals SET status = 'CONFIRMED', decided_by = v_actor,
             decided_at = statement_timestamp(), decision_reason = v_reason, row_version = row_version + 1
       WHERE id = p_proposal_id;
      INSERT INTO public.payables_exits (form_id, kind, status, requested_by, decided_by, decided_at, accounting_date,
        value_date, reason, match_id)
      VALUES (v_form.id, 'BANK_MATCH', 'VALIDATED', v_actor, v_actor, statement_timestamp(), v_line.accounting_date,
        v_line.value_date, 'Rapprochement bancaire confirmé', p_proposal_id)
      RETURNING id INTO v_exit;
      UPDATE public.payables_cheque_forms SET state = 'CLEARED', updated_at = statement_timestamp(), row_version = row_version + 1
       WHERE id = v_form.id;
      v_outcome := 'CONFIRMED';
    END IF;
  END IF;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'BANK_MATCH_' || v_outcome, 'CHEQUE_FORM', v_form.id,
    gen_random_uuid(), v_reason, v_line.accounting_date, jsonb_build_object('proposal_id', p_proposal_id,
    'grammar_version', v_proposal.grammar_version, 'exit_id', v_exit));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'proposal_id', p_proposal_id, 'outcome', v_outcome, 'exit_id', v_exit));
END;
$$;

-- Un remplacement de relevé ne réinterprète jamais un rapprochement confirmé :
-- il est signalé et instruit.
CREATE FUNCTION public.payables_scan_match_evidence_v1(p_command_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'SCAN_MATCH_EVIDENCE';
  v_replay jsonb; v_row record; v_opened integer := 0;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'BANK_FOLLOWUP');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, '{}'::jsonb);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  FOR v_row IN
    SELECT m.id AS match_id, m.form_id, f.bank_account_id, f.payment_id
    FROM public.payables_bank_match_proposals m
    JOIN public.payables_cheque_forms f ON f.id = m.form_id
    JOIN public.daily_statement_lines_canonical l ON l.id = m.line_id
    WHERE m.status = 'CONFIRMED' AND NOT l.is_active
      AND NOT EXISTS (SELECT 1 FROM public.payables_exceptions e
                      WHERE e.kind = 'MATCH_EVIDENCE_INACTIVE' AND e.match_id = m.id AND e.status = 'OPEN')
  LOOP
    PERFORM payables_private.open_exception(v_actor, 'MATCH_EVIDENCE_INACTIVE',
      'La ligne bancaire du rapprochement confirmé a été remplacée', NULL, v_row.payment_id, v_row.form_id,
      v_row.bank_account_id, false, true, '{}'::jsonb, NULL, NULL, v_row.match_id);
    v_opened := v_opened + 1;
  END LOOP;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'MATCH_EVIDENCE_SCANNED', 'BANK_FOLLOWUP', NULL,
    gen_random_uuid(), NULL, NULL, jsonb_build_object('opened', v_opened));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('opened', v_opened));
END;
$$;

-- Rattachement explicite à la ligne remplaçante : revérifie compte, devise,
-- montant ET référence, unicité et non-consommation. L'ancien rapprochement est
-- conservé (SUPERSEDED), jamais effacé.
CREATE FUNCTION public.payables_rebind_bank_match_v1(
  p_command_key text, p_match_id uuid, p_new_line_id uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'REBIND_BANK_MATCH';
  v_replay jsonb; v_old public.payables_bank_match_proposals; v_form public.payables_cheque_forms; v_line record;
  v_ref public.payables_bank_line_references; v_issuance public.payables_issuances; v_new uuid; v_reason text;
  v_old_active boolean;
BEGIN
  PERFORM payables_private.assert_business_writes_enabled();
  PERFORM payables_private.require_capability(v_actor, 'BANK_FOLLOWUP');
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'match_id', p_match_id, 'new_line_id', p_new_line_id, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  SELECT * INTO v_old FROM public.payables_bank_match_proposals WHERE id = p_match_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'PAYABLES_MATCH_UNKNOWN'; END IF;
  SELECT * INTO v_form FROM public.payables_cheque_forms WHERE id = v_old.form_id FOR UPDATE;
  SELECT * INTO v_old FROM public.payables_bank_match_proposals WHERE id = p_match_id FOR UPDATE;
  IF v_old.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'PAYABLES_MATCH_STATE_INVALID'; END IF;
  SELECT l.is_active INTO v_old_active FROM public.daily_statement_lines_canonical l WHERE l.id = v_old.line_id;
  IF v_old_active THEN RAISE EXCEPTION 'PAYABLES_MATCH_EVIDENCE_STILL_ACTIVE'; END IF;
  SELECT l.id, l.is_active, l.direction, l.debit_amount, l.currency, l.accounting_date, l.value_date, u.bank, u.account_registry_id
    INTO v_line
    FROM public.daily_statement_lines_canonical l
    JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
   WHERE l.id = p_new_line_id FOR SHARE OF l;
  IF v_line.id IS NULL OR NOT v_line.is_active OR v_line.direction <> 'debit'
     OR v_line.account_registry_id <> v_form.bank_account_id OR v_line.currency <> 'XOF'
     OR v_line.debit_amount <> v_old.amount THEN
    RAISE EXCEPTION 'PAYABLES_REBIND_EVIDENCE_INVALID';
  END IF;
  PERFORM payables_private.refresh_references(v_actor, v_form.bank_account_id, v_line.accounting_date, v_line.accounting_date);
  SELECT * INTO v_ref FROM public.payables_bank_line_references r
   WHERE r.line_id = p_new_line_id AND r.grammar_version = payables_private.cheque_grammar_version(v_line.bank);
  v_issuance := payables_private.current_issuance(v_form.id);
  IF v_ref.id IS NULL OR v_ref.outcome <> 'REFERENCE' OR v_ref.reference_text <> v_form.cheque_number
     OR v_issuance.amount IS DISTINCT FROM v_line.debit_amount
     OR EXISTS (SELECT 1 FROM public.payables_bank_match_proposals m WHERE m.line_id = p_new_line_id AND m.status = 'CONFIRMED')
     OR payables_private.unique_reference_line(v_form.bank_account_id, v_form.cheque_number, v_line.accounting_date)
          IS DISTINCT FROM p_new_line_id THEN
    RAISE EXCEPTION 'PAYABLES_REBIND_EVIDENCE_INVALID';
  END IF;
  UPDATE public.payables_bank_match_proposals SET status = 'SUPERSEDED', row_version = row_version + 1 WHERE id = p_match_id;
  UPDATE public.payables_exits SET status = 'REVOKED', row_version = row_version + 1
   WHERE match_id = p_match_id AND kind = 'BANK_MATCH' AND status = 'VALIDATED';
  INSERT INTO public.payables_bank_match_proposals (form_id, line_id, reference_id, grammar_version, amount, accounting_date,
    value_date, status, triggered_by, decided_by, decided_at, decision_reason, supersedes_id)
  VALUES (v_form.id, p_new_line_id, v_ref.id, v_ref.grammar_version, v_line.debit_amount, v_line.accounting_date,
    v_line.value_date, 'CONFIRMED', v_actor, v_actor, statement_timestamp(), v_reason, p_match_id)
  RETURNING id INTO v_new;
  INSERT INTO public.payables_exits (form_id, kind, status, requested_by, decided_by, decided_at, accounting_date,
    value_date, reason, match_id)
  VALUES (v_form.id, 'BANK_MATCH', 'VALIDATED', v_actor, v_actor, statement_timestamp(), v_line.accounting_date,
    v_line.value_date, 'Rattachement à la ligne remplaçante', v_new);
  PERFORM payables_private.append_event(v_actor, v_cmd, 'BANK_MATCH_REBOUND', 'CHEQUE_FORM', v_form.id, gen_random_uuid(),
    v_reason, v_line.accounting_date, jsonb_build_object('previous_match_id', p_match_id, 'match_id', v_new));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('match_id', v_new));
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Lecture : file de travail partagée et vue opérationnelle par compte
-- --------------------------------------------------------------------------

CREATE FUNCTION payables_private.require_read(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT (payables_private.has_capability(p_actor, 'READ') OR payables_private.has_capability(p_actor, 'AUDIT')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_CAPABILITY_REQUIRED:READ';
  END IF;
END;
$$;

CREATE FUNCTION public.payables_work_queue_v1()
RETURNS TABLE (item_type text, object_id uuid, related_id uuid, since timestamptz, lock_holder uuid, lock_expires_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid := payables_private.require_actor();
BEGIN
  PERFORM payables_private.require_read(v_actor);
  RETURN QUERY
  WITH items AS (
    SELECT 'PAYMENT_TO_PRINT'::text AS t, p.id AS obj, p.invoice_id AS rel, p.created_at AS s, 'PAYMENT'::text AS lt
    FROM public.payables_payments p
    WHERE p.mode = 'CHEQUE' AND p.status = 'OPEN'
      AND NOT EXISTS (SELECT 1 FROM public.payables_cheque_forms f WHERE f.payment_id = p.id
                      AND f.state IN ('PRINT_PENDING','PRINTED','PRINT_UNCERTAIN'))
    UNION ALL
    SELECT 'PRINT_OUTCOME_PENDING', f.id, f.payment_id, f.updated_at, 'FORM'
    FROM public.payables_cheque_forms f WHERE f.state = 'PRINT_PENDING'
    UNION ALL
    SELECT 'AWAITING_SIGNATURE_OR_CONFIRMATION', f.id, f.payment_id, f.updated_at, 'FORM'
    FROM public.payables_cheque_forms f WHERE f.state = 'PRINTED'
    UNION ALL
    SELECT 'ISSUED_NOT_DELIVERED', f.id, f.payment_id, f.updated_at, 'FORM'
    FROM public.payables_cheque_forms f
    WHERE f.state IN ('ISSUED','CLEARED') AND f.provenance IN ('NATIVE','EXCEPTION')
      AND NOT EXISTS (SELECT 1 FROM public.payables_deliveries d WHERE d.form_id = f.id)
    UNION ALL
    SELECT 'EXIT_TO_VALIDATE', e.id, e.form_id, e.requested_at, 'FORM'
    FROM public.payables_exits e WHERE e.status = 'REQUESTED'
    UNION ALL
    SELECT 'TAKEOVER_TO_APPROVE', b.id, b.bank_account_id, b.prepared_at, NULL
    FROM public.payables_takeover_batches b WHERE b.status = 'PREPARED'
    UNION ALL
    SELECT 'EXCEPTION_OPEN', x.id, coalesce(x.invoice_id, x.form_id), x.opened_at, 'EXCEPTION'
    FROM public.payables_exceptions x WHERE x.status = 'OPEN'
    UNION ALL
    SELECT 'BANK_MATCH_TO_DECIDE', m.id, m.form_id, m.proposed_at, 'FORM'
    FROM public.payables_bank_match_proposals m WHERE m.status = 'PROPOSED'
    UNION ALL
    SELECT 'SUPPLIER_MERGE_TO_VALIDATE', sm.id, sm.absorbed_id, sm.proposed_at, NULL
    FROM public.payables_supplier_merges sm WHERE sm.status = 'PROPOSED'
    UNION ALL
    SELECT 'PARAMETER_TO_VALIDATE', v.id, NULL, v.proposed_at, NULL
    FROM public.payables_parameter_versions v WHERE v.status = 'PROPOSED'
    UNION ALL
    -- Aucun identifiant de compte exposé dans la file partagée.
    SELECT 'CAPABILITY_TO_VALIDATE', g.id, NULL::uuid, g.proposed_at, NULL
    FROM public.payables_capability_grants g WHERE g.status = 'PROPOSED'
    UNION ALL
    SELECT 'PERSON_TO_VALIDATE', pe.id, NULL, pe.proposed_at, NULL
    FROM public.payables_persons pe WHERE pe.status = 'PROPOSED'
    UNION ALL
    SELECT 'PERSON_LINK_TO_VALIDATE', pl.id, pl.person_id, pl.proposed_at, NULL
    FROM public.payables_person_links pl WHERE pl.status = 'PROPOSED'
  )
  SELECT i.t, i.obj, i.rel, i.s, l.holder, l.expires_at
  FROM items i
  LEFT JOIN public.payables_work_locks l
    ON l.object_type = i.lt AND l.object_id = CASE WHEN i.t IN ('EXIT_TO_VALIDATE','BANK_MATCH_TO_DECIDE') THEN i.rel ELSE i.obj END
   AND l.released_at IS NULL AND l.expires_at > statement_timestamp()
  ORDER BY i.s;
END;
$$;

-- Vue opérationnelle par compte. Une seule instruction (un seul instantané) ;
-- le solde vient EXCLUSIVEMENT de la dernière journée canonique (jamais d'un
-- ancien solde) ; aucune somme entre devises ; une donnée absente reste NULL
-- avec motif, jamais zéro. La position indicative après chèques reste distincte
-- du solde bancaire confirmé et de la disponibilité nette en date de valeur
-- (non calculée ici).
CREATE FUNCTION public.payables_account_positions_v1(p_as_of date DEFAULT NULL)
RETURNS TABLE (
  account_id uuid, bank text, account_alias text, currency text,
  last_statement_date date, bank_balance numeric, balance_status text,
  register_status text, takeover_cutoff date, bank_qualified boolean,
  circulation_count integer, circulation_amount numeric, circulation_unknown_count integer,
  circulation_at_statement_amount numeric, engaged_not_debited_amount numeric,
  transfers_pending_count integer, transfers_pending_amount numeric,
  pending_bank_items integer, open_blocking_exceptions integer, coverage_gap_days integer,
  indicative_position numeric, indicative_reasons text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid := payables_private.require_actor(); v_as_of date := coalesce(p_as_of, payables_private.today());
BEGIN
  PERFORM payables_private.require_read(v_actor);
  IF v_as_of > payables_private.today() THEN RAISE EXCEPTION 'PAYABLES_FUTURE_DATE_FORBIDDEN:AS_OF'; END IF;
  RETURN QUERY
  WITH acc AS (
    SELECT r.id, r.bank, r.safe_alias, r.currency FROM public.daily_statement_account_registry r WHERE r.status = 'active'
  ),
  last_unit AS (
    SELECT DISTINCT ON (u.account_registry_id) u.account_registry_id, u.accounting_date, u.validation_status,
           u.aggregates_status, u.closing_balance_derived
    FROM public.daily_statement_units_canonical u
    WHERE u.status = 'ingested' AND u.account_registry_id IS NOT NULL AND u.accounting_date <= v_as_of
    ORDER BY u.account_registry_id, u.accounting_date DESC
  ),
  takeover AS (
    SELECT b.bank_account_id, bool_or(b.completeness_attested) AS attested, max(b.cutoff_date) AS cutoff
    FROM public.payables_takeover_batches b WHERE b.status = 'INTEGRATED' GROUP BY b.bank_account_id
  ),
  issued AS (
    SELECT f.id, f.bank_account_id, i.issue_date, i.amount,
           (SELECT min(e.accounting_date) FROM public.payables_exits e
             WHERE e.form_id = f.id AND e.status = 'VALIDATED' AND e.kind IN ('CANCELLATION','REPLACEMENT','BANK_MATCH'))
             AS exit_date
    FROM public.payables_cheque_forms f
    CROSS JOIN LATERAL (SELECT x.issue_date, x.amount FROM public.payables_issuances x
                        WHERE x.form_id = f.id ORDER BY x.revision_no DESC LIMIT 1) i
    WHERE f.state IN ('ISSUED','CLEARED','CANCELLED','REPLACED')
  ),
  circ AS (
    SELECT a.id AS account,
      count(s.id) FILTER (WHERE s.issue_date <= v_as_of AND (s.exit_date IS NULL OR s.exit_date > v_as_of))::integer AS n_now,
      CASE WHEN bool_or(s.amount IS NULL) FILTER (WHERE s.issue_date <= v_as_of AND (s.exit_date IS NULL OR s.exit_date > v_as_of))
           THEN NULL
           ELSE coalesce(sum(s.amount) FILTER (WHERE s.issue_date <= v_as_of AND (s.exit_date IS NULL OR s.exit_date > v_as_of)), 0)
      END AS amt_now,
      count(s.id) FILTER (WHERE s.amount IS NULL AND s.issue_date <= v_as_of
                          AND (s.exit_date IS NULL OR s.exit_date > v_as_of))::integer AS unknown_now,
      CASE WHEN lu.accounting_date IS NULL THEN NULL
           WHEN bool_or(s.amount IS NULL) FILTER (WHERE s.issue_date <= lu.accounting_date
                AND (s.exit_date IS NULL OR s.exit_date > lu.accounting_date)) THEN NULL
           ELSE coalesce(sum(s.amount) FILTER (WHERE s.issue_date <= lu.accounting_date
                AND (s.exit_date IS NULL OR s.exit_date > lu.accounting_date)), 0)
      END AS amt_at_statement
    FROM acc a
    LEFT JOIN last_unit lu ON lu.account_registry_id = a.id
    LEFT JOIN issued s ON s.bank_account_id = a.id
    GROUP BY a.id, lu.accounting_date
  ),
  engaged AS (
    SELECT p.bank_account_id AS account, coalesce(sum(al.amount), 0) AS amt
    FROM public.payables_allocations al
    JOIN public.payables_payments p ON p.id = al.payment_id
    WHERE al.status = 'ENGAGED' AND p.mode = 'CHEQUE'
      AND NOT EXISTS (SELECT 1 FROM public.payables_cheque_forms f WHERE f.payment_id = p.id AND f.state = 'CLEARED')
    GROUP BY p.bank_account_id
  ),
  transfers AS (
    SELECT t.bank_account_id AS account, lu.accounting_date AS j, count(*)::integer AS n, sum(t.amount) AS amt
    FROM public.payables_transfer_declarations t
    LEFT JOIN last_unit lu ON lu.account_registry_id = t.bank_account_id
    WHERE t.declared_status = 'COMMITTED' OR lu.accounting_date IS NULL OR t.executed_on > lu.accounting_date
    GROUP BY t.bank_account_id, lu.accounting_date
  ),
  pending AS (
    SELECT a.id AS account,
      count(l.id) FILTER (WHERE r.id IS NULL
        OR (r.outcome = 'REFERENCE' AND NOT EXISTS (SELECT 1 FROM public.payables_bank_match_proposals m
              WHERE m.line_id = l.id AND m.status = 'CONFIRMED'))
        OR r.outcome IN ('AMBIGUOUS','NO_REFERENCE','UNKNOWN_FORM'))::integer AS n
    FROM acc a
    LEFT JOIN last_unit lu ON lu.account_registry_id = a.id
    LEFT JOIN takeover tk ON tk.bank_account_id = a.id
    LEFT JOIN public.daily_statement_units_canonical u
      ON u.account_registry_id = a.id AND u.status = 'ingested'
     AND u.accounting_date <= lu.accounting_date AND u.accounting_date > coalesce(tk.cutoff, DATE '0001-01-01')
    LEFT JOIN public.daily_statement_lines_canonical l
      ON l.canonical_unit_id = u.id AND l.is_active AND l.direction = 'debit'
    LEFT JOIN public.payables_bank_line_references r
      ON r.line_id = l.id AND r.grammar_version = payables_private.cheque_grammar_version(a.bank)
    GROUP BY a.id
  ),
  blocking AS (
    SELECT x.bank_account_id AS account, count(*)::integer AS n
    FROM public.payables_exceptions x WHERE x.status = 'OPEN' AND x.blocks_account GROUP BY x.bank_account_id
  ),
  coverage AS (
    SELECT a.id AS account, max(d.gap)::integer AS gap
    FROM acc a
    JOIN takeover tk ON tk.bank_account_id = a.id
    JOIN last_unit lu ON lu.account_registry_id = a.id
    CROSS JOIN LATERAL (
      SELECT dd - lag(dd) OVER (ORDER BY dd) AS gap
      FROM (SELECT tk.cutoff AS dd
            UNION SELECT u.accounting_date FROM public.daily_statement_units_canonical u
                   WHERE u.account_registry_id = a.id AND u.status = 'ingested'
                     AND u.accounting_date > tk.cutoff AND u.accounting_date <= lu.accounting_date) z
    ) d
    GROUP BY a.id
  ),
  assembled AS (
    SELECT a.id, a.bank, a.safe_alias, a.currency, lu.accounting_date AS last_date,
      CASE WHEN lu.accounting_date IS NULL THEN 'NO_STATEMENT'
           WHEN lu.validation_status <> 'valid' THEN 'UNIT_NEEDS_REVIEW'
           WHEN lu.aggregates_status <> 'derived' THEN 'AGGREGATES_UNAVAILABLE'
           WHEN lu.closing_balance_derived IS NULL THEN 'CLOSING_MISSING'
           ELSE 'AVAILABLE' END AS bal_status,
      lu.closing_balance_derived AS closing,
      CASE WHEN tk.attested THEN 'COMPLETE' WHEN tk.bank_account_id IS NOT NULL THEN 'INCOMPLETE' ELSE 'NOT_STARTED' END AS reg,
      tk.cutoff,
      a.bank IN ('BDK','ORA','ATB','BICIS') AS qualified,
      c.n_now, c.amt_now, c.unknown_now, c.amt_at_statement,
      coalesce(eg.amt, 0) AS engaged_amt,
      coalesce(tr.n, 0) AS tr_n, coalesce(tr.amt, 0) AS tr_amt,
      coalesce(pd.n, 0) AS pending_n, coalesce(bl.n, 0) AS blocking_n, cv.gap
    FROM acc a
    LEFT JOIN last_unit lu ON lu.account_registry_id = a.id
    LEFT JOIN takeover tk ON tk.bank_account_id = a.id
    LEFT JOIN circ c ON c.account = a.id
    LEFT JOIN engaged eg ON eg.account = a.id
    LEFT JOIN transfers tr ON tr.account = a.id
    LEFT JOIN pending pd ON pd.account = a.id
    LEFT JOIN blocking bl ON bl.account = a.id
    LEFT JOIN coverage cv ON cv.account = a.id
  ),
  reasons AS (
    SELECT s.*, array_remove(ARRAY[
      CASE WHEN s.currency <> 'XOF' THEN 'CURRENCY_NOT_SUPPORTED' END,
      CASE WHEN s.bal_status <> 'AVAILABLE' THEN 'BALANCE_' || s.bal_status END,
      CASE WHEN s.reg <> 'COMPLETE' THEN 'REGISTER_' || s.reg END,
      CASE WHEN s.reg = 'COMPLETE' AND s.last_date IS NOT NULL AND s.last_date < s.cutoff THEN 'STATEMENT_BEFORE_TAKEOVER' END,
      CASE WHEN NOT s.qualified THEN 'BANK_NOT_QUALIFIED' END,
      CASE WHEN s.pending_n > 0 THEN 'BANK_FOLLOWUP_PENDING' END,
      CASE WHEN s.blocking_n > 0 THEN 'BLOCKING_EXCEPTION_OPEN' END,
      CASE WHEN s.amt_at_statement IS NULL AND s.last_date IS NOT NULL THEN 'AMOUNT_UNKNOWN' END,
      -- Calendrier ouvré non arrêté (confirmation 15) : écart provisoire de 3 jours calendaires.
      CASE WHEN s.gap IS NOT NULL AND s.gap > 3 THEN 'COVERAGE_GAP' END
    ], NULL) AS why
    FROM assembled s
  )
  SELECT r.id, r.bank, r.safe_alias, r.currency, r.last_date,
         CASE WHEN r.bal_status = 'AVAILABLE' THEN r.closing END, r.bal_status,
         r.reg, r.cutoff, r.qualified,
         coalesce(r.n_now, 0), r.amt_now, coalesce(r.unknown_now, 0), r.amt_at_statement, r.engaged_amt,
         r.tr_n, r.tr_amt, r.pending_n, r.blocking_n, r.gap,
         CASE WHEN cardinality(r.why) = 0 THEN r.closing - r.amt_at_statement END,
         r.why
  FROM reasons r
  ORDER BY r.bank, r.safe_alias;
END;
$$;

CREATE FUNCTION public.payables_bank_followup_lines_v1(p_bank_account_id uuid, p_from date, p_to date)
RETURNS TABLE (
  line_id uuid, accounting_date date, value_date date, debit_amount numeric, currency text, is_active boolean,
  grammar_version text, family text, outcome text, reference_text text, proposal_id uuid, proposal_status text,
  proposal_version integer, form_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid := payables_private.require_actor();
BEGIN
  PERFORM payables_private.require_read(v_actor);
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 93 THEN RAISE EXCEPTION 'PAYABLES_PERIOD_INVALID'; END IF;
  -- Le libellé bancaire n'est jamais renvoyé : seuls la famille, le résultat et
  -- la référence extraite sont exposés.
  RETURN QUERY
  SELECT l.id, l.accounting_date, l.value_date, l.debit_amount, l.currency, l.is_active,
         r.grammar_version, r.family, r.outcome, r.reference_text, m.id, m.status, m.row_version, m.form_id
  FROM public.daily_statement_lines_canonical l
  JOIN public.daily_statement_units_canonical u ON u.id = l.canonical_unit_id
  LEFT JOIN public.payables_bank_line_references r
    ON r.line_id = l.id AND r.grammar_version = payables_private.cheque_grammar_version(u.bank)
  LEFT JOIN LATERAL (SELECT x.* FROM public.payables_bank_match_proposals x WHERE x.line_id = l.id
                     ORDER BY x.proposed_at DESC LIMIT 1) m ON true
  WHERE u.account_registry_id = p_bank_account_id AND l.direction = 'debit'
    AND l.accounting_date BETWEEN p_from AND p_to
  ORDER BY l.accounting_date, l.id;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. RLS, droits et surface d'API
-- --------------------------------------------------------------------------

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['payables_bank_line_references','payables_bank_match_proposals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.payables_current_actor_can_read())',
      v_table || '_read', v_table);
  END LOOP;
END $$;

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

-- Réouverture de l'API de la migration précédente (le balayage ci-dessus la referme).
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
GRANT EXECUTE ON FUNCTION public.payables_refresh_bank_references_v1(text,uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_propose_bank_matches_v1(text,uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_decide_bank_match_v1(text,uuid,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_scan_match_evidence_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_rebind_bank_match_v1(text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_work_queue_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_account_positions_v1(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_bank_followup_lines_v1(uuid,date,date) TO authenticated;

COMMIT;
