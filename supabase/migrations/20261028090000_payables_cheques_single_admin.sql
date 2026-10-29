-- ============================================================================
-- PAYABLES-CHEQUES — administrateur unique du module
-- ============================================================================
-- Migration additive CANDIDATE (GO_IMPLEMENT_PAYABLES_CHEQUES_SINGLE_ADMIN), à
-- appliquer après 20261026090000_payables_cheques_core.sql et
-- 20261026090100_payables_cheques_bank_followup.sql, sans les réécrire. Ce lot
-- ne l'applique à aucun environnement.
--
-- Décision métier : un administrateur unique du module, désigné par
-- l'opérateur base de données, gère seul les habilitations, les personnes,
-- leurs rattachements et les paramètres versionnés, sans second approbateur.
-- Les autres utilisateurs ne proposent ni ne valident rien en gouvernance.
--
-- Principes appliqués :
--   - l'autorité est une ligne du schéma privé, renseignée uniquement par la
--     fonction opérateur payables_private.set_module_admin (jamais exposée à
--     l'API) ; aucune déduction d'un nom, d'un e-mail, de user_metadata, d'un
--     rôle global ou d'une ancienne capacité PARAM_* ; sans administrateur
--     configuré, l'administration est fermée ;
--   - l'administrateur détient implicitement toutes les capacités
--     opérationnelles, liées à l'autorité : la retirer les retire ;
--   - PARAM_PROPOSE et PARAM_VALIDATE ne confèrent plus rien ; les fonctions
--     de gouvernance à deux acteurs et l'ancien amorçage sont désactivés ;
--   - l'administration ne dépend pas de l'interrupteur métier, qui reste fermé
--     et continue de refuser toute écriture financière ;
--   - décisions administratives en ajout seul, idempotentes, journalisées ;
--     versions décidées immuables ; historique et données existants conservés ;
--   - une révocation attend la fin des écritures en cours du titulaire et
--     s'applique à son appel suivant, même avec une session déjà ouverte ;
--   - autorité administrative et identité personnelle sont distinctes : le
--     rattachement de l'administrateur à sa personne est établi par
--     l'opérateur, tracé, et jamais modifiable par l'administrateur lui-même ;
--   - précontrôles du circuit (GO_FIX_PAYABLES_CHEQUES_SINGLE_ADMIN) : une
--     préparation qui rendrait le chèque non confirmable par la voie normale
--     (préparateur non rattaché, aucun signataire admissible distinct des
--     préparateurs) est refusée avant toute formule consommée ; un résultat
--     d'impression, fait réel, reste toujours enregistrable par un déclarant
--     qui n'en est pas la cause ;
--   - circuit comptable conservé (arbitrage CTO du 29 octobre) : le comptable
--     prépare et imprime, le signataire autorisé distinct du préparateur signe
--     physiquement, le même comptable peut enregistrer cette signature et
--     confirmer l'émission réelle ; enregistrer une signature ne confère aucun
--     pouvoir de signature ;
--   - aucun contrôle financier modifié : montants, allocations, versions,
--     signatures, preuve bancaire et validations par un autre acteur des
--     transitions financières restent ceux des deux migrations précédentes ;
--     les précontrôles s'ajoutent sans en retirer aucun.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Autorité administrative (schéma privé, opérateur uniquement)
-- --------------------------------------------------------------------------

CREATE TABLE payables_private.admin_authority (
  singleton        boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  admin_user_id    uuid REFERENCES auth.users(id),
  change_reason    text NOT NULL CHECK (
                     char_length(btrim(change_reason)) BETWEEN 8 AND 240
                     AND change_reason !~ '[[:cntrl:]]'),
  changed_at       timestamptz NOT NULL DEFAULT statement_timestamp(),
  session_actor    name NOT NULL DEFAULT session_user,
  effective_actor  name NOT NULL DEFAULT current_user
);

COMMENT ON TABLE payables_private.admin_authority IS
  'Administrateur unique du module chèques. NULL = administration fermée. Modifié uniquement par payables_private.set_module_admin, sous GO d''environnement.';

INSERT INTO payables_private.admin_authority (change_reason)
VALUES ('Initial state: no module administrator configured');

CREATE TABLE payables_private.admin_authority_events (
  event_id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at              timestamptz NOT NULL,
  previous_admin_user_id  uuid,
  new_admin_user_id       uuid,
  safe_reason             text NOT NULL,
  session_actor           name NOT NULL,
  effective_actor         name NOT NULL,
  transaction_id          bigint NOT NULL
);

ALTER TABLE payables_private.admin_authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables_private.admin_authority_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE payables_private.admin_authority FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE payables_private.admin_authority_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE payables_private.admin_authority_events_event_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION payables_private.prepare_admin_authority_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_ADMIN_AUTHORITY_DELETE_FORBIDDEN';
  END IF;
  IF NEW.singleton IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PAYABLES_ADMIN_AUTHORITY_SINGLETON_REQUIRED';
  END IF;
  IF NEW.admin_user_id IS NOT DISTINCT FROM OLD.admin_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYABLES_ADMIN_AUTHORITY_UNCHANGED';
  END IF;
  IF char_length(btrim(NEW.change_reason)) NOT BETWEEN 8 AND 240
     OR NEW.change_reason ~ '[[:cntrl:]]'
     OR btrim(NEW.change_reason) = btrim(OLD.change_reason) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYABLES_ADMIN_AUTHORITY_NEW_SAFE_REASON_REQUIRED';
  END IF;
  -- L'identité personnelle du désigné reste celle de son rattachement en
  -- vigueur, établi par un tiers (opérateur, administrateur précédent ou
  -- ancienne gouvernance à deux acteurs) ; l'autorité ne la modifie pas.
  -- Les droits implicites de l'administrateur sortant cessent après ses
  -- écritures en cours, jamais au milieu de l'une d'elles, quel que soit le
  -- chemin de modification (fonction opérateur ou mise à jour directe).
  IF OLD.admin_user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('payables:capability-user:' || OLD.admin_user_id::text, 0));
  END IF;
  NEW.changed_at := statement_timestamp();
  NEW.session_actor := session_user;
  NEW.effective_actor := current_user;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payables_admin_authority_prepare
BEFORE UPDATE OR DELETE ON payables_private.admin_authority
FOR EACH ROW EXECUTE FUNCTION payables_private.prepare_admin_authority_change();

