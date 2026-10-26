-- Gouvernance : capacités, personnes, rattachements et paramètres versionnés
-- (S3, S33–S36, S59, S60, C4.4, C6.1). Données synthétiques uniquement.

-- Outils : proposition puis décision par deux acteurs distincts.
CREATE FUNCTION pc_test.grant_cap(p_proposer text, p_validator text, p_user text, p_cap text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_proposal uuid;
BEGIN
  PERFORM pc_test.as_user(p_proposer);
  v_proposal := (public.payables_propose_capability_v1(pc_test.key('cap:' || p_user || ':' || p_cap), pc_test.id(p_user),
    p_cap, 'GRANT', 'Attribution synthétique') ->> 'proposal_id')::uuid;
  PERFORM pc_test.as_user(p_validator);
  PERFORM public.payables_decide_capability_v1(pc_test.key('cap-ok:' || p_user || ':' || p_cap), v_proposal, true,
    'Validation synthétique');
  EXECUTE 'RESET ROLE';
END $$;

CREATE FUNCTION pc_test.make_person(p_name text, p_label text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  PERFORM pc_test.as_user('gov_a');
  v := (public.payables_propose_person_v1(pc_test.key('person:' || p_name), p_label, 'Personne synthétique') ->> 'person_id')::uuid;
  PERFORM pc_test.as_user('gov_b');
  PERFORM public.payables_decide_person_v1(pc_test.key('person-ok:' || p_name), v, true, 'Validation synthétique');
  EXECUTE 'RESET ROLE';
  RETURN pc_test.put(p_name, v);
END $$;

CREATE FUNCTION pc_test.link_person(p_person text, p_user text, p_proposer text, p_validator text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  PERFORM pc_test.as_user(p_proposer);
  v := (public.payables_propose_person_link_v1(pc_test.key('link:' || p_person || ':' || p_user), pc_test.id(p_person),
    pc_test.id(p_user), 'LINK', 'Rattachement synthétique') ->> 'link_id')::uuid;
  PERFORM pc_test.as_user(p_validator);
  PERFORM public.payables_decide_person_link_v1(pc_test.key('link-ok:' || p_person || ':' || p_user), v, true,
    'Validation synthétique');
  EXECUTE 'RESET ROLE';
END $$;

CREATE FUNCTION pc_test.set_param(p_kind text, p_subject text, p_valid_from date, p_payload jsonb, p_evidence text, p_label text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  PERFORM pc_test.as_user('gov_a');
  v := (public.payables_propose_parameter_v1(pc_test.key('param:' || p_label), p_kind, p_subject, p_valid_from, p_payload,
    p_evidence, 'Paramètre synthétique') ->> 'version_id')::uuid;
  PERFORM pc_test.as_user('gov_b');
  PERFORM public.payables_decide_parameter_v1(pc_test.key('param-ok:' || p_label), v, true, 'Validation synthétique');
  EXECUTE 'RESET ROLE';
  RETURN pc_test.put(p_label, v);
END $$;

CREATE FUNCTION pc_test.ora_profile_payload(p_overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'profile_code', 'ORA_CHQ_170X95', 'bank', 'ORA', 'state', 'ACTIVE',
    'page', jsonb_build_object('width_mm', 170, 'height_mm', 95),
    'font', jsonb_build_object('family', 'Courier New', 'size_pt', 10),
    'offset', jsonb_build_object('x_mm', 0, 'y_mm', 0),
    'fields', jsonb_build_object(
      'beneficiary', jsonb_build_object('x_mm', 25, 'y_mm', 38, 'max_chars', 48),
      'amount_figures', jsonb_build_object('x_mm', 130, 'y_mm', 18, 'max_chars', 18),
      'amount_words', jsonb_build_object('x_mm', 25, 'y_mm', 26, 'max_chars', 60, 'lines', 2, 'line_gap_mm', 6),
      'issue_date', jsonb_build_object('x_mm', 130, 'y_mm', 48, 'max_chars', 10),
      'place', jsonb_build_object('x_mm', 100, 'y_mm', 48, 'max_chars', 20)),
    'place_label', 'Dakar', 'amount_words_suffix', 'francs CFA', 'amount_words_case', 'UPPER',
    'printer_model', 'Synthetic laser printer',
    'signable_fields', jsonb_build_array('account','cheque_number','currency','beneficiary','amount_figures',
      'amount_words','issue_date','place')) || p_overrides
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pc_test TO authenticated;

-- ---------------------------------------------------------------------------
-- Capacités : second acteur, auto-attribution, propositions concurrentes.
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('gov_a');
SELECT pc_test.expect_error($$SELECT public.payables_propose_capability_v1(pc_test.key('self-1'), pc_test.id('gov_a'),
  'READ', 'GRANT', 'Auto attribution')$$, 'PAYABLES_SELF_GRANT_FORBIDDEN');
SELECT pc_test.expect_error($$SELECT public.payables_propose_capability_v1(pc_test.key('unknown-cap'), pc_test.id('acc1'),
  'STATE_PUBLISH', 'GRANT', 'Capacité hors lot')$$, 'PAYABLES_CAPABILITY_UNKNOWN');
SELECT pc_test.put('cap_acc1_read', (public.payables_propose_capability_v1(pc_test.key('acc1-read'), pc_test.id('acc1'),
  'READ', 'GRANT', 'Lecture comptable 1') ->> 'proposal_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_propose_capability_v1(pc_test.key('acc1-read-dup'), pc_test.id('acc1'),
  'READ', 'GRANT', 'Doublon')$$, 'PAYABLES_PROPOSAL_ALREADY_PENDING');
-- S33 : le proposant ne valide pas sa propre proposition.
SELECT pc_test.expect_error($$SELECT public.payables_decide_capability_v1(pc_test.key('acc1-read-self'),
  pc_test.id('cap_acc1_read'), true, 'Auto validation')$$, 'PAYABLES_SECOND_ACTOR_REQUIRED');
-- S6 / S7 : rejeu identique sans second effet ; contenu différent refusé.
SELECT pc_test.assert((public.payables_propose_capability_v1(pc_test.key('acc1-read'), pc_test.id('acc1'), 'READ', 'GRANT',
  'Lecture comptable 1') ->> 'replayed')::boolean, 'identical replay returns the stored result');
SELECT pc_test.expect_error($$SELECT public.payables_propose_capability_v1(pc_test.key('acc1-read'), pc_test.id('acc1'),
  'READ', 'GRANT', 'Contenu modifié')$$, 'PAYABLES_IDEMPOTENCY_PAYLOAD_MISMATCH');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_capability_grants WHERE user_id = pc_test.id('acc1')) = 1,
  'replay created no second proposal');
SELECT pc_test.as_user('gov_b');
SELECT public.payables_decide_capability_v1(pc_test.key('acc1-read-ok'), pc_test.id('cap_acc1_read'), true, 'Validation');
RESET ROLE;
SELECT pc_test.assert(payables_private.has_capability(pc_test.id('acc1'), 'READ'), 'validated capability is effective');

-- S34 : le bénéficiaire ne valide pas sa propre attribution.
SELECT pc_test.as_user('gov_b');
SELECT pc_test.put('cap_gova_audit', (public.payables_propose_capability_v1(pc_test.key('gova-audit'), pc_test.id('gov_a'),
  'AUDIT', 'GRANT', 'Audit gouverneur') ->> 'proposal_id')::uuid);
SELECT pc_test.as_user('gov_a');
SELECT pc_test.expect_error($$SELECT public.payables_decide_capability_v1(pc_test.key('gova-audit-self'),
  pc_test.id('cap_gova_audit'), true, 'Bénéficiaire')$$, 'PAYABLES_SELF_GRANT_FORBIDDEN');
RESET ROLE;

-- Attribution des capacités de travail (deux gouverneurs distincts).
SELECT pc_test.grant_cap('gov_a', 'gov_b', u, c) FROM (VALUES
  ('acc1','INVOICE_MANAGE'), ('acc1','SUPPLIER_MANAGE'), ('acc1','CHEQUE_PREPARE_PRINT'), ('acc1','TRANSFER_DECLARE'),
  ('acc1','EXIT_REQUEST'), ('acc1','BANK_FOLLOWUP'),
  ('acc2','READ'), ('acc2','CHEQUE_CONFIRM_ISSUE'), ('acc2','EXIT_VALIDATE'), ('acc2','EXCEPTION_INSTRUCT'),
  ('acc2','SUPPLIER_MERGE_VALIDATE'), ('acc2','BANK_FOLLOWUP'), ('acc2','CHEQUE_PREPARE_PRINT'),
  ('acc3','READ'), ('acc3','CHEQUE_PREPARE_PRINT'), ('acc3','CHEQUE_CONFIRM_ISSUE'), ('acc3','EXIT_REQUEST'),
  ('acc3','EXIT_VALIDATE'), ('acc3','EXCEPTION_INSTRUCT'), ('acc3','SUPPLIER_MANAGE'), ('acc3','INVOICE_MANAGE'),
  ('acc3','TRANSFER_DECLARE'),
  ('acc4','READ'), ('acc4','BANK_FOLLOWUP'), ('acc4','BANK_READ'), ('acc4','PARAM_VALIDATE'),
  ('auditor','AUDIT')) AS t(u, c);

-- Révocation : effet immédiat, historique conservé.
SELECT pc_test.as_user('gov_a');
SELECT pc_test.put('cap_rev', (public.payables_propose_capability_v1(pc_test.key('acc4-bank-revoke'), pc_test.id('acc4'),
  'BANK_FOLLOWUP', 'REVOKE', 'Retrait test') ->> 'proposal_id')::uuid);
SELECT pc_test.as_user('gov_b');
SELECT public.payables_decide_capability_v1(pc_test.key('acc4-bank-revoke-ok'), pc_test.id('cap_rev'), true, 'Validation');
RESET ROLE;
SELECT pc_test.assert(NOT payables_private.has_capability(pc_test.id('acc4'), 'BANK_FOLLOWUP'), 'revocation is effective');
SELECT pc_test.grant_cap('gov_b', 'gov_a', 'acc4', 'BANK_FOLLOWUP');
SELECT pc_test.assert(payables_private.has_capability(pc_test.id('acc4'), 'BANK_FOLLOWUP'), 'regrant is effective');
SELECT pc_test.expect_error($$UPDATE public.payables_capability_grants SET reason = 'rewrite' WHERE user_id = pc_test.id('acc4')$$,
  'PAYABLES_DECIDED_ROW_IMMUTABLE');

-- ---------------------------------------------------------------------------
-- Personnes et rattachements vérifiés (S59, S60).
-- ---------------------------------------------------------------------------
SELECT pc_test.make_person('p_acc1', 'Comptable synthétique 1');
SELECT pc_test.make_person('p_acc2', 'Comptable synthétique 2');
SELECT pc_test.make_person('p_acc3', 'Comptable synthétique 3');
SELECT pc_test.make_person('p_dir', 'Dirigeant synthétique');
SELECT pc_test.make_person('p_dex', 'Directeur exploitation synthétique');
SELECT pc_test.make_person('p_sig2', 'Second signataire synthétique');
SELECT pc_test.make_person('p_gova', 'Gouverneur synthétique A');
SELECT pc_test.link_person('p_acc1', 'acc1', 'gov_a', 'gov_b');
SELECT pc_test.link_person('p_acc2', 'acc2', 'gov_a', 'gov_b');
SELECT pc_test.link_person('p_acc3', 'acc3', 'gov_b', 'gov_a');
-- S60 : rattachement validé par son proposant, ou par l'utilisateur rattaché.
SELECT pc_test.as_user('gov_b');
SELECT pc_test.put('link_gova', (public.payables_propose_person_link_v1(pc_test.key('link-gova'), pc_test.id('p_gova'),
  pc_test.id('gov_a'), 'LINK', 'Rattachement gouverneur') ->> 'link_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_decide_person_link_v1(pc_test.key('link-gova-self'), pc_test.id('link_gova'),
  true, 'Auto validation')$$, 'PAYABLES_SECOND_ACTOR_REQUIRED');
SELECT pc_test.as_user('gov_a');
SELECT pc_test.expect_error($$SELECT public.payables_decide_person_link_v1(pc_test.key('link-gova-user'), pc_test.id('link_gova'),
  true, 'Utilisateur rattaché')$$, 'PAYABLES_SELF_GRANT_FORBIDDEN');
SELECT pc_test.as_user('acc4');
SELECT public.payables_decide_person_link_v1(pc_test.key('link-gova-ok'), pc_test.id('link_gova'), true, 'Tiers validateur');
-- Un utilisateur déjà rattaché ne reçoit pas une seconde personne.
SELECT pc_test.as_user('gov_a');
SELECT pc_test.put('link_conflict', (public.payables_propose_person_link_v1(pc_test.key('link-conflict'), pc_test.id('p_dex'),
  pc_test.id('acc1'), 'LINK', 'Second rattachement') ->> 'link_id')::uuid);
SELECT pc_test.as_user('gov_b');
SELECT pc_test.expect_error($$SELECT public.payables_decide_person_link_v1(pc_test.key('link-conflict-ok'),
  pc_test.id('link_conflict'), true, 'Validation')$$, 'PAYABLES_LINK_CONFLICT');
SELECT public.payables_decide_person_link_v1(pc_test.key('link-conflict-no'), pc_test.id('link_conflict'), false, 'Refus du conflit');
RESET ROLE;
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('acc1')) = pc_test.id('p_acc1'), 'acc1 linked to p_acc1');
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('acc4')) IS NULL, 'acc4 not linked');

