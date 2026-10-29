-- Installation neuve : les outils de 20_governance (mêmes signatures) sont
-- réalisés par l'administrateur unique, sans second approbateur. Les suites
-- financières 30 à 80 s'exécutent ensuite sans modification sous la nouvelle
-- gouvernance. Les arguments « proposant » et « valideur » des outils sont
-- conservés pour la compatibilité et ignorés.

CREATE FUNCTION pc_test.grant_cap(p_proposer text, p_validator text, p_user text, p_cap text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pc_test.as_user('dg');
  PERFORM public.payables_admin_set_capability_v1(pc_test.key('admin-cap:' || p_user || ':' || p_cap), pc_test.id(p_user),
    p_cap, true, 'Attribution synthétique');
  EXECUTE 'RESET ROLE';
END $$;

CREATE FUNCTION pc_test.make_person(p_name text, p_label text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  PERFORM pc_test.as_user('dg');
  v := (public.payables_admin_create_person_v1(pc_test.key('admin-person:' || p_name), p_label, 'Personne synthétique')
    ->> 'person_id')::uuid;
  EXECUTE 'RESET ROLE';
  RETURN pc_test.put(p_name, v);
END $$;

CREATE FUNCTION pc_test.link_person(p_person text, p_user text, p_proposer text, p_validator text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pc_test.as_user('dg');
  PERFORM public.payables_admin_set_person_link_v1(pc_test.key('admin-link:' || p_person || ':' || p_user),
    pc_test.id(p_person), pc_test.id(p_user), true, 'Rattachement synthétique');
  EXECUTE 'RESET ROLE';
END $$;

-- Dernier numéro de version connu (lecture opérateur pour l'outil de test).
CREATE FUNCTION pc_test.param_version(p_kind text, p_subject text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(max(v.version_no), 0) FROM public.payables_parameter_versions v
  WHERE v.kind = p_kind AND v.subject_key = p_subject
$$;

CREATE FUNCTION pc_test.set_param(p_kind text, p_subject text, p_valid_from date, p_payload jsonb, p_evidence text, p_label text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; v_expected integer := pc_test.param_version(p_kind, p_subject);
BEGIN
  PERFORM pc_test.as_user('dg');
  v := (public.payables_admin_set_parameter_v1(pc_test.key('admin-param:' || p_label), p_kind, p_subject, p_valid_from,
    p_payload, p_evidence, v_expected, 'Paramètre synthétique') ->> 'version_id')::uuid;
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

-- État final équivalent à 20_governance (capacités de travail, personnes,
-- rattachements, paramètres), sans les capacités de gouvernance retirées.
SELECT pc_test.grant_cap('dg', 'dg', u, c) FROM (VALUES
  ('acc1','READ'),
  ('acc1','INVOICE_MANAGE'), ('acc1','SUPPLIER_MANAGE'), ('acc1','CHEQUE_PREPARE_PRINT'), ('acc1','TRANSFER_DECLARE'),
  ('acc1','EXIT_REQUEST'), ('acc1','BANK_FOLLOWUP'),
  ('acc2','READ'), ('acc2','CHEQUE_CONFIRM_ISSUE'), ('acc2','EXIT_VALIDATE'), ('acc2','EXCEPTION_INSTRUCT'),
  ('acc2','SUPPLIER_MERGE_VALIDATE'), ('acc2','BANK_FOLLOWUP'), ('acc2','CHEQUE_PREPARE_PRINT'),
  ('acc3','READ'), ('acc3','CHEQUE_PREPARE_PRINT'), ('acc3','CHEQUE_CONFIRM_ISSUE'), ('acc3','EXIT_REQUEST'),
  ('acc3','EXIT_VALIDATE'), ('acc3','EXCEPTION_INSTRUCT'), ('acc3','SUPPLIER_MANAGE'), ('acc3','INVOICE_MANAGE'),
  ('acc3','TRANSFER_DECLARE'),
  ('acc4','READ'), ('acc4','BANK_FOLLOWUP'), ('acc4','BANK_READ'),
  ('auditor','AUDIT')) AS t(u, c);

SELECT pc_test.make_person('p_acc1', 'Comptable synthétique 1');
SELECT pc_test.make_person('p_acc2', 'Comptable synthétique 2');
SELECT pc_test.make_person('p_acc3', 'Comptable synthétique 3');
SELECT pc_test.make_person('p_dir', 'Dirigeant synthétique');
SELECT pc_test.make_person('p_dex', 'Directeur exploitation synthétique');
SELECT pc_test.make_person('p_sig2', 'Second signataire synthétique');
SELECT pc_test.make_person('p_gova', 'Gouverneur synthétique A');
SELECT pc_test.link_person('p_acc1', 'acc1', 'dg', 'dg');
SELECT pc_test.link_person('p_acc2', 'acc2', 'dg', 'dg');
SELECT pc_test.link_person('p_acc3', 'acc3', 'dg', 'dg');
SELECT pc_test.link_person('p_gova', 'gov_a', 'dg', 'dg');

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

-- Mêmes règles de contenu qu'avant : profil d'une autre banque, champs signables
-- amputés et justificatif absent restent refusés, administrateur compris.
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_parameter_v1(pc_test.key('admin-profile-bdk'), 'PRINT_PROFILE',
  'BDK_CHQ', DATE '2026-02-01', pc_test.ora_profile_payload(jsonb_build_object('profile_code','BDK_CHQ','bank','BDK')),
  'Essai', 0, 'Autre banque')$$, 'PAYABLES_PRINT_PROFILE_BANK_NOT_ENABLED');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_parameter_v1(pc_test.key('admin-profile-cut'), 'PRINT_PROFILE',
  'ORA_CUT', DATE '2026-02-01', pc_test.ora_profile_payload(jsonb_build_object('profile_code','ORA_CUT',
  'signable_fields', jsonb_build_array('beneficiary','amount_figures'))), 'Essai', 0, 'Champs retirés')$$,
  'PAYABLES_PRINT_PROFILE_SIGNABLE_FIELDS_INVALID');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_parameter_v1(pc_test.key('admin-profile-noev'), 'PRINT_PROFILE',
  'ORA_NOEV', DATE '2026-02-01', pc_test.ora_profile_payload(jsonb_build_object('profile_code','ORA_NOEV')), NULL, 0,
  'Sans essai')$$, 'PAYABLES_EVIDENCE_INVALID');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_parameter_v1(pc_test.key('admin-cat-retro'), 'CATEGORY',
  'ALL_PAYMENTS', DATE '2025-06-01', jsonb_build_object('code', 'ALL_PAYMENTS', 'label', 'Tous règlements', 'state', 'RETIRED'),
  NULL, 1, 'Rétroactif')$$, 'PAYABLES_VALIDITY_OVERLAP');
RESET ROLE;

-- Toutes les décisions de cette installation portent l'origine ADMIN et
-- l'administrateur comme auteur et décideur.
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_capability_grants
  WHERE origin <> 'ADMIN' OR decided_by <> pc_test.id('dg') OR proposed_by <> pc_test.id('dg')), 'grants decided by the administrator');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_persons WHERE origin <> 'ADMIN' OR status <> 'ACTIVE'),
  'persons created by the administrator');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_parameter_versions WHERE origin <> 'ADMIN' OR status <> 'VALIDATED'),
  'parameters validated by the administrator');
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('acc1')) = pc_test.id('p_acc1'), 'acc1 linked to p_acc1');
SELECT pc_test.assert(payables_private.has_capability(pc_test.id('acc4'), 'BANK_READ')
  AND NOT payables_private.has_capability(pc_test.id('acc4'), 'PARAM_VALIDATE'), 'working capabilities only');
SELECT pc_test.as_user('acc1');
SELECT pc_test.assert((public.payables_my_access_v1() -> 'capabilities') ? 'CHEQUE_PREPARE_PRINT', 'my_access lists capabilities');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_parameter_versions) >= 8, 'READ holder sees parameters');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events) = 0, 'events hidden without AUDIT');
SELECT pc_test.as_user('auditor');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events WHERE event_type = 'CAPABILITY_GRANTED_BY_ADMIN') > 0,
  'AUDIT holder reads administrative decisions');
RESET ROLE;

SELECT 'PASS 21_single_admin_governance_setup' AS marker;