CREATE TRIGGER payables_admin_authority_no_truncate
BEFORE TRUNCATE ON payables_private.admin_authority
FOR EACH STATEMENT EXECUTE FUNCTION payables_private.prepare_admin_authority_change();

-- Double trace : journal privé de l'autorité et journal du domaine (AUDIT).
CREATE FUNCTION payables_private.append_admin_authority_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO payables_private.admin_authority_events (
    changed_at, previous_admin_user_id, new_admin_user_id, safe_reason, session_actor, effective_actor, transaction_id)
  VALUES (NEW.changed_at, OLD.admin_user_id, NEW.admin_user_id, NEW.change_reason, NEW.session_actor,
    NEW.effective_actor, txid_current());
  PERFORM payables_private.append_event(NULL, 'SET_MODULE_ADMIN', 'ADMIN_AUTHORITY_CHANGED', 'MODULE_ADMIN',
    coalesce(NEW.admin_user_id, OLD.admin_user_id), gen_random_uuid(), NEW.change_reason, NULL,
    jsonb_build_object('previous_admin_user_id', OLD.admin_user_id, 'new_admin_user_id', NEW.admin_user_id,
      'session_actor', NEW.session_actor));
  RETURN NULL;
END;
$$;

CREATE TRIGGER payables_admin_authority_audit
AFTER UPDATE ON payables_private.admin_authority
FOR EACH ROW EXECUTE FUNCTION payables_private.append_admin_authority_event();

CREATE TRIGGER payables_admin_authority_events_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON payables_private.admin_authority_events
FOR EACH STATEMENT EXECUTE FUNCTION payables_private.block_append_only_mutation();

-- Désignation, remplacement ou retrait de l'administrateur : opérateur base de
-- données uniquement, sous GO d'environnement. Comparaison à l'état attendu :
-- aucune écrasée silencieuse. Le retrait (p_new NULL) ferme l'administration.
CREATE FUNCTION payables_private.set_module_admin(p_expected_current uuid, p_new uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_current uuid; v_reason text;
BEGIN
  v_reason := payables_private.safe_text(p_reason, 'REASON', 8, 240);
  SELECT a.admin_user_id INTO v_current FROM payables_private.admin_authority a WHERE a.singleton FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_current THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PAYABLES_ADMIN_AUTHORITY_STALE';
  END IF;
  IF p_new IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_new) THEN
    RAISE EXCEPTION 'PAYABLES_USER_UNKNOWN';
  END IF;
  -- Contrôles de rattachement et attente des écritures en cours : déclencheur.
  UPDATE payables_private.admin_authority SET admin_user_id = p_new, change_reason = v_reason WHERE singleton;
END;
$$;

COMMENT ON FUNCTION payables_private.set_module_admin(uuid, uuid, text) IS
  'Opérateur uniquement, sous GO d''environnement : désigne (attendu NULL), remplace ou retire (nouveau NULL) l''administrateur unique du module.';