-- ---------------------------------------------------------------------------
-- Paramètres versionnés : catégories, signataires, règle, profil d'impression.
-- ---------------------------------------------------------------------------
SELECT pc_test.set_param('CATEGORY', 'ALL_PAYMENTS', DATE '2026-01-01',
  jsonb_build_object('code', 'ALL_PAYMENTS', 'label', 'Tous règlements', 'state', 'ACTIVE'), NULL, 'cat_all_v1');
SELECT pc_test.set_param('SIGNATURE_RULE', pc_test.id('acct_ora')::text, DATE '2026-01-01',
  jsonb_build_object('account_registry_id', pc_test.id('acct_ora'), 'required_signatures', 1), NULL, 'rule_ora_v1');
SELECT pc_test.set_param('SIGNATURE_RULE', pc_test.id('acct_bdk')::text, DATE '2026-01-01',
  jsonb_build_object('account_registry_id', pc_test.id('acct_bdk'), 'required_signatures', 1), NULL, 'rule_bdk_v1');
SELECT pc_test.set_param('SIGNATORY', pc_test.id('p_dir')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-01-01',
  jsonb_build_object('person_id', pc_test.id('p_dir'), 'account_registry_id', pc_test.id('acct_ora'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'AMOUNT', 'amount', 50000000)),
  'Pouvoirs bancaires synthétiques n°1', 'sig_dir_ora_v1');