-- Garde des fonctions d'administration. Verrou partagé : un remplacement ou un
-- retrait concurrent attend la fin de la décision en cours.
CREATE FUNCTION payables_private.require_admin(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_admin uuid;
BEGIN
  SELECT a.admin_user_id INTO v_admin FROM payables_private.admin_authority a WHERE a.singleton FOR SHARE;
  IF v_admin IS NULL OR p_actor IS NULL OR v_admin <> p_actor THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_ADMIN_REQUIRED';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Capacités : administrateur implicite, gouvernance héritée sans effet
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION payables_private.has_capability(p_user uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_user IS NULL OR p_capability IS NULL THEN false
    -- Modèle administrateur unique : les capacités de gouvernance héritées ne confèrent plus rien.
    WHEN p_capability IN ('PARAM_PROPOSE','PARAM_VALIDATE') THEN false
    WHEN p_capability IN ('READ','AUDIT','INVOICE_MANAGE','SUPPLIER_MANAGE','SUPPLIER_MERGE_VALIDATE',
           'CHEQUE_PREPARE_PRINT','CHEQUE_CONFIRM_ISSUE','TRANSFER_DECLARE','EXIT_REQUEST','EXIT_VALIDATE',
           'BANK_FOLLOWUP','BANK_READ','EXCEPTION_INSTRUCT')
         AND EXISTS (SELECT 1 FROM payables_private.admin_authority a
                     WHERE a.singleton AND a.admin_user_id = p_user) THEN true
    ELSE coalesce((
      SELECT g.action = 'GRANT'
      FROM public.payables_capability_grants g
      WHERE g.user_id = p_user AND g.capability = p_capability AND g.status = 'VALIDATED'
      ORDER BY g.decision_seq DESC
      LIMIT 1), false)
  END
$$;

-- Même décision qu'avant ; en plus, un verrou partagé propre au titulaire :
-- une révocation concurrente attend la fin de cette transaction, puis
-- s'applique à l'appel suivant. VOLATILE : le contrôle relit l'état validé
-- après l'obtention du verrou.
CREATE OR REPLACE FUNCTION payables_private.require_capability(p_actor uuid, p_capability text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_actor IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('payables:capability-user:' || p_actor::text, 0));
  END IF;
  IF NOT payables_private.has_capability(p_actor, p_capability) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_CAPABILITY_REQUIRED:' || p_capability;
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. Décisions administratives : origine ADMIN, sans second approbateur
-- --------------------------------------------------------------------------
-- Les lignes existantes gardent leur origine et satisfont les contraintes
-- d'origine ; seules les nouvelles décisions de l'administrateur portent
-- l'origine ADMIN (décideur = auteur, jamais pour lui-même).

ALTER TABLE public.payables_capability_grants DROP CONSTRAINT payables_capability_grants_origin_check;
ALTER TABLE public.payables_capability_grants ADD CONSTRAINT payables_capability_grants_origin_check
  CHECK (origin IN ('PROPOSAL','BOOTSTRAP','ADMIN'));
ALTER TABLE public.payables_capability_grants DROP CONSTRAINT payables_capability_grants_lifecycle;
ALTER TABLE public.payables_capability_grants ADD CONSTRAINT payables_capability_grants_lifecycle CHECK (
  (origin = 'BOOTSTRAP' AND status = 'VALIDATED' AND action = 'GRANT'
    AND proposed_by IS NULL AND decided_by IS NULL AND decision_seq IS NOT NULL)
  OR (origin = 'PROPOSAL' AND proposed_by IS NOT NULL AND proposed_by <> user_id AND (
       (status = 'PROPOSED' AND decided_by IS NULL AND decided_at IS NULL AND decision_seq IS NULL)
       OR (status = 'REJECTED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
           AND decided_by <> proposed_by AND decision_seq IS NULL)
       OR (status = 'VALIDATED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
           AND decided_by <> proposed_by AND decided_by <> user_id AND decision_seq IS NOT NULL)))
  OR (origin = 'ADMIN' AND status = 'VALIDATED' AND proposed_by IS NOT NULL AND decided_by = proposed_by
      AND decided_by <> user_id AND decided_at IS NOT NULL AND decision_seq IS NOT NULL
      AND capability NOT IN ('PARAM_PROPOSE','PARAM_VALIDATE'))
);

ALTER TABLE public.payables_persons ADD COLUMN origin text NOT NULL DEFAULT 'PROPOSAL'
  CONSTRAINT payables_persons_origin_check CHECK (origin IN ('PROPOSAL','ADMIN'));
ALTER TABLE public.payables_persons DROP CONSTRAINT payables_persons_lifecycle;
ALTER TABLE public.payables_persons ADD CONSTRAINT payables_persons_lifecycle CHECK (
  (origin = 'PROPOSAL' AND (
     (status = 'PROPOSED' AND decided_by IS NULL AND decided_at IS NULL)
     OR (status <> 'PROPOSED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decided_by <> proposed_by)))
  OR (origin = 'ADMIN' AND status = 'ACTIVE' AND decided_by IS NOT NULL AND decided_by = proposed_by
      AND decided_at IS NOT NULL)
);

-- Rattachements : en plus, l'origine OPERATOR, réservée à l'identité de
-- l'administrateur établie par l'opérateur (aucun auteur applicatif : auteur et
-- décideur vides, trace au journal). Les autres origines gardent un auteur
-- explicite, jamais le titulaire du compte.
ALTER TABLE public.payables_person_links ADD COLUMN origin text NOT NULL DEFAULT 'PROPOSAL'
  CONSTRAINT payables_person_links_origin_check CHECK (origin IN ('PROPOSAL','ADMIN','OPERATOR'));
ALTER TABLE public.payables_person_links ALTER COLUMN proposed_by DROP NOT NULL;
ALTER TABLE public.payables_person_links DROP CONSTRAINT payables_person_links_lifecycle;
ALTER TABLE public.payables_person_links ADD CONSTRAINT payables_person_links_lifecycle CHECK (
  (origin IN ('PROPOSAL','ADMIN') AND proposed_by IS NOT NULL AND proposed_by <> user_id AND (
    (origin = 'PROPOSAL' AND (
       (status = 'PROPOSED' AND decided_by IS NULL AND decided_at IS NULL AND decision_seq IS NULL)
       OR (status = 'REJECTED' AND decided_by IS NOT NULL AND decided_by <> proposed_by AND decision_seq IS NULL)
       OR (status = 'VALIDATED' AND decided_by IS NOT NULL AND decided_by <> proposed_by
           AND decided_by <> user_id AND decision_seq IS NOT NULL)))
    OR (origin = 'ADMIN' AND status = 'VALIDATED' AND decided_by IS NOT NULL AND decided_by = proposed_by
        AND decided_at IS NOT NULL AND decision_seq IS NOT NULL)))
  OR (origin = 'OPERATOR' AND status = 'VALIDATED' AND proposed_by IS NULL AND decided_by IS NULL
      AND decided_at IS NOT NULL AND decision_seq IS NOT NULL)
);

ALTER TABLE public.payables_parameter_versions ADD COLUMN origin text NOT NULL DEFAULT 'PROPOSAL'
  CONSTRAINT payables_parameter_versions_origin_check CHECK (origin IN ('PROPOSAL','ADMIN'));
ALTER TABLE public.payables_parameter_versions DROP CONSTRAINT payables_parameter_versions_lifecycle;
ALTER TABLE public.payables_parameter_versions ADD CONSTRAINT payables_parameter_versions_lifecycle CHECK (
  (origin = 'PROPOSAL' AND (
     (status = 'PROPOSED' AND decided_by IS NULL AND decided_at IS NULL AND decision_seq IS NULL)
     OR (status = 'REJECTED' AND decided_by IS NOT NULL AND decided_by <> proposed_by AND decision_seq IS NULL)
     OR (status = 'VALIDATED' AND decided_by IS NOT NULL AND decided_by <> proposed_by AND decision_seq IS NOT NULL)))
  OR (origin = 'ADMIN' AND status = 'VALIDATED' AND decided_by IS NOT NULL AND decided_by = proposed_by
      AND decided_at IS NOT NULL AND decision_seq IS NOT NULL)
);

-- --------------------------------------------------------------------------
-- 4. Gouvernance héritée désactivée (signatures conservées, effet nul)
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION payables_private.bootstrap_parameter_governance(p_user_a uuid, p_user_b uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_LEGACY_GOVERNANCE_DISABLED';
END;
$$;

COMMENT ON FUNCTION payables_private.bootstrap_parameter_governance(uuid, uuid, text) IS
  'Désactivé par le modèle administrateur unique : utiliser payables_private.set_module_admin.';

CREATE OR REPLACE FUNCTION public.payables_propose_capability_v1(
  p_command_key text, p_user_id uuid, p_capability text, p_action text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_LEGACY_GOVERNANCE_DISABLED';
END;
$$;

CREATE OR REPLACE FUNCTION public.payables_decide_capability_v1(
  p_command_key text, p_proposal_id uuid, p_approve boolean, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_LEGACY_GOVERNANCE_DISABLED';
END;
$$;

CREATE OR REPLACE FUNCTION public.payables_propose_person_v1(p_command_key text, p_display_name text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_LEGACY_GOVERNANCE_DISABLED';
END;
$$;

CREATE OR REPLACE FUNCTION public.payables_decide_person_v1(p_command_key text, p_person_id uuid, p_approve boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_LEGACY_GOVERNANCE_DISABLED';
END;
$$;

CREATE OR REPLACE FUNCTION public.payables_propose_person_link_v1(
  p_command_key text, p_person_id uuid, p_user_id uuid, p_action text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_LEGACY_GOVERNANCE_DISABLED';
END;
$$;

CREATE OR REPLACE FUNCTION public.payables_decide_person_link_v1(p_command_key text, p_link_id uuid, p_approve boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_LEGACY_GOVERNANCE_DISABLED';
END;
$$;

CREATE OR REPLACE FUNCTION public.payables_propose_parameter_v1(
  p_command_key text, p_kind text, p_subject_key text, p_valid_from date, p_payload jsonb,
  p_evidence_ref text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_LEGACY_GOVERNANCE_DISABLED';
END;
$$;

CREATE OR REPLACE FUNCTION public.payables_decide_parameter_v1(p_command_key text, p_version_id uuid, p_approve boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_LEGACY_GOVERNANCE_DISABLED';
END;
$$;

-- --------------------------------------------------------------------------
-- 5. API d'administration (indépendante de l'interrupteur métier)
-- --------------------------------------------------------------------------

-- Utilisateur figurant parmi les préparateurs (au sens de la confirmation
-- normale) d'un chèque encore confirmable : demande ouverte qu'il a créée, ou
-- formule native non émise dont il a fait l'assignation, une version du contenu
-- ou une impression (demande ou résultat).
CREATE FUNCTION payables_private.user_prepares_pending_cheque(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.payables_payments p
                 WHERE p.mode = 'CHEQUE' AND p.status = 'OPEN' AND p.created_by = p_user)
      OR EXISTS (SELECT 1 FROM public.payables_cheque_forms f
                 WHERE f.provenance = 'NATIVE' AND f.state IN ('ASSIGNED','PRINT_PENDING','PRINTED','PRINT_UNCERTAIN')
                   AND (f.created_by = p_user
                        OR EXISTS (SELECT 1 FROM public.payables_cheque_contents c WHERE c.form_id = f.id AND c.created_by = p_user)
                        OR EXISTS (SELECT 1 FROM public.payables_print_events e WHERE e.form_id = f.id
                                   AND (e.requested_by = p_user OR e.outcome_by = p_user))))
$$;

-- Préparateurs (comptes) d'un chèque au sens de la confirmation, plus l'acteur ;
-- une impression en attente compte déjà (son résultat fera de son demandeur un
-- préparateur).
CREATE FUNCTION payables_private.cheque_preparers(p_payment uuid, p_form uuid, p_actor uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(array_agg(DISTINCT x.u), '{}'::uuid[]) FROM (
    SELECT p_actor AS u
    UNION SELECT p.created_by FROM public.payables_payments p WHERE p.id = p_payment
    UNION SELECT f.created_by FROM public.payables_cheque_forms f WHERE f.id = p_form
    UNION SELECT c.created_by FROM public.payables_cheque_contents c WHERE c.form_id = p_form
    UNION SELECT e.requested_by FROM public.payables_print_events e
           WHERE e.form_id = p_form AND e.status IN ('PENDING','PRINTED','UNCERTAIN')
    UNION SELECT e.outcome_by FROM public.payables_print_events e
           WHERE e.form_id = p_form AND e.status IN ('PRINTED','UNCERTAIN')
  ) x WHERE x.u IS NOT NULL
$$;

-- L'identité d'un préparateur ne change pas tant qu'un chèque qu'il a préparé
-- peut encore être confirmé (la règle « signataire ≠ préparateur » se résout à
-- la confirmation sur les rattachements courants). Seul reste possible
-- l'établissement d'une première identité, pour un compte jamais rattaché
-- (aucune personne antérieure n'a pu servir à ses préparations) et tant
-- qu'aucune signature n'est enregistrée sur ses chèques en cours : l'identité
-- n'est jamais choisie au vu des signataires.
CREATE FUNCTION payables_private.identity_change_frozen(p_user uuid, p_link boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT payables_private.user_prepares_pending_cheque(p_user)
     AND (NOT p_link
          OR EXISTS (SELECT 1 FROM public.payables_person_links l WHERE l.user_id = p_user AND l.status = 'VALIDATED')
          OR EXISTS (SELECT 1 FROM public.payables_signatures s
                     JOIN public.payables_cheque_forms f ON f.id = s.form_id
                     WHERE f.provenance = 'NATIVE' AND f.state IN ('ASSIGNED','PRINT_PENDING','PRINTED','PRINT_UNCERTAIN')
                       AND p_user = ANY (payables_private.cheque_preparers(f.payment_id, f.id, NULL))))
$$;

-- Identité personnelle de l'administrateur : établie ou retirée par
-- l'opérateur seul, sous GO d'environnement, jamais par l'administrateur. Elle
-- relie son compte à la personne qui le représente dans les contrôles
-- financiers (préparateur, signataire). Règles d'un rattachement : une personne
-- par compte, un compte par personne, identité figée tant qu'un chèque qu'il a
-- préparé circule. Seul l'administrateur en fonction est visé.
CREATE FUNCTION payables_private.set_module_admin_identity(
  p_admin_user uuid, p_person_id uuid, p_link boolean, p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_admin uuid; v_reason text; v_action text; v_id uuid;
BEGIN
  v_reason := payables_private.safe_text(p_reason, 'REASON', 8, 240);
  SELECT a.admin_user_id INTO v_admin FROM payables_private.admin_authority a WHERE a.singleton FOR SHARE;
  IF v_admin IS NULL OR p_admin_user IS NULL OR v_admin <> p_admin_user THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PAYABLES_ADMIN_IDENTITY_TARGET_INVALID';
  END IF;
  IF p_link IS NULL THEN RAISE EXCEPTION 'PAYABLES_ACTION_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payables_persons p WHERE p.id = p_person_id AND p.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'PAYABLES_PERSON_NOT_ACTIVE';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:person-link', 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:capability-user:' || p_admin_user::text, 0));
  IF p_link AND (payables_private.person_of_user(p_admin_user) IS NOT NULL
                 OR payables_private.user_of_person(p_person_id) IS NOT NULL) THEN
    RAISE EXCEPTION 'PAYABLES_LINK_CONFLICT';
  END IF;
  IF NOT p_link AND payables_private.person_of_user(p_admin_user) IS DISTINCT FROM p_person_id THEN
    RAISE EXCEPTION 'PAYABLES_LINK_STATE_INVALID';
  END IF;
  IF payables_private.identity_change_frozen(p_admin_user, p_link) THEN
    RAISE EXCEPTION 'PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE';
  END IF;
  v_action := CASE WHEN p_link THEN 'LINK' ELSE 'UNLINK' END;
  INSERT INTO public.payables_person_links (person_id, user_id, action, status, origin, proposed_by, decided_by,
    decided_at, decision_seq, reason, decision_reason)
  VALUES (p_person_id, p_admin_user, v_action, 'VALIDATED', 'OPERATOR', NULL, NULL, statement_timestamp(),
    nextval('payables_private.decision_seq'), v_reason, v_reason)
  RETURNING id INTO v_id;
  PERFORM payables_private.append_event(NULL, 'SET_MODULE_ADMIN_IDENTITY',
    CASE WHEN p_link THEN 'ADMIN_IDENTITY_LINKED' ELSE 'ADMIN_IDENTITY_UNLINKED' END, 'PERSON_LINK', v_id,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('person_id', p_person_id, 'user_id', p_admin_user,
      'action', v_action, 'session_actor', session_user));
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION payables_private.set_module_admin_identity(uuid, uuid, boolean, text) IS
  'Opérateur uniquement, sous GO d''environnement : rattache (ou détache) l''administrateur en fonction à la personne qui le représente.';

CREATE FUNCTION public.payables_admin_set_capability_v1(
  p_command_key text, p_user_id uuid, p_capability text, p_grant boolean, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'ADMIN_SET_CAPABILITY';
  v_replay jsonb; v_reason text; v_action text; v_current boolean; v_id uuid;
BEGIN
  PERFORM payables_private.require_admin(v_actor);
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'user_id', p_user_id, 'capability', p_capability, 'grant', p_grant, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  IF p_capability IS NULL OR p_capability NOT IN ('READ','AUDIT','INVOICE_MANAGE','SUPPLIER_MANAGE',
       'SUPPLIER_MERGE_VALIDATE','CHEQUE_PREPARE_PRINT','CHEQUE_CONFIRM_ISSUE','TRANSFER_DECLARE','EXIT_REQUEST',
       'EXIT_VALIDATE','BANK_FOLLOWUP','BANK_READ','EXCEPTION_INSTRUCT','PARAM_PROPOSE','PARAM_VALIDATE') THEN
    RAISE EXCEPTION 'PAYABLES_CAPABILITY_UNKNOWN';
  END IF;
  IF p_capability IN ('PARAM_PROPOSE','PARAM_VALIDATE') THEN RAISE EXCEPTION 'PAYABLES_CAPABILITY_RETIRED'; END IF;
  IF p_grant IS NULL THEN RAISE EXCEPTION 'PAYABLES_DECISION_REQUIRED'; END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'PAYABLES_USER_UNKNOWN';
  END IF;
  -- Les droits de l'administrateur découlent de l'autorité, jamais d'une décision sur lui-même.
  IF p_user_id = v_actor THEN RAISE EXCEPTION 'PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN'; END IF;
  -- Sérialisé avec les écritures en cours du titulaire et avec toute autre décision le concernant.
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:capability-user:' || p_user_id::text, 0));
  v_current := payables_private.has_capability(p_user_id, p_capability);
  IF v_current = p_grant THEN RAISE EXCEPTION 'PAYABLES_CAPABILITY_UNCHANGED'; END IF;
  v_action := CASE WHEN p_grant THEN 'GRANT' ELSE 'REVOKE' END;
  INSERT INTO public.payables_capability_grants (user_id, capability, action, origin, status, proposed_by,
    decided_by, decided_at, decision_seq, reason, decision_reason)
  VALUES (p_user_id, p_capability, v_action, 'ADMIN', 'VALIDATED', v_actor, v_actor, statement_timestamp(),
    nextval('payables_private.decision_seq'), v_reason, v_reason)
  RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd,
    CASE WHEN p_grant THEN 'CAPABILITY_GRANTED_BY_ADMIN' ELSE 'CAPABILITY_REVOKED_BY_ADMIN' END,
    'CAPABILITY_GRANT', v_id, gen_random_uuid(), v_reason, NULL,
    jsonb_build_object('capability', p_capability, 'action', v_action, 'user_id', p_user_id));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('grant_id', v_id, 'action', v_action));
END;
$$;

CREATE FUNCTION public.payables_admin_create_person_v1(p_command_key text, p_display_name text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'ADMIN_CREATE_PERSON';
  v_replay jsonb; v_name text; v_reason text; v_norm text; v_id uuid;
BEGIN
  PERFORM payables_private.require_admin(v_actor);
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key,
    jsonb_build_object('display_name', p_display_name, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_name := payables_private.safe_text(p_display_name, 'DISPLAY_NAME', 2, 120);
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  v_norm := payables_private.normalize_name(v_name);
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:person-name:' || v_norm, 0));
  IF EXISTS (SELECT 1 FROM public.payables_persons p
             WHERE p.status = 'ACTIVE' AND payables_private.normalize_name(p.display_name) = v_norm) THEN
    RAISE EXCEPTION 'PAYABLES_PERSON_DUPLICATE';
  END IF;
  INSERT INTO public.payables_persons (display_name, status, origin, proposed_by, decided_by, decided_at, reason,
    decision_reason)
  VALUES (v_name, 'ACTIVE', 'ADMIN', v_actor, v_actor, statement_timestamp(), v_reason, v_reason)
  RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PERSON_CREATED_BY_ADMIN', 'PERSON', v_id,
    gen_random_uuid(), v_reason);
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('person_id', v_id));
END;
$$;

CREATE FUNCTION public.payables_admin_set_person_link_v1(
  p_command_key text, p_person_id uuid, p_user_id uuid, p_link boolean, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'ADMIN_SET_PERSON_LINK';
  v_replay jsonb; v_reason text; v_action text; v_id uuid;
BEGIN
  PERFORM payables_private.require_admin(v_actor);
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'person_id', p_person_id, 'user_id', p_user_id, 'link', p_link, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  IF p_link IS NULL THEN RAISE EXCEPTION 'PAYABLES_ACTION_INVALID'; END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'PAYABLES_USER_UNKNOWN';
  END IF;
  -- L'administrateur ne se rattache ni ne se détache jamais lui-même : son
  -- identité personnelle est établie par l'opérateur
  -- (payables_private.set_module_admin_identity), jamais choisie par lui.
  IF p_user_id = v_actor THEN RAISE EXCEPTION 'PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payables_persons p WHERE p.id = p_person_id AND p.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'PAYABLES_PERSON_NOT_ACTIVE';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:person-link', 0));
  -- Sérialisé avec les préparations en cours du titulaire (même verrou que ses écritures).
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:capability-user:' || p_user_id::text, 0));
  IF p_link AND (payables_private.person_of_user(p_user_id) IS NOT NULL
                 OR payables_private.user_of_person(p_person_id) IS NOT NULL) THEN
    RAISE EXCEPTION 'PAYABLES_LINK_CONFLICT';
  END IF;
  IF NOT p_link AND payables_private.person_of_user(p_user_id) IS DISTINCT FROM p_person_id THEN
    RAISE EXCEPTION 'PAYABLES_LINK_STATE_INVALID';
  END IF;
  IF payables_private.identity_change_frozen(p_user_id, p_link) THEN
    RAISE EXCEPTION 'PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE';
  END IF;
  v_action := CASE WHEN p_link THEN 'LINK' ELSE 'UNLINK' END;
  INSERT INTO public.payables_person_links (person_id, user_id, action, status, origin, proposed_by, decided_by,
    decided_at, decision_seq, reason, decision_reason)
  VALUES (p_person_id, p_user_id, v_action, 'VALIDATED', 'ADMIN', v_actor, v_actor, statement_timestamp(),
    nextval('payables_private.decision_seq'), v_reason, v_reason)
  RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd,
    CASE WHEN p_link THEN 'PERSON_LINKED_BY_ADMIN' ELSE 'PERSON_UNLINKED_BY_ADMIN' END, 'PERSON_LINK', v_id,
    gen_random_uuid(), v_reason, NULL, jsonb_build_object('person_id', p_person_id, 'user_id', p_user_id, 'action', v_action));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key, jsonb_build_object('link_id', v_id, 'action', v_action));
END;
$$;

-- Nouvelle version d'un paramètre, validée par l'administrateur. Version
-- attendue obligatoire (dernier numéro connu, 0 si aucun) : une modification
-- concurrente n'est jamais écrasée sans être vue.
CREATE FUNCTION public.payables_admin_set_parameter_v1(
  p_command_key text, p_kind text, p_subject_key text, p_valid_from date, p_payload jsonb,
  p_evidence_ref text, p_expected_version_no integer, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'ADMIN_SET_PARAMETER';
  v_replay jsonb; v_reason text; v_evidence text; v_max integer; v_latest date; v_id uuid;
BEGIN
  PERFORM payables_private.require_admin(v_actor);
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'kind', p_kind, 'subject_key', p_subject_key, 'valid_from', p_valid_from, 'payload', p_payload,
    'evidence_ref', p_evidence_ref, 'expected_version_no', p_expected_version_no, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  IF p_valid_from IS NULL THEN RAISE EXCEPTION 'PAYABLES_VALID_FROM_REQUIRED'; END IF;
  IF p_expected_version_no IS NULL OR p_expected_version_no < 0 THEN RAISE EXCEPTION 'PAYABLES_EXPECTED_VERSION_REQUIRED'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'PAYABLES_PARAMETER_PAYLOAD_INVALID';
  END IF;
  -- Mêmes règles de contenu que la gouvernance précédente (profil ORABANK seul,
  -- champs signables complets, personne active, compte actif…).
  PERFORM payables_private.validate_parameter_payload(p_kind, p_subject_key, p_payload);
  IF p_kind IN ('SIGNATORY','PRINT_PROFILE') OR p_evidence_ref IS NOT NULL THEN
    v_evidence := payables_private.safe_text(p_evidence_ref, 'EVIDENCE', 2, 200);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payables:param:' || p_kind || ':' || p_subject_key, 0));
  SELECT coalesce(max(v.version_no), 0) INTO v_max
  FROM public.payables_parameter_versions v WHERE v.kind = p_kind AND v.subject_key = p_subject_key;
  IF v_max <> p_expected_version_no THEN RAISE EXCEPTION 'PAYABLES_STALE_VERSION'; END IF;
  SELECT max(v.valid_from) INTO v_latest FROM public.payables_parameter_versions v
  WHERE v.kind = p_kind AND v.subject_key = p_subject_key AND v.status = 'VALIDATED';
  IF v_latest IS NOT NULL AND p_valid_from <= v_latest THEN RAISE EXCEPTION 'PAYABLES_VALIDITY_OVERLAP'; END IF;
  INSERT INTO public.payables_parameter_versions (kind, subject_key, version_no, valid_from, payload, evidence_ref,
    status, origin, proposed_by, decided_by, decided_at, decision_seq, reason, decision_reason)
  VALUES (p_kind, p_subject_key, v_max + 1, p_valid_from, p_payload, v_evidence, 'VALIDATED', 'ADMIN', v_actor,
    v_actor, statement_timestamp(), nextval('payables_private.decision_seq'), v_reason, v_reason)
  RETURNING id INTO v_id;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'PARAMETER_SET_BY_ADMIN', 'PARAMETER_VERSION', v_id,
    gen_random_uuid(), v_reason, p_valid_from, jsonb_build_object('kind', p_kind, 'version_no', v_max + 1));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('version_id', v_id, 'version_no', v_max + 1));
END;
$$;

-- Clôture d'une proposition héritée restée en attente : refusée par
-- l'administrateur, motif conservé. Une proposition dont il est l'auteur
-- reste en l'état, sans effet (aucune décision ne porte sur ses propres actes).
CREATE FUNCTION public.payables_admin_reject_legacy_proposal_v1(
  p_command_key text, p_kind text, p_proposal_id uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := payables_private.require_actor();
  v_cmd constant text := 'ADMIN_REJECT_LEGACY_PROPOSAL';
  v_replay jsonb; v_reason text; v_status text; v_proposer uuid;
BEGIN
  PERFORM payables_private.require_admin(v_actor);
  v_replay := payables_private.idem_begin(v_actor, v_cmd, p_command_key, jsonb_build_object(
    'kind', p_kind, 'proposal_id', p_proposal_id, 'reason', p_reason));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_reason := payables_private.safe_text(p_reason, 'REASON', 5, 500);
  IF p_kind = 'CAPABILITY' THEN
    SELECT g.status, g.proposed_by INTO v_status, v_proposer FROM public.payables_capability_grants g
     WHERE g.id = p_proposal_id FOR UPDATE;
  ELSIF p_kind = 'PERSON' THEN
    SELECT p.status, p.proposed_by INTO v_status, v_proposer FROM public.payables_persons p
     WHERE p.id = p_proposal_id FOR UPDATE;
  ELSIF p_kind = 'PERSON_LINK' THEN
    SELECT l.status, l.proposed_by INTO v_status, v_proposer FROM public.payables_person_links l
     WHERE l.id = p_proposal_id FOR UPDATE;
  ELSIF p_kind = 'PARAMETER' THEN
    SELECT v.status, v.proposed_by INTO v_status, v_proposer FROM public.payables_parameter_versions v
     WHERE v.id = p_proposal_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'PAYABLES_LEGACY_PROPOSAL_KIND_INVALID';
  END IF;
  IF v_status IS DISTINCT FROM 'PROPOSED' THEN RAISE EXCEPTION 'PAYABLES_PROPOSAL_STATE_INVALID'; END IF;
  IF v_proposer = v_actor THEN RAISE EXCEPTION 'PAYABLES_LEGACY_PROPOSAL_OWN'; END IF;
  IF p_kind = 'CAPABILITY' THEN
    UPDATE public.payables_capability_grants SET status = 'REJECTED', decided_by = v_actor,
           decided_at = statement_timestamp(), decision_reason = v_reason WHERE id = p_proposal_id;
  ELSIF p_kind = 'PERSON' THEN
    UPDATE public.payables_persons SET status = 'REJECTED', decided_by = v_actor, decided_at = statement_timestamp(),
           decision_reason = v_reason, row_version = row_version + 1 WHERE id = p_proposal_id;
  ELSIF p_kind = 'PERSON_LINK' THEN
    UPDATE public.payables_person_links SET status = 'REJECTED', decided_by = v_actor,
           decided_at = statement_timestamp(), decision_reason = v_reason WHERE id = p_proposal_id;
  ELSE
    UPDATE public.payables_parameter_versions SET status = 'REJECTED', decided_by = v_actor,
           decided_at = statement_timestamp(), decision_reason = v_reason WHERE id = p_proposal_id;
  END IF;
  PERFORM payables_private.append_event(v_actor, v_cmd, 'LEGACY_PROPOSAL_CLOSED_BY_ADMIN', 'LEGACY_PROPOSAL',
    p_proposal_id, gen_random_uuid(), v_reason, NULL, jsonb_build_object('kind', p_kind));
  RETURN payables_private.idem_finish(v_actor, v_cmd, p_command_key,
    jsonb_build_object('proposal_id', p_proposal_id, 'status', 'REJECTED'));
END;
$$;

-- Accès courant : en plus, l'autorité d'administration de l'appelant et le
-- modèle de gouvernance. Cette fonction n'expose pas l'identité de
-- l'administrateur ; elle figure en revanche, comme auteur, dans les décisions
-- lisibles par leur bénéficiaire et dans le journal du domaine (AUDIT).
CREATE OR REPLACE FUNCTION public.payables_my_access_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_actor uuid := payables_private.require_actor(); v_caps text[]; v_enabled boolean; v_admin uuid;
BEGIN
  SELECT array_agg(c ORDER BY c) INTO v_caps
  FROM unnest(ARRAY['READ','AUDIT','INVOICE_MANAGE','SUPPLIER_MANAGE','SUPPLIER_MERGE_VALIDATE','CHEQUE_PREPARE_PRINT',
    'CHEQUE_CONFIRM_ISSUE','TRANSFER_DECLARE','EXIT_REQUEST','EXIT_VALIDATE','BANK_FOLLOWUP','BANK_READ',
    'EXCEPTION_INSTRUCT','PARAM_PROPOSE','PARAM_VALIDATE']) c
  WHERE payables_private.has_capability(v_actor, c);
  SELECT rc.business_writes_enabled INTO v_enabled FROM payables_private.runtime_control rc WHERE rc.singleton;
  SELECT a.admin_user_id INTO v_admin FROM payables_private.admin_authority a WHERE a.singleton;
  RETURN jsonb_build_object('user_id', v_actor, 'capabilities', coalesce(to_jsonb(v_caps), '[]'::jsonb),
    'person_id', payables_private.person_of_user(v_actor), 'business_writes_enabled', coalesce(v_enabled, false),
    'export_enabled', false, 'governance_model', 'SINGLE_ADMIN', 'admin_configured', v_admin IS NOT NULL,
    'is_admin', v_admin IS NOT NULL AND v_admin = v_actor);
END;
$$;

-- --------------------------------------------------------------------------
-- 6. Précontrôles du circuit de préparation (aucune formule consommée en vain)
-- --------------------------------------------------------------------------
-- La confirmation normale (payables_confirm_issuance_v1, inchangée) exige que
-- chaque préparateur soit rattaché à une personne et que les signatures
-- requises viennent de signataires admissibles autres que les préparateurs.
-- L'enregistrement d'une signature et la confirmation de l'émission réelle
-- restent ouverts à tout détenteur de CHEQUE_CONFIRM_ISSUE, préparateur compris
-- (arbitrage CTO du 29 octobre) : enregistrer une signature ne confère aucun
-- pouvoir de signature, et le signataire accepté reste distinct des préparateurs.
-- Chaque étape de préparation vérifie d'avance, avec les paramètres en vigueur
-- ce jour, que ces conditions restent réunissables une fois l'acteur compté
-- parmi les préparateurs ; sinon l'étape est refusée et
-- rien n'est écrit : aucune formule n'est assignée, imprimée ni gâchée pour un
-- chèque que la voie normale ne pourrait pas confirmer. Une restriction ne vaut
-- que pour l'opération concernée (par exemple le seul signataire admissible
-- d'un compte ne prépare pas un chèque de ce compte) ; le droit de préparer
-- reste entier ailleurs. La confirmation garde tous ses contrôles.

-- Conditions non réunissables pour une confirmation normale, chacune évaluée
-- indépendamment de l'autre (tableau vide sinon) : préparateurs rattachés,
-- signataires admissibles distincts des préparateurs.
CREATE FUNCTION payables_private.cheque_confirmability_issues(
  p_account uuid, p_category text, p_amount numeric, p_payment uuid, p_form uuid, p_actor uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_on constant date := payables_private.today();
  v_preparers uuid[]; v_persons uuid[]; v_rule public.payables_parameter_versions; v_required integer;
  v_available integer; v_issues text[] := '{}';
BEGIN
  v_preparers := payables_private.cheque_preparers(p_payment, p_form, p_actor);
  SELECT array_agg(payables_private.person_of_user(u)) INTO v_persons FROM unnest(v_preparers) u;
  IF v_persons IS NULL OR EXISTS (SELECT 1 FROM unnest(v_persons) p WHERE p IS NULL) THEN
    v_issues := v_issues || 'PAYABLES_PREPARER_NOT_LINKED'::text;
  END IF;
  v_rule := payables_private.effective_parameter('SIGNATURE_RULE', p_account::text, v_on);
  v_required := (v_rule.payload->>'required_signatures')::integer;
  SELECT count(*) INTO v_available FROM public.payables_persons s
   WHERE s.status = 'ACTIVE' AND NOT (s.id = ANY (coalesce(array_remove(v_persons, NULL), '{}'::uuid[])))
     AND payables_private.signatory_version_if_admissible(s.id, p_account, p_category, p_amount, v_on) IS NOT NULL;
  IF v_rule.id IS NULL OR v_required IS NULL OR v_available < v_required THEN
    v_issues := v_issues || 'PAYABLES_NO_INDEPENDENT_SIGNATORY'::text;
  END IF;
  RETURN v_issues;
END;
$$;

CREATE FUNCTION payables_private.assert_cheque_confirmable(
  p_account uuid, p_category text, p_amount numeric, p_payment uuid, p_form uuid, p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_issues text[] := payables_private.cheque_confirmability_issues(p_account, p_category, p_amount, p_payment, p_form, p_actor);
BEGIN
  IF cardinality(v_issues) > 0 THEN RAISE EXCEPTION '%', v_issues[1]; END IF;
END;
$$;

-- Demande de chèque (le remplacement issu d'une sortie validée est contrôlé à
-- l'assignation de sa formule : la validation de la sortie reste inchangée).
CREATE FUNCTION payables_private.precheck_cheque_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM payables_private.assert_cheque_confirmable(NEW.bank_account_id, NEW.category_code, NEW.amount, NULL, NULL,
    NEW.created_by);
  RETURN NEW;
END;
$$;

-- Assignation, révision ou ajustement d'une formule native : chaque nouvelle
-- version du contenu signable.
CREATE FUNCTION payables_private.precheck_cheque_content()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_form public.payables_cheque_forms; v_payment public.payables_payments;
BEGIN
  SELECT * INTO v_form FROM public.payables_cheque_forms f WHERE f.id = NEW.form_id;
  SELECT * INTO v_payment FROM public.payables_payments p WHERE p.id = v_form.payment_id;
  IF v_form.provenance = 'NATIVE' AND v_payment.mode = 'CHEQUE' AND v_payment.status = 'OPEN' THEN
    PERFORM payables_private.assert_cheque_confirmable(v_payment.bank_account_id, v_payment.category_code,
      v_payment.amount, v_payment.id, v_form.id, NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;

-- Intention d'impression : son demandeur, avant toute impression physique.
-- Résultat imprimé ou incertain : un fait s'enregistre, et n'est refusé que si
-- c'est le déclarant lui-même qui ferait défaut à l'une des conditions, alors
-- qu'elle était réunie sans lui (comparaison condition par condition : une
-- cause passagère étrangère au déclarant ne masque pas la sienne). Le demandeur
-- de l'impression, déjà compté, peut toujours déclarer ; la formule reste en
-- attente sans rien perdre, et aucune libération n'est possible d'ici là. Un
-- chèque devenu non confirmable pour une autre cause (paramètre changé,
-- préparateur hérité non rattaché) s'enregistre ; la confirmation le refuse et
-- la voie d'exception existante s'applique.
CREATE FUNCTION payables_private.precheck_print_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_form public.payables_cheque_forms; v_payment public.payables_payments; v_with text[]; v_without text[];
  v_caused text;
BEGIN
  SELECT * INTO v_form FROM public.payables_cheque_forms f WHERE f.id = NEW.form_id;
  SELECT * INTO v_payment FROM public.payables_payments p WHERE p.id = v_form.payment_id;
  IF v_form.provenance = 'NATIVE' AND v_payment.mode = 'CHEQUE' AND v_payment.status = 'OPEN' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM payables_private.assert_cheque_confirmable(v_payment.bank_account_id, v_payment.category_code,
        v_payment.amount, v_payment.id, v_form.id, NEW.requested_by);
    ELSE
      v_with := payables_private.cheque_confirmability_issues(v_payment.bank_account_id, v_payment.category_code,
        v_payment.amount, v_payment.id, v_form.id, NEW.outcome_by);
      v_without := payables_private.cheque_confirmability_issues(v_payment.bank_account_id, v_payment.category_code,
        v_payment.amount, v_payment.id, v_form.id, NULL);
      SELECT i INTO v_caused FROM unnest(v_with) i WHERE NOT (i = ANY (v_without)) LIMIT 1;
      IF v_caused IS NOT NULL THEN RAISE EXCEPTION '%', v_caused; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payables_payments_precheck_request
BEFORE INSERT ON public.payables_payments
FOR EACH ROW WHEN (NEW.mode = 'CHEQUE' AND NEW.status = 'OPEN' AND NEW.replaces_payment_id IS NULL)
EXECUTE FUNCTION payables_private.precheck_cheque_request();

CREATE TRIGGER payables_cheque_contents_precheck
BEFORE INSERT ON public.payables_cheque_contents
FOR EACH ROW EXECUTE FUNCTION payables_private.precheck_cheque_content();

CREATE TRIGGER payables_print_events_precheck_intent
BEFORE INSERT ON public.payables_print_events
FOR EACH ROW EXECUTE FUNCTION payables_private.precheck_print_event();

CREATE TRIGGER payables_print_events_precheck_outcome
BEFORE UPDATE ON public.payables_print_events
FOR EACH ROW WHEN (OLD.status = 'PENDING' AND NEW.status IN ('PRINTED','UNCERTAIN'))
EXECUTE FUNCTION payables_private.precheck_print_event();

-- --------------------------------------------------------------------------
-- 7. Droits : fermés par défaut, API d'administration ouverte à authenticated
-- --------------------------------------------------------------------------

REVOKE ALL ON FUNCTION payables_private.prepare_admin_authority_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.append_admin_authority_event() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.set_module_admin(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.require_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.user_prepares_pending_cheque(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.identity_change_frozen(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.set_module_admin_identity(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.cheque_preparers(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.cheque_confirmability_issues(uuid, text, numeric, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.assert_cheque_confirmable(uuid, text, numeric, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.precheck_cheque_request() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.precheck_cheque_content() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payables_private.precheck_print_event() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.payables_admin_set_capability_v1(text,uuid,text,boolean,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payables_admin_create_person_v1(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payables_admin_set_person_link_v1(text,uuid,uuid,boolean,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payables_admin_set_parameter_v1(text,text,text,date,jsonb,text,integer,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payables_admin_reject_legacy_proposal_v1(text,text,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.payables_admin_set_capability_v1(text,uuid,text,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_admin_create_person_v1(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_admin_set_person_link_v1(text,uuid,uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_admin_set_parameter_v1(text,text,text,date,jsonb,text,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_admin_reject_legacy_proposal_v1(text,text,uuid,text) TO authenticated;

COMMIT;