SELECT pc_test.set_param('SIGNATORY', pc_test.id('p_dir')::text || '|' || pc_test.id('acct_bdk')::text, DATE '2026-01-01',
  jsonb_build_object('person_id', pc_test.id('p_dir'), 'account_registry_id', pc_test.id('acct_bdk'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')),
  'Pouvoirs bancaires synthétiques n°2', 'sig_dir_bdk_v1');
SELECT pc_test.set_param('SIGNATORY', pc_test.id('p_dex')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-01-01',
  jsonb_build_object('person_id', pc_test.id('p_dex'), 'account_registry_id', pc_test.id('acct_ora'),
    'state', 'PENDING_CONFIRMATION', 'categories', jsonb_build_array('*'),
    'ceiling', jsonb_build_object('kind', 'AMOUNT', 'amount', 10000000)), 'Pouvoirs en attente', 'sig_dex_ora_v1');
SELECT pc_test.set_param('SIGNATORY', pc_test.id('p_sig2')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-01-01',
  jsonb_build_object('person_id', pc_test.id('p_sig2'), 'account_registry_id', pc_test.id('acct_ora'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('ALL_PAYMENTS'), 'ceiling', jsonb_build_object('kind', 'ABSENT')),
  'Pouvoirs sans plafond renseigné', 'sig_sig2_ora_v1');
SELECT pc_test.set_param('PRINT_PROFILE', 'ORA_CHQ_170X95', DATE '2026-01-01', pc_test.ora_profile_payload(),
  'Essai papier superposé synthétique', 'profile_ora_v1');

-- S35 : une nouvelle version ne peut pas s'intercaler avant une version validée.
SELECT pc_test.as_user('gov_a');
SELECT pc_test.put('cat_all_v2', (public.payables_propose_parameter_v1(pc_test.key('cat-v2'), 'CATEGORY', 'ALL_PAYMENTS',
  DATE '2025-06-01', jsonb_build_object('code', 'ALL_PAYMENTS', 'label', 'Tous règlements', 'state', 'RETIRED'),
  NULL, 'Rétroactif') ->> 'version_id')::uuid);
SELECT pc_test.as_user('gov_b');
SELECT pc_test.expect_error($$SELECT public.payables_decide_parameter_v1(pc_test.key('cat-v2-ok'), pc_test.id('cat_all_v2'),
  true, 'Validation')$$, 'PAYABLES_VALIDITY_OVERLAP');
SELECT public.payables_decide_parameter_v1(pc_test.key('cat-v2-no'), pc_test.id('cat_all_v2'), false, 'Refus rétroactif');
-- Personne ne s'inscrit comme signataire (proposition ni validation).
SELECT pc_test.as_user('gov_a');
SELECT pc_test.expect_error($$SELECT public.payables_propose_parameter_v1(pc_test.key('self-sig'), 'SIGNATORY',
  pc_test.id('p_gova')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-02-01',
  jsonb_build_object('person_id', pc_test.id('p_gova'), 'account_registry_id', pc_test.id('acct_ora'), 'state', 'ACTIVE',
  'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce', 'Auto inscription')$$,
  'PAYABLES_SELF_GRANT_FORBIDDEN');
SELECT pc_test.as_user('gov_b');
SELECT pc_test.put('sig_gova', (public.payables_propose_parameter_v1(pc_test.key('gova-sig'), 'SIGNATORY',
  pc_test.id('p_gova')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-02-01',
  jsonb_build_object('person_id', pc_test.id('p_gova'), 'account_registry_id', pc_test.id('acct_ora'), 'state', 'ACTIVE',
  'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce', 'Proposition tiers')
  ->> 'version_id')::uuid);
SELECT pc_test.as_user('gov_a');
SELECT pc_test.expect_error($$SELECT public.payables_decide_parameter_v1(pc_test.key('gova-sig-self'), pc_test.id('sig_gova'),
  true, 'Validation par la personne')$$, 'PAYABLES_SELF_GRANT_FORBIDDEN');
-- Profils d'impression : banque non ouverte, contenu signable amputé.
SELECT pc_test.expect_error($$SELECT public.payables_propose_parameter_v1(pc_test.key('profile-bdk'), 'PRINT_PROFILE',
  'BDK_CHQ', DATE '2026-02-01', pc_test.ora_profile_payload(jsonb_build_object('profile_code','BDK_CHQ','bank','BDK')),
  'Essai', 'Autre banque')$$, 'PAYABLES_PRINT_PROFILE_BANK_NOT_ENABLED');
SELECT pc_test.expect_error($$SELECT public.payables_propose_parameter_v1(pc_test.key('profile-cut'), 'PRINT_PROFILE',
  'ORA_CUT', DATE '2026-02-01', pc_test.ora_profile_payload(jsonb_build_object('profile_code','ORA_CUT',
  'signable_fields', jsonb_build_array('beneficiary','amount_figures'))), 'Essai', 'Champs retirés')$$,
  'PAYABLES_PRINT_PROFILE_SIGNABLE_FIELDS_INVALID');
SELECT pc_test.expect_error($$SELECT public.payables_propose_parameter_v1(pc_test.key('profile-noev'), 'PRINT_PROFILE',
  'ORA_NOEV', DATE '2026-02-01', pc_test.ora_profile_payload(jsonb_build_object('profile_code','ORA_NOEV')), NULL,
  'Sans essai')$$, 'PAYABLES_EVIDENCE_INVALID');
SELECT pc_test.expect_error($$SELECT public.payables_propose_parameter_v1(pc_test.key('sig-inactive'), 'SIGNATORY',
  gen_random_uuid()::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-02-01',
  jsonb_build_object('person_id', gen_random_uuid(), 'account_registry_id', pc_test.id('acct_ora'), 'state', 'ACTIVE',
  'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce', 'Inconnu')$$,
  'PAYABLES_PARAMETER_PAYLOAD_INVALID:subject');
-- Revue P1-4 : champ absent ou mal typé = refus (aucune logique NULL permissive).
SELECT pc_test.expect_error($$SELECT public.payables_propose_parameter_v1(pc_test.key('sig-nocat'), 'SIGNATORY',
  pc_test.id('p_sig2')::text || '|' || pc_test.id('acct_bdk')::text, DATE '2026-02-01',
  jsonb_build_object('person_id', pc_test.id('p_sig2'), 'account_registry_id', pc_test.id('acct_bdk'), 'state', 'ACTIVE',
  'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce', 'Sans catégories')$$,
  'PAYABLES_PARAMETER_PAYLOAD_INVALID:categories');
SELECT pc_test.expect_error($$SELECT public.payables_propose_parameter_v1(pc_test.key('sig-cat-text'), 'SIGNATORY',
  pc_test.id('p_sig2')::text || '|' || pc_test.id('acct_bdk')::text, DATE '2026-02-01',
  jsonb_build_object('person_id', pc_test.id('p_sig2'), 'account_registry_id', pc_test.id('acct_bdk'), 'state', 'ACTIVE',
  'categories', '*', 'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce', 'Catégories en texte')$$,
  'PAYABLES_PARAMETER_PAYLOAD_INVALID:categories');
SELECT pc_test.expect_error($$SELECT public.payables_propose_parameter_v1(pc_test.key('sig-noperson'), 'SIGNATORY',
  '|' || pc_test.id('acct_bdk')::text, DATE '2026-02-01',
  jsonb_build_object('account_registry_id', pc_test.id('acct_bdk'), 'state', 'ACTIVE', 'categories', jsonb_build_array('*'),
  'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce', 'Sans personne')$$,
  'PAYABLES_PARAMETER_PAYLOAD_INVALID:subject');
RESET ROLE;
-- Défense en profondeur : une version mal formée ne rend jamais un signataire admissible.
SELECT pc_test.assert(payables_private.signatory_version_if_admissible(pc_test.id('p_sig2'), pc_test.id('acct_ora'), NULL, 1,
  DATE '2026-10-01') IS NULL, 'missing category never admits a signatory');

-- Accès courant exposé au client : capacités et état de l'interrupteur, sans secret.
SELECT pc_test.as_user('acc1');
SELECT pc_test.assert((public.payables_my_access_v1() -> 'capabilities') ? 'CHEQUE_PREPARE_PRINT', 'my_access lists capabilities');
SELECT pc_test.assert((public.payables_my_access_v1() ->> 'person_id')::uuid = pc_test.id('p_acc1'), 'my_access returns person');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_parameter_versions) >= 8, 'READ holder sees parameters');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events) = 0, 'events hidden without AUDIT');
SELECT pc_test.as_user('auditor');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events) > 0, 'AUDIT holder reads events');
RESET ROLE;

SELECT 'PASS 20_governance' AS marker;
