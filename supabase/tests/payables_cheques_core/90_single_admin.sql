-- Modèle administrateur unique (GO_IMPLEMENT_PAYABLES_CHEQUES_SINGLE_ADMIN).
-- Joué dans les deux scénarios (mise à niveau et installation neuve), après
-- 80 : administrateur « dg » désigné par l'opérateur, interrupteur métier fermé.
-- Données strictement synthétiques. Rôle postgres sauf mention.

CREATE FUNCTION pc_test.dakar_today()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT payables_private.today()
$$;
CREATE FUNCTION pc_test.sa_param_version(p_kind text, p_subject text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(max(v.version_no), 0) FROM public.payables_parameter_versions v
  WHERE v.kind = p_kind AND v.subject_key = p_subject
$$;
-- Demande de chèque complète puis formule imprimée, par un même acteur.
CREATE FUNCTION pc_test.sa_printed_cheque(p_actor text, p_label text, p_supplier uuid, p_amount numeric, p_number text,
  p_account text DEFAULT 'acct_ora_pilot', p_category text DEFAULT 'PILOT_ADMIN')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_invoice uuid; v_payment uuid; v_form uuid; v_event uuid;
BEGIN
  PERFORM pc_test.as_user(p_actor);
  v_invoice := (public.payables_create_invoice_v1(pc_test.key('sa-inv:' || p_label), p_supplier, 'SA-REF-' || p_label, p_amount,
    'XOF', NULL, NULL, 'Original ' || p_label) ->> 'invoice_id')::uuid;
  v_payment := (public.payables_create_cheque_request_v1(pc_test.key('sa-req:' || p_label), v_invoice, pc_test.id(p_account),
    p_category, NULL, false, 'Bénéficiaire synthétique ' || p_label, 'Paiement ' || p_label) ->> 'payment_id')::uuid;
  v_form := (public.payables_assign_cheque_form_v1(pc_test.key('sa-assign:' || p_label), v_payment,
    pc_test.payment_version(v_payment), p_number, 'ORA_CHQ_170X95', pc_test.dakar_today()) ->> 'form_id')::uuid;
  v_event := (public.payables_record_print_intent_v1(pc_test.key('sa-intent:' || p_label), v_form, pc_test.form_version(v_form),
    pc_test.content_of(v_form), 'Impression synthétique') ->> 'print_event_id')::uuid;
  PERFORM public.payables_record_print_outcome_v1(pc_test.key('sa-outcome:' || p_label), v_event, 'PRINTED', NULL);
  EXECUTE 'RESET ROLE';
  RETURN pc_test.put('sa_form_' || p_label, v_form);
END $$;
CREATE FUNCTION pc_test.sa_confirm_sql(p_label text)
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.payables_confirm_issuance_v1(%L, %L::uuid, %s, %L::date, false)',
    pc_test.key('sa-confirm:' || p_label), pc_test.id('sa_form_' || p_label),
    pc_test.form_version(pc_test.id('sa_form_' || p_label)), pc_test.dakar_today())
$$;
-- Réinitialise les revendications falsifiées d'un test d'identité.
CREATE FUNCTION pc_test.clear_claims()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', false);
  PERFORM set_config('request.jwt.claim.email', '', false);
  PERFORM set_config('request.jwt.claim.role', '', false);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pc_test TO authenticated;

-- ---------------------------------------------------------------------------
-- 0. Invariants de sécurité après la migration (repris de 10 et 80).
-- ---------------------------------------------------------------------------
SELECT pc_test.assert((SELECT admin_user_id FROM payables_private.admin_authority) = pc_test.id('dg'), 'administrator designated');
SELECT pc_test.assert((SELECT NOT business_writes_enabled AND NOT export_enabled FROM payables_private.runtime_control),
  'business writes and exports closed at start');
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE tablename LIKE 'payables\_%' ESCAPE '\'
    AND (qual IN ('true','(true)') OR with_check IS NOT NULL OR cmd <> 'SELECT')),
  'policies are SELECT-only and never USING(true)');
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public','payables_private') AND c.relkind = 'r'
    AND (c.relname LIKE 'payables\_%' ESCAPE '\' OR n.nspname = 'payables_private') AND NOT c.relrowsecurity),
  'RLS enabled on every domain table');
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE (table_name LIKE 'payables\_%' ESCAPE '\' OR table_schema = 'payables_private')
    AND grantee IN ('anon','authenticated','service_role','PUBLIC') AND privilege_type <> 'SELECT'),
  'no write privilege for application roles');
SELECT pc_test.assert(NOT has_table_privilege(r, 'payables_private.admin_authority', 'SELECT')
  AND NOT has_table_privilege(r, 'payables_private.admin_authority_events', 'SELECT'), 'authority unreadable by ' || r)
FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT pc_test.assert(NOT has_schema_privilege(r, 'payables_private', 'USAGE'), 'private schema closed to ' || r)
FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'payables_private' OR p.proname LIKE 'payables\_%' ESCAPE '\')
    AND (has_function_privilege('service_role', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'no payables function executable by service_role or anon');
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'payables_private' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'no private helper executable by authenticated');
SELECT pc_test.assert(has_function_privilege('authenticated', p.oid, 'EXECUTE'), 'admin API open to authenticated: ' || p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'payables\_admin\_%' ESCAPE '\';
SELECT pc_test.assert((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'payables\_admin\_%' ESCAPE '\') = 5, 'five admin API functions');
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'payables_private' OR p.proname LIKE 'payables\_%' ESCAPE '\') AND p.prosecdef
    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')),
  'every SECURITY DEFINER function pins search_path');
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'payables_private' OR p.proname LIKE 'payables\_%' ESCAPE '\')
    AND p.prorettype <> 'trigger'::regtype AND p.proname ~ '(purge|delete|truncate|drop)'), 'no purge function exists');
-- Aucune API d'administration ne reçoit l'identité ou le rôle de l'appelant.
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM information_schema.parameters p JOIN information_schema.routines r ON r.specific_name = p.specific_name
  WHERE r.routine_schema = 'public' AND r.routine_name LIKE 'payables\_admin\_%' ESCAPE '\'
    AND p.parameter_name ~ '(actor|admin|role|email|claim|metadata)'), 'admin API takes no caller identity');
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM information_schema.parameters p JOIN information_schema.routines r ON r.specific_name = p.specific_name
  WHERE r.routine_schema = 'public' AND r.routine_name LIKE 'payables\_%' ESCAPE '\'
    AND p.parameter_mode = 'IN' AND p.data_type LIKE 'timestamp%'), 'no API parameter carries a timestamp');

-- ---------------------------------------------------------------------------
-- 1 et 7. L'administrateur gère seul droits, personnes et paramètres pendant
-- que les écritures métier restent fermées.
-- ---------------------------------------------------------------------------
INSERT INTO public.daily_statement_account_registry (id, created_by, bank, currency, safe_alias, account_fingerprint)
VALUES ('20000000-0000-4000-8000-0000000000a2', pc_test.id('admin'), 'ORA', 'XOF', 'ORA pilote synthétique', repeat('9', 64));
SELECT pc_test.put('acct_ora_pilot', '20000000-0000-4000-8000-0000000000a2');
CREATE TABLE pc_test.sa_switch_before AS SELECT count(*) AS n FROM payables_private.runtime_control_events;

SELECT pc_test.as_user('dg');
SELECT pc_test.put('p_dirigeant', (public.payables_admin_create_person_v1(pc_test.key('sa-person-dg'), 'Dirigeant signataire synthétique',
  'Signataire unique') ->> 'person_id')::uuid);
SELECT pc_test.put('p_cpt_a', (public.payables_admin_create_person_v1(pc_test.key('sa-person-a'), 'Comptable A synthétique',
  'Comptable opérationnel') ->> 'person_id')::uuid);
SELECT pc_test.put('p_cpt_b', (public.payables_admin_create_person_v1(pc_test.key('sa-person-b'), 'Comptable B synthétique',
  'Comptable opérationnel') ->> 'person_id')::uuid);
SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-link-a'), pc_test.id('p_cpt_a'), pc_test.id('cpt_a'), true,
  'Rattachement vérifié');
SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-link-b'), pc_test.id('p_cpt_b'), pc_test.id('cpt_b'), true,
  'Rattachement vérifié');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-cap:' || u || ':' || c), pc_test.id(u), c, true, 'Rôle opérationnel')
FROM (VALUES ('cpt_a','READ'), ('cpt_a','SUPPLIER_MANAGE'), ('cpt_a','INVOICE_MANAGE'), ('cpt_a','CHEQUE_PREPARE_PRINT'),
  ('cpt_b','READ'), ('cpt_b','CHEQUE_CONFIRM_ISSUE')) AS t(u, c);
SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-cat-v1'), 'CATEGORY', 'PILOT_ADMIN', pc_test.dakar_today(),
  jsonb_build_object('code', 'PILOT_ADMIN', 'label', 'Pilote administrateur', 'state', 'ACTIVE'), NULL, 0, 'Catégorie pilote');
SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-rule-v1'), 'SIGNATURE_RULE', pc_test.id('acct_ora_pilot')::text,
  pc_test.dakar_today(), jsonb_build_object('account_registry_id', pc_test.id('acct_ora_pilot'), 'required_signatures', 1),
  NULL, 0, 'Une signature');
SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-sig-v1'), 'SIGNATORY',
  pc_test.id('p_dirigeant')::text || '|' || pc_test.id('acct_ora_pilot')::text, pc_test.dakar_today(),
  jsonb_build_object('person_id', pc_test.id('p_dirigeant'), 'account_registry_id', pc_test.id('acct_ora_pilot'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')),
  'Pouvoirs bancaires synthétiques du dirigeant', 0, 'Signataire unique');
RESET ROLE;

SELECT pc_test.assert(payables_private.has_capability(pc_test.id('cpt_a'), 'CHEQUE_PREPARE_PRINT')
  AND payables_private.has_capability(pc_test.id('cpt_b'), 'CHEQUE_CONFIRM_ISSUE')
  AND NOT payables_private.has_capability(pc_test.id('cpt_a'), 'CHEQUE_CONFIRM_ISSUE'), 'administrative grants effective at once');
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('cpt_a')) = pc_test.id('p_cpt_a'), 'administrative link effective');
SELECT pc_test.assert(payables_private.effective_parameter('SIGNATORY',
  pc_test.id('p_dirigeant')::text || '|' || pc_test.id('acct_ora_pilot')::text, pc_test.dakar_today()) IS NOT NULL,
  'administrative parameter effective');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_capability_grants
  WHERE user_id IN (pc_test.id('cpt_a'), pc_test.id('cpt_b')) AND capability NOT IN ('PARAM_PROPOSE','PARAM_VALIDATE')
    AND (origin <> 'ADMIN' OR status <> 'VALIDATED' OR proposed_by <> pc_test.id('dg') OR decided_by <> pc_test.id('dg'))),
  'no second approver: the administrator authors and decides');
SELECT pc_test.assert((SELECT n FROM pc_test.sa_switch_before) = (SELECT count(*) FROM payables_private.runtime_control_events)
  AND (SELECT NOT business_writes_enabled FROM payables_private.runtime_control), 'administration never opened the business switch');
-- Interrupteur fermé : aucune écriture financière, ni pour un comptable, ni pour l'administrateur.
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1(pc_test.key('sa-closed-1'), 'Fournisseur fermé',
  'Module fermé')$$, 'PAYABLES_DOMAIN_READ_ONLY');
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1(pc_test.key('sa-closed-2'), 'Fournisseur fermé',
  'Module fermé')$$, 'PAYABLES_DOMAIN_READ_ONLY');
SELECT pc_test.assert((public.payables_my_access_v1() ->> 'is_admin')::boolean
  AND NOT (public.payables_my_access_v1() ->> 'business_writes_enabled')::boolean
  AND (public.payables_my_access_v1() -> 'capabilities') ?& ARRAY['READ','AUDIT','BANK_READ','CHEQUE_CONFIRM_ISSUE']
  AND NOT (public.payables_my_access_v1() -> 'capabilities') ?| ARRAY['PARAM_PROPOSE','PARAM_VALIDATE'],
  'administrator holds every working capability, none retired');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Un comptable ne s'élève pas, ne touche pas aux droits du dirigeant et ne
-- se désigne pas administrateur ; l'administrateur ne statue pas sur lui-même.
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-up-1'), pc_test.id('cpt_a'),
  'BANK_READ', true, 'Auto élévation')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-up-2'), pc_test.id('dg'), 'READ',
  false, 'Retrait du dirigeant')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.expect_error($$SELECT public.payables_admin_create_person_v1(pc_test.key('sa-up-3'), 'Personne', 'Création')$$,
  'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-up-4'), pc_test.id('p_dirigeant'),
  pc_test.id('cpt_a'), true, 'Se rattacher au signataire')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-up-5'), 'SIGNATORY',
  pc_test.id('p_cpt_a')::text || '|' || pc_test.id('acct_ora_pilot')::text, DATE '2027-01-01',
  jsonb_build_object('person_id', pc_test.id('p_cpt_a'), 'account_registry_id', pc_test.id('acct_ora_pilot'), 'state', 'ACTIVE',
  'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')), 'Pièce', 0, 'Auto signataire')$$,
  'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.expect_error($$SELECT public.payables_admin_reject_legacy_proposal_v1(pc_test.key('sa-up-6'), 'CAPABILITY',
  gen_random_uuid(), 'Clôture')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.expect_error($$SELECT public.payables_propose_capability_v1(pc_test.key('sa-up-7'), pc_test.id('cpt_b'), 'READ',
  'GRANT', 'Ancienne voie')$$, 'PAYABLES_LEGACY_GOVERNANCE_DISABLED');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin(pc_test.id('dg'), auth.uid(), 'Auto désignation')$$,
  'permission denied');
SELECT pc_test.expect_error($$UPDATE payables_private.admin_authority SET admin_user_id = auth.uid(),
  change_reason = 'Auto désignation directe'$$, 'permission denied');
SELECT pc_test.expect_error($$INSERT INTO public.payables_capability_grants (user_id, capability, action, origin, status,
  proposed_by, decided_by, decided_at, decision_seq, reason) VALUES (auth.uid(), 'BANK_READ', 'GRANT', 'ADMIN', 'VALIDATED',
  auth.uid(), auth.uid(), now(), 1, 'Écriture directe')$$, 'permission denied');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() ->> 'is_admin')::boolean, 'accountant is not administrator');
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-self-1'), pc_test.id('dg'), 'READ',
  false, 'Décision sur soi')$$, 'PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN');
-- Personne libre : seul le refus d'auto-rattachement peut s'appliquer.
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-self-2'), pc_test.id('p_dirigeant'),
  pc_test.id('dg'), true, 'Se rattacher soi-même')$$, 'PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-retired'), pc_test.id('cpt_a'),
  'PARAM_VALIDATE', true, 'Capacité retirée')$$, 'PAYABLES_CAPABILITY_RETIRED');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-unknown'), pc_test.id('cpt_a'),
  'STATE_PUBLISH', true, 'Capacité hors lot')$$, 'PAYABLES_CAPABILITY_UNKNOWN');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-nouser'), gen_random_uuid(),
  'READ', true, 'Utilisateur inconnu')$$, 'PAYABLES_USER_UNKNOWN');
RESET ROLE;
-- Défense en profondeur : même l'opérateur ne peut pas inscrire une capacité retirée d'origine ADMIN.
SELECT pc_test.expect_error($$INSERT INTO public.payables_capability_grants (user_id, capability, action, origin, status,
  proposed_by, decided_by, decided_at, decision_seq, reason) VALUES (pc_test.id('cpt_a'), 'PARAM_VALIDATE', 'GRANT', 'ADMIN',
  'VALIDATED', pc_test.id('dg'), pc_test.id('dg'), now(), nextval('payables_private.decision_seq'), 'Écriture opérateur')$$,
  'payables_capability_grants_lifecycle');
SELECT pc_test.expect_error($$INSERT INTO public.payables_capability_grants (user_id, capability, action, origin, status,
  proposed_by, decided_by, decided_at, decision_seq, reason) VALUES (pc_test.id('dg'), 'READ', 'GRANT', 'ADMIN',
  'VALIDATED', pc_test.id('dg'), pc_test.id('dg'), now(), nextval('payables_private.decision_seq'), 'Décision sur soi')$$,
  'payables_capability_grants_lifecycle');

-- ---------------------------------------------------------------------------
-- 3. Un ancien détenteur de PARAM_PROPOSE / PARAM_VALIDATE n'acquiert rien.
-- ---------------------------------------------------------------------------
INSERT INTO public.payables_capability_grants (user_id, capability, action, origin, status, decision_seq, reason, decided_at)
SELECT pc_test.id('cpt_b'), c, 'GRANT', 'BOOTSTRAP', 'VALIDATED', nextval('payables_private.decision_seq'),
  'Simulated legacy bootstrap grant', now()
FROM unnest(ARRAY['PARAM_PROPOSE','PARAM_VALIDATE']) c;
SELECT pc_test.assert(NOT payables_private.has_capability(pc_test.id('cpt_b'), 'PARAM_PROPOSE')
  AND NOT payables_private.has_capability(pc_test.id('cpt_b'), 'PARAM_VALIDATE'), 'legacy governance grant has no effect');
SELECT pc_test.as_user('cpt_b');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() -> 'capabilities') ?| ARRAY['PARAM_PROPOSE','PARAM_VALIDATE']
  AND NOT (public.payables_my_access_v1() ->> 'is_admin')::boolean, 'legacy holder sees no governance right');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-legacy-1'), pc_test.id('cpt_a'),
  'BANK_READ', true, 'Ancien valideur')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.expect_error($$SELECT public.payables_decide_person_link_v1(pc_test.key('sa-legacy-2'), gen_random_uuid(), true,
  'Ancien valideur')$$, 'PAYABLES_LEGACY_GOVERNANCE_DISABLED');
SELECT pc_test.expect_error($$SELECT public.payables_propose_person_v1(pc_test.key('sa-legacy-3'), 'Personne', 'Ancien proposant')$$,
  'PAYABLES_LEGACY_GOVERNANCE_DISABLED');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. Identité, rôle ou e-mail falsifiés côté client : jamais suffisants.
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('cpt_a');
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pc_test.id('cpt_a'), 'email', 'dirigeant@synthetic.invalid',
  'role', 'service_role', 'app_metadata', jsonb_build_object('role', 'admin', 'payables_admin', true),
  'user_metadata', jsonb_build_object('is_admin', true, 'payables_role', 'ADMIN'))::text, false);
SELECT set_config('request.jwt.claim.email', 'dirigeant@synthetic.invalid', false);
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-forged-1'), pc_test.id('cpt_b'),
  'BANK_READ', true, 'Revendications falsifiées')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() ->> 'is_admin')::boolean
  AND NOT (public.payables_my_access_v1() -> 'capabilities') ? 'BANK_READ', 'forged claims confer nothing');
SELECT pc_test.clear_claims();
-- Rôle global « admin » de l'application : aucun pouvoir sur le module.
SELECT pc_test.as_user('admin');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-forged-2'), pc_test.id('cpt_b'),
  'BANK_READ', true, 'Rôle global admin')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.assert(jsonb_array_length(public.payables_my_access_v1() -> 'capabilities') = 0, 'global admin holds no capability');
-- Identité inconnue, rôle service_role, anonyme.
SELECT set_config('request.jwt.claim.sub', gen_random_uuid()::text, false);
SELECT pc_test.expect_error($$SELECT public.payables_admin_create_person_v1(pc_test.key('sa-forged-3'), 'Personne', 'Inconnu')$$,
  'PAYABLES_AUTH_REQUIRED');
RESET ROLE;
SET ROLE service_role;
SELECT pc_test.expect_error($$SELECT public.payables_admin_create_person_v1('pc-test:sa-forged-4', 'Personne', 'Service role')$$,
  'permission denied');
RESET ROLE;
SELECT pc_test.as_anonymous();
SELECT pc_test.expect_error($$SELECT public.payables_admin_create_person_v1('pc-test:sa-forged-5', 'Personne', 'Anonyme')$$,
  'permission denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- 5. Révocation : effet serveur immédiat sur une session déjà ouverte.
-- ---------------------------------------------------------------------------
UPDATE payables_private.runtime_control
   SET business_writes_enabled = true, change_reason = 'Open synthetic window for single-admin checks';
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.put('sa_supplier', (public.payables_create_supplier_v1(pc_test.key('sa-sup-1'), 'Fournisseur pilote administrateur',
  'Avant révocation') ->> 'supplier_id')::uuid);
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-revoke-1'), pc_test.id('cpt_a'), 'SUPPLIER_MANAGE', false,
  'Retrait immédiat');
-- Même session, mêmes revendications : refus dès l'appel suivant.
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1(pc_test.key('sa-sup-2'), 'Fournisseur après retrait',
  'Après révocation')$$, 'PAYABLES_CAPABILITY_REQUIRED:SUPPLIER_MANAGE');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() -> 'capabilities') ? 'SUPPLIER_MANAGE', 'revocation visible at once');
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-regrant-1'), pc_test.id('cpt_a'), 'SUPPLIER_MANAGE', true,
  'Nouvelle attribution');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Signature : le dirigeant reste seul signataire ; un comptable qui enregistre
-- une signature n'acquiert aucun pouvoir.
-- ---------------------------------------------------------------------------
SELECT pc_test.sa_printed_cheque('cpt_a', 'own_sig', pc_test.id('sa_supplier'), 150000, '0091000001');
SELECT pc_test.sa_printed_cheque('cpt_a', 'dir_sig', pc_test.id('sa_supplier'), 175000, '0091000002');
SELECT pc_test.as_user('cpt_b');
SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-own'), pc_test.id('sa_form_own_sig'),
  pc_test.content_of(pc_test.id('sa_form_own_sig')), pc_test.id('p_cpt_b'), pc_test.dakar_today(), NULL);
SELECT pc_test.expect_error(pc_test.sa_confirm_sql('own_sig'), 'PAYABLES_SIGNATORY_NOT_ADMISSIBLE');
SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-dir'), pc_test.id('sa_form_dir_sig'),
  pc_test.content_of(pc_test.id('sa_form_dir_sig')), pc_test.id('p_dirigeant'), pc_test.dakar_today(), NULL);
SELECT pc_test.assert((public.payables_confirm_issuance_v1(pc_test.key('sa-confirm:dir_sig'), pc_test.id('sa_form_dir_sig'),
  pc_test.form_version(pc_test.id('sa_form_dir_sig')), pc_test.dakar_today(), false) ->> 'issuance_id') IS NOT NULL,
  'cheque signed by the sole signatory is issued');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() -> 'capabilities') ?| ARRAY['PARAM_PROPOSE','PARAM_VALIDATE','EXIT_VALIDATE']
  AND (SELECT count(*) FROM public.payables_parameter_versions WHERE kind = 'SIGNATORY'
       AND payload ->> 'person_id' = pc_test.id('p_cpt_b')::text) = 0, 'recording a signature confers no signing power');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Identité personnelle de l'administrateur (contre-revue CTO F1) : distincte
-- de l'autorité, établie par l'opérateur seul, jamais modifiable par lui. Son
-- droit de préparer reste entier, sauf pour un chèque dont il serait le seul
-- signataire admissible ; aucun parcours non confirmable n'atteint l'impression.
-- ---------------------------------------------------------------------------
CREATE TABLE pc_test.sa_counts_before AS
  SELECT (SELECT count(*) FROM public.payables_payments) AS payments,
         (SELECT count(*) FROM public.payables_cheque_forms) AS forms,
         (SELECT count(*) FROM public.payables_print_events) AS prints;
-- Sans identité établie : il administre, mais ne prépare rien (refus avant toute écriture).
SELECT pc_test.as_user('dg');
SELECT pc_test.assert((public.payables_my_access_v1() ->> 'person_id') IS NULL
  AND (public.payables_my_access_v1() ->> 'is_admin')::boolean, 'administrator without an established identity');
SELECT pc_test.put('sa_inv_dg', (public.payables_create_invoice_v1(pc_test.key('sa-inv-dg'), pc_test.id('sa_supplier'),
  'SA-REF-DG-1', 31000, 'XOF', NULL, NULL, 'Original administrateur') ->> 'invoice_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('sa-req-dg-unlinked'),
  pc_test.id('sa_inv_dg'), pc_test.id('acct_ora'), 'ALL_PAYMENTS', NULL, false, 'Bénéficiaire synthétique', 'Sans identité')$$,
  'PAYABLES_PREPARER_NOT_LINKED');
-- Il ne se rattache lui-même ni par l'API ni par la fonction de l'opérateur.
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-self-link'), pc_test.id('p_dirigeant'),
  pc_test.id('dg'), true, 'Se rattacher soi-même')$$, 'PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin_identity(auth.uid(), pc_test.id('p_dirigeant'), true,
  'Auto rattachement applicatif')$$, 'permission denied');
RESET ROLE;
-- Opérateur : seul l'administrateur en fonction est visé ; personne active et libre ; motif exigé.
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin_identity(pc_test.id('cpt_c'), pc_test.id('p_dirigeant'), true,
  'Identity of a non administrator')$$, 'PAYABLES_ADMIN_IDENTITY_TARGET_INVALID');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin_identity(pc_test.id('dg'), pc_test.id('p_cpt_a'), true,
  'Identity already held by an accountant')$$, 'PAYABLES_LINK_CONFLICT');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin_identity(pc_test.id('dg'), gen_random_uuid(), true,
  'Identity on an unknown person')$$, 'PAYABLES_PERSON_NOT_ACTIVE');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin_identity(pc_test.id('dg'), pc_test.id('p_dirigeant'), true,
  'court')$$, 'PAYABLES_REASON_INVALID');
SELECT pc_test.put('sa_dg_identity', payables_private.set_module_admin_identity(pc_test.id('dg'), pc_test.id('p_dirigeant'), true,
  'Synthetic identity of the module administrator'));
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('dg')) = pc_test.id('p_dirigeant'), 'administrator identity established');
SELECT pc_test.assert((SELECT origin = 'OPERATOR' AND proposed_by IS NULL AND decided_by IS NULL AND status = 'VALIDATED'
  AND action = 'LINK' FROM public.payables_person_links WHERE id = pc_test.id('sa_dg_identity')), 'identity link authored by the operator');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events WHERE event_type = 'ADMIN_IDENTITY_LINKED'
  AND aggregate_id = pc_test.id('sa_dg_identity') AND actor_id IS NULL AND metadata ->> 'user_id' = pc_test.id('dg')::text) = 1,
  'identity link journaled');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin_identity(pc_test.id('dg'), pc_test.id('p_dirigeant'), true,
  'Second identity link attempt')$$, 'PAYABLES_LINK_CONFLICT');
SELECT pc_test.expect_error($$UPDATE public.payables_person_links SET person_id = pc_test.id('p_cpt_b')
  WHERE id = pc_test.id('sa_dg_identity')$$, 'PAYABLES_DECIDED_ROW_IMMUTABLE');
-- Défense en profondeur : un rattachement sans auteur n'existe qu'avec l'origine opérateur.
SELECT pc_test.expect_error($$INSERT INTO public.payables_person_links (person_id, user_id, action, status, origin, decided_at,
  decision_seq, reason) VALUES (pc_test.id('p_cpt_a'), pc_test.id('cpt_c'), 'LINK', 'VALIDATED', 'ADMIN', now(),
  nextval('payables_private.decision_seq'), 'Sans auteur')$$, 'payables_person_links_lifecycle');
SELECT pc_test.expect_error($$INSERT INTO public.payables_person_links (person_id, user_id, action, reason)
  VALUES (pc_test.id('p_cpt_a'), pc_test.id('cpt_c'), 'LINK', 'Proposition sans auteur')$$, 'payables_person_links_lifecycle');
-- Identité non réassignable : il ne s'en détache pas, personne d'autre ne la reprend.
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-self-unlink'), pc_test.id('p_dirigeant'),
  pc_test.id('dg'), false, 'Se détacher soi-même')$$, 'PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-take-identity'), pc_test.id('p_dirigeant'),
  pc_test.id('cpt_c'), true, 'Reprendre l''identité du dirigeant')$$, 'PAYABLES_LINK_CONFLICT');
SELECT pc_test.assert((public.payables_my_access_v1() ->> 'person_id')::uuid = pc_test.id('p_dirigeant'),
  'identity visible to the administrator');
-- Arbitrage CTO : sa désignation comme signataire de son propre chef est admise, justifiée et tracée.
SELECT pc_test.assert((SELECT count(*) > 0 AND bool_and(v.origin = 'ADMIN' AND v.decided_by = pc_test.id('dg')
    AND v.evidence_ref IS NOT NULL AND EXISTS (SELECT 1 FROM public.payables_events e WHERE e.aggregate_id = v.id
      AND e.event_type = 'PARAMETER_SET_BY_ADMIN'))
  FROM public.payables_parameter_versions v WHERE v.kind = 'SIGNATORY'
    AND v.payload ->> 'person_id' = (public.payables_my_access_v1() ->> 'person_id')), 'self-designation as signatory is justified and traced');
-- Seul signataire admissible du compte pilote : il ne prépare pas un chèque de ce compte (refus d'emblée).
SELECT pc_test.put('sa_inv_dg_pilot', (public.payables_create_invoice_v1(pc_test.key('sa-inv-dg-pilot'), pc_test.id('sa_supplier'),
  'SA-REF-DG-2', 88000, 'XOF', NULL, NULL, 'Original administrateur pilote') ->> 'invoice_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('sa-req-dg-pilot'),
  pc_test.id('sa_inv_dg_pilot'), pc_test.id('acct_ora_pilot'), 'PILOT_ADMIN', NULL, false, 'Bénéficiaire synthétique',
  'Seul signataire')$$, 'PAYABLES_NO_INDEPENDENT_SIGNATORY');
RESET ROLE;
-- Ailleurs, son droit de préparer reste entier : chèque préparé par lui, signé par un autre signataire, émis.
SELECT pc_test.sa_printed_cheque('dg', 'admin_prep', pc_test.id('sa_supplier'), 31000, '0095000001', 'acct_ora', 'ALL_PAYMENTS');
SELECT pc_test.as_user('cpt_b');
SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-admin'), pc_test.id('sa_form_admin_prep'),
  pc_test.content_of(pc_test.id('sa_form_admin_prep')), pc_test.id('p_dir'), pc_test.dakar_today(), NULL);
SELECT pc_test.assert((public.payables_confirm_issuance_v1(pc_test.key('sa-confirm:admin_prep'), pc_test.id('sa_form_admin_prep'),
  pc_test.form_version(pc_test.id('sa_form_admin_prep')), pc_test.dakar_today(), false) ->> 'issuance_id') IS NOT NULL,
  'cheque prepared by the administrator and signed by another signatory is issued');
-- Sur le compte pilote, il ne devient pas préparateur en cours de route : ni
-- révision, ni intention d'impression, ni déclaration d'un résultat imprimé
-- (il en serait la cause). La formule reste au comptable, rien n'est gâché.
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.put('sa_inv_mid', (public.payables_create_invoice_v1(pc_test.key('sa-inv-mid'), pc_test.id('sa_supplier'),
  'SA-REF-MID', 77000, 'XOF', NULL, NULL, 'Original circuit') ->> 'invoice_id')::uuid);
SELECT pc_test.put('sa_pay_mid', (public.payables_create_cheque_request_v1(pc_test.key('sa-req-mid'), pc_test.id('sa_inv_mid'),
  pc_test.id('acct_ora_pilot'), 'PILOT_ADMIN', NULL, false, 'Bénéficiaire synthétique circuit', 'Paiement circuit')
  ->> 'payment_id')::uuid);
SELECT pc_test.put('sa_form_mid', (public.payables_assign_cheque_form_v1(pc_test.key('sa-assign-mid'), pc_test.id('sa_pay_mid'),
  pc_test.payment_version(pc_test.id('sa_pay_mid')), '0091000010', 'ORA_CHQ_170X95', pc_test.dakar_today()) ->> 'form_id')::uuid);
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_revise_cheque_content_v1(pc_test.key('sa-revise-dg'), pc_test.id('sa_form_mid'),
  pc_test.form_version(pc_test.id('sa_form_mid')), pc_test.dakar_today(), 'Révision par le signataire')$$,
  'PAYABLES_NO_INDEPENDENT_SIGNATORY');
SELECT pc_test.expect_error($$SELECT public.payables_record_print_intent_v1(pc_test.key('sa-intent-dg'), pc_test.id('sa_form_mid'),
  pc_test.form_version(pc_test.id('sa_form_mid')), pc_test.content_of(pc_test.id('sa_form_mid')), 'Impression par le signataire')$$,
  'PAYABLES_NO_INDEPENDENT_SIGNATORY');
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.put('sa_pe_mid', (public.payables_record_print_intent_v1(pc_test.key('sa-intent-mid'), pc_test.id('sa_form_mid'),
  pc_test.form_version(pc_test.id('sa_form_mid')), pc_test.content_of(pc_test.id('sa_form_mid')), 'Impression')
  ->> 'print_event_id')::uuid);
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_record_print_outcome_v1(pc_test.key('sa-outcome-dg'), pc_test.id('sa_pe_mid'),
  'PRINTED', NULL)$$, 'PAYABLES_NO_INDEPENDENT_SIGNATORY');
SELECT pc_test.as_user('cpt_a');
SELECT public.payables_record_print_outcome_v1(pc_test.key('sa-outcome-mid'), pc_test.id('sa_pe_mid'), 'PRINTED', NULL);
SELECT pc_test.as_user('cpt_b');
SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-mid'), pc_test.id('sa_form_mid'),
  pc_test.content_of(pc_test.id('sa_form_mid')), pc_test.id('p_dirigeant'), pc_test.dakar_today(), NULL);
SELECT pc_test.assert((public.payables_confirm_issuance_v1(pc_test.key('sa-confirm:mid'), pc_test.id('sa_form_mid'),
  pc_test.form_version(pc_test.id('sa_form_mid')), pc_test.dakar_today(), false) ->> 'issuance_id') IS NOT NULL,
  'refused steps left the form usable: prepared by the accountant, signed by the sole signatory, issued');
RESET ROLE;
SELECT pc_test.assert((SELECT payments + 2 FROM pc_test.sa_counts_before) = (SELECT count(*) FROM public.payables_payments)
  AND (SELECT forms + 2 FROM pc_test.sa_counts_before) = (SELECT count(*) FROM public.payables_cheque_forms)
  AND (SELECT prints + 2 FROM pc_test.sa_counts_before) = (SELECT count(*) FROM public.payables_print_events),
  'refused preparations wrote nothing: only the two completed cheques were added');

-- Revue indépendante P2-1 : l'identité d'un préparateur ne change pas tant
-- qu'un chèque qu'il a préparé peut encore être confirmé (sinon un nouveau
-- rattachement ferait passer la signature de son ancienne personne).
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-relink-1'), pc_test.id('p_cpt_a'),
  pc_test.id('cpt_a'), false, 'Détacher un préparateur en cours')$$, 'PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-cap:cpt_c:' || c), pc_test.id('cpt_c'), c, true,
  'Préparation sans rattachement') FROM unnest(ARRAY['INVOICE_MANAGE','CHEQUE_PREPARE_PRINT']) c;
SELECT pc_test.put('p_cpt_c', (public.payables_admin_create_person_v1(pc_test.key('sa-person-cpt-c'), 'Comptable C synthétique',
  'Rattachement tardif') ->> 'person_id')::uuid);
RESET ROLE;
-- Contre-revue CTO F1 : un comptable sans rattachement est refusé dès la
-- demande, avant toute formule ; rien ne circule, le rattacher suffit ensuite.
SELECT pc_test.as_user('cpt_c');
SELECT pc_test.put('sa_inv_cpt_c', (public.payables_create_invoice_v1(pc_test.key('sa-inv-cpt-c'), pc_test.id('sa_supplier'),
  'SA-REF-CPT-C', 42000, 'XOF', NULL, NULL, 'Original comptable C') ->> 'invoice_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('sa-req-cpt-c'), pc_test.id('sa_inv_cpt_c'),
  pc_test.id('acct_ora_pilot'), 'PILOT_ADMIN', NULL, false, 'Bénéficiaire synthétique', 'Sans rattachement')$$,
  'PAYABLES_PREPARER_NOT_LINKED');
RESET ROLE;
SELECT pc_test.assert(NOT payables_private.user_prepares_pending_cheque(pc_test.id('cpt_c')), 'the refused request left nothing pending');
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-late-link-2'), pc_test.id('p_cpt_c'), pc_test.id('cpt_c'), true,
  'Rattachement vérifié');
RESET ROLE;
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('cpt_c')) = pc_test.id('p_cpt_c'), 'accountant linked');
SELECT pc_test.sa_printed_cheque('cpt_c', 'linked_prep', pc_test.id('sa_supplier'), 42000, '0091000004');
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-unlink-cpt-c'), pc_test.id('p_cpt_c'),
  pc_test.id('cpt_c'), false, 'Détacher après préparation')$$, 'PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE');
RESET ROLE;

-- Déclarant d'un résultat (une impression en attente compte déjà) : compte à
-- deux signataires ; chacun ne devient préparateur que si l'autre reste
-- admissible, et le chèque se confirme par la voie normale.
INSERT INTO public.daily_statement_account_registry (id, created_by, bank, currency, safe_alias, account_fingerprint)
VALUES ('20000000-0000-4000-8000-0000000000a3', pc_test.id('admin'), 'ORA', 'XOF', 'ORA duo synthétique', repeat('8', 64));
SELECT pc_test.put('acct_ora_duo', '20000000-0000-4000-8000-0000000000a3');
-- Sans règle de signature ni signataire en vigueur, aucune demande n'est ouverte sur ce compte.
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.put('sa_inv_duo', (public.payables_create_invoice_v1(pc_test.key('sa-inv-duo'), pc_test.id('sa_supplier'),
  'SA-REF-DUO', 55000, 'XOF', NULL, NULL, 'Original duo') ->> 'invoice_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('sa-req-duo-norule'), pc_test.id('sa_inv_duo'),
  pc_test.id('acct_ora_duo'), 'PILOT_ADMIN', NULL, false, 'Bénéficiaire synthétique duo', 'Compte non paramétré')$$,
  'PAYABLES_NO_INDEPENDENT_SIGNATORY');
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-duo-rule'), 'SIGNATURE_RULE', pc_test.id('acct_ora_duo')::text,
  pc_test.dakar_today(), jsonb_build_object('account_registry_id', pc_test.id('acct_ora_duo'), 'required_signatures', 1),
  NULL, 0, 'Une signature');
SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-duo-sig:' || p), 'SIGNATORY',
  pc_test.id(p)::text || '|' || pc_test.id('acct_ora_duo')::text, pc_test.dakar_today(),
  jsonb_build_object('person_id', pc_test.id(p), 'account_registry_id', pc_test.id('acct_ora_duo'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')),
  'Pouvoirs bancaires synthétiques', 0, 'Signataire du compte duo')
FROM unnest(ARRAY['p_dirigeant','p_cpt_c']) p;
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.put('sa_pay_duo', (public.payables_create_cheque_request_v1(pc_test.key('sa-req-duo'), pc_test.id('sa_inv_duo'),
  pc_test.id('acct_ora_duo'), 'PILOT_ADMIN', NULL, false, 'Bénéficiaire synthétique duo', 'Paiement duo') ->> 'payment_id')::uuid);
SELECT pc_test.put('sa_form_duo', (public.payables_assign_cheque_form_v1(pc_test.key('sa-assign-duo'), pc_test.id('sa_pay_duo'),
  pc_test.payment_version(pc_test.id('sa_pay_duo')), '0092000001', 'ORA_CHQ_170X95', pc_test.dakar_today()) ->> 'form_id')::uuid);
SELECT pc_test.as_user('dg');
SELECT pc_test.put('sa_pe_duo', (public.payables_record_print_intent_v1(pc_test.key('sa-intent-duo'), pc_test.id('sa_form_duo'),
  pc_test.form_version(pc_test.id('sa_form_duo')), pc_test.content_of(pc_test.id('sa_form_duo')), 'Impression')
  ->> 'print_event_id')::uuid);
-- Revue indépendante (cause passagère) : un instant sans contrôleur habilité,
-- cause étrangère au déclarant, ne masque pas la sienne ; chaque condition est
-- comparée avec et sans lui.
RESET ROLE;
CREATE TABLE pc_test.sa_confirmers AS
  SELECT DISTINCT g.user_id FROM public.payables_capability_grants g
  WHERE g.capability = 'CHEQUE_CONFIRM_ISSUE' AND payables_private.has_capability(g.user_id, 'CHEQUE_CONFIRM_ISSUE');
GRANT SELECT ON pc_test.sa_confirmers TO authenticated;
SELECT pc_test.assert((SELECT count(*) FROM pc_test.sa_confirmers) >= 2, 'several confirmers');
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-confirm-off-duo:' || user_id), user_id, 'CHEQUE_CONFIRM_ISSUE',
  false, 'Retrait temporaire') FROM pc_test.sa_confirmers;
SELECT pc_test.as_user('cpt_c');
SELECT pc_test.expect_error($$SELECT public.payables_record_print_outcome_v1(pc_test.key('sa-outcome-duo-c-tmp'), pc_test.id('sa_pe_duo'),
  'PRINTED', NULL)$$, 'PAYABLES_NO_INDEPENDENT_SIGNATORY');
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-confirm-on-duo:' || user_id), user_id, 'CHEQUE_CONFIRM_ISSUE',
  true, 'Rétablissement') FROM pc_test.sa_confirmers;
SELECT pc_test.as_user('cpt_c');
SELECT pc_test.expect_error($$SELECT public.payables_record_print_outcome_v1(pc_test.key('sa-outcome-duo-c'), pc_test.id('sa_pe_duo'),
  'PRINTED', NULL)$$, 'PAYABLES_NO_INDEPENDENT_SIGNATORY');
SELECT pc_test.as_user('dg');
SELECT public.payables_record_print_outcome_v1(pc_test.key('sa-outcome-duo'), pc_test.id('sa_pe_duo'), 'PRINTED', NULL);
SELECT pc_test.as_user('cpt_b');
SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-duo'), pc_test.id('sa_form_duo'),
  pc_test.content_of(pc_test.id('sa_form_duo')), pc_test.id('p_cpt_c'), pc_test.dakar_today(), NULL);
SELECT pc_test.assert((public.payables_confirm_issuance_v1(pc_test.key('sa-confirm:duo'), pc_test.id('sa_form_duo'),
  pc_test.form_version(pc_test.id('sa_form_duo')), pc_test.dakar_today(), false) ->> 'issuance_id') IS NOT NULL,
  'printed by the administrator, signed by the other signatory, issued');
RESET ROLE;

-- Revue indépendante P1-1 : nul ne contrôle un chèque qu'il a préparé. Même avec
-- une seconde personne qu'il déclarerait signataire, l'administrateur ne mène
-- pas seul un chèque jusqu'à l'émission : il n'enregistre pas les signatures et
-- ne confirme pas ; un compte non rattaché ne contrôle pas non plus.
SELECT pc_test.as_user('dg');
SELECT pc_test.put('p_decoy', (public.payables_admin_create_person_v1(pc_test.key('sa-person-decoy'),
  'Dirigeant suppléant synthétique', 'Seconde personne') ->> 'person_id')::uuid);
SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-decoy-sig'), 'SIGNATORY',
  pc_test.id('p_decoy')::text || '|' || pc_test.id('acct_ora_duo')::text, pc_test.dakar_today(),
  jsonb_build_object('person_id', pc_test.id('p_decoy'), 'account_registry_id', pc_test.id('acct_ora_duo'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')),
  'Pouvoirs synthétiques', 0, 'Seconde personne signataire');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-cap:admin:CHEQUE_CONFIRM_ISSUE'), pc_test.id('admin'),
  'CHEQUE_CONFIRM_ISSUE', true, 'Contrôleur sans rattachement');
RESET ROLE;
SELECT pc_test.sa_printed_cheque('dg', 'decoy', pc_test.id('sa_supplier'), 61000, '0092000002', 'acct_ora_duo', 'PILOT_ADMIN');
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-decoy-dg'), pc_test.id('sa_form_decoy'),
  pc_test.content_of(pc_test.id('sa_form_decoy')), pc_test.id('p_decoy'), pc_test.dakar_today(), NULL)$$,
  'PAYABLES_CONTROLLER_NOT_INDEPENDENT');
SELECT pc_test.as_user('admin');
SELECT pc_test.expect_error($$SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-decoy-admin'), pc_test.id('sa_form_decoy'),
  pc_test.content_of(pc_test.id('sa_form_decoy')), pc_test.id('p_decoy'), pc_test.dakar_today(), NULL)$$,
  'PAYABLES_CONTROLLER_NOT_INDEPENDENT');
SELECT pc_test.as_user('cpt_b');
SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-decoy-b'), pc_test.id('sa_form_decoy'),
  pc_test.content_of(pc_test.id('sa_form_decoy')), pc_test.id('p_decoy'), pc_test.dakar_today(), NULL);
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error(pc_test.sa_confirm_sql('decoy'), 'PAYABLES_CONTROLLER_NOT_INDEPENDENT');
-- Défense en profondeur : une signature d'un préparateur écrite hors API est
-- refusée ; déjà présente (état hérité, simulé ici hors déclencheurs), elle
-- fait refuser la confirmation, même demandée par un autre compte.
RESET ROLE;
SELECT pc_test.expect_error($$INSERT INTO public.payables_signatures (form_id, content_id, person_id, signed_on, recorded_by)
  VALUES (pc_test.id('sa_form_decoy'), pc_test.content_of(pc_test.id('sa_form_decoy')), pc_test.id('p_cpt_c'),
  pc_test.dakar_today(), pc_test.id('dg'))$$, 'PAYABLES_CONTROLLER_NOT_INDEPENDENT');
SET session_replication_role = replica;
INSERT INTO public.payables_signatures (form_id, content_id, person_id, signed_on, recorded_by)
VALUES (pc_test.id('sa_form_decoy'), pc_test.content_of(pc_test.id('sa_form_decoy')), pc_test.id('p_cpt_c'),
  pc_test.dakar_today(), pc_test.id('dg'));
SET session_replication_role = origin;
SELECT pc_test.as_user('cpt_b');
SELECT pc_test.expect_error(pc_test.sa_confirm_sql('decoy'), 'PAYABLES_CONTROLLER_NOT_INDEPENDENT');
RESET ROLE;
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_issuances WHERE form_id = pc_test.id('sa_form_decoy')),
  'a cheque the administrator prepared is never controlled by him');
-- Sans contrôleur indépendant habilité, la préparation est refusée d'emblée.
DELETE FROM pc_test.sa_confirmers;
INSERT INTO pc_test.sa_confirmers
  SELECT DISTINCT g.user_id FROM public.payables_capability_grants g
  WHERE g.capability = 'CHEQUE_CONFIRM_ISSUE' AND payables_private.has_capability(g.user_id, 'CHEQUE_CONFIRM_ISSUE');
SELECT pc_test.assert((SELECT count(*) FROM pc_test.sa_confirmers) >= 2, 'several confirmers before the check');
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-confirm-off:' || user_id), user_id, 'CHEQUE_CONFIRM_ISSUE', false,
  'Retrait temporaire') FROM pc_test.sa_confirmers;
SELECT pc_test.put('sa_inv_noctl', (public.payables_create_invoice_v1(pc_test.key('sa-inv-noctl'), pc_test.id('sa_supplier'),
  'SA-REF-NOCTL', 14000, 'XOF', NULL, NULL, 'Original sans contrôleur') ->> 'invoice_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_create_cheque_request_v1(pc_test.key('sa-req-noctl'), pc_test.id('sa_inv_noctl'),
  pc_test.id('acct_ora_duo'), 'PILOT_ADMIN', NULL, false, 'Bénéficiaire synthétique', 'Sans contrôleur')$$,
  'PAYABLES_NO_INDEPENDENT_CONTROLLER');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-confirm-on:' || user_id), user_id, 'CHEQUE_CONFIRM_ISSUE', true,
  'Rétablissement') FROM pc_test.sa_confirmers;
-- Formule de l'essai : déclarée inutilisée, demande abandonnée ; plus rien ne circule pour l'administrateur.
SELECT public.payables_record_unused_form_v1(pc_test.key('sa-unused-decoy'), pc_test.id('sa_form_decoy'),
  pc_test.form_version(pc_test.id('sa_form_decoy')), 'Essai de contrôle');
RESET ROLE;
SELECT pc_test.put('sa_pay_decoy', (SELECT payment_id FROM public.payables_cheque_forms WHERE id = pc_test.id('sa_form_decoy')));
SELECT pc_test.as_user('dg');
SELECT public.payables_abandon_payment_v1(pc_test.key('sa-abandon-decoy'), pc_test.id('sa_pay_decoy'),
  pc_test.payment_version(pc_test.id('sa_pay_decoy')), 'Essai de contrôle');
RESET ROLE;

-- Revue indépendante P2-1 : un résultat d'impression est un fait et s'enregistre,
-- refusé seulement à un déclarant qui en serait la cause. Incertain : le seul
-- signataire n'en devient pas déclarant (le chèque ne serait plus confirmable
-- si la formule est retrouvée imprimée) ; le demandeur de l'impression le
-- déclare, une autre personne l'instruit, et le chèque retrouvé imprimé se
-- confirme normalement.
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-cap:cpt_b:EXCEPTION_INSTRUCT'), pc_test.id('cpt_b'),
  'EXCEPTION_INSTRUCT', true, 'Instruction des exceptions');
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.put('sa_inv_unc', (public.payables_create_invoice_v1(pc_test.key('sa-inv-unc'), pc_test.id('sa_supplier'),
  'SA-REF-UNC', 33000, 'XOF', NULL, NULL, 'Original incertain') ->> 'invoice_id')::uuid);
SELECT pc_test.put('sa_pay_unc', (public.payables_create_cheque_request_v1(pc_test.key('sa-req-unc'), pc_test.id('sa_inv_unc'),
  pc_test.id('acct_ora_pilot'), 'PILOT_ADMIN', NULL, false, 'Bénéficiaire synthétique incertain', 'Paiement incertain')
  ->> 'payment_id')::uuid);
SELECT pc_test.put('sa_form_unc', (public.payables_assign_cheque_form_v1(pc_test.key('sa-assign-unc'), pc_test.id('sa_pay_unc'),
  pc_test.payment_version(pc_test.id('sa_pay_unc')), '0091000011', 'ORA_CHQ_170X95', pc_test.dakar_today()) ->> 'form_id')::uuid);
SELECT pc_test.put('sa_pe_unc', (public.payables_record_print_intent_v1(pc_test.key('sa-intent-unc'), pc_test.id('sa_form_unc'),
  pc_test.form_version(pc_test.id('sa_form_unc')), pc_test.content_of(pc_test.id('sa_form_unc')), 'Impression')
  ->> 'print_event_id')::uuid);
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_record_print_outcome_v1(pc_test.key('sa-outcome-unc-dg'), pc_test.id('sa_pe_unc'),
  'UNCERTAIN', 'Imprimante muette')$$, 'PAYABLES_NO_INDEPENDENT_SIGNATORY');
SELECT pc_test.as_user('cpt_a');
SELECT public.payables_record_print_outcome_v1(pc_test.key('sa-outcome-unc'), pc_test.id('sa_pe_unc'), 'UNCERTAIN', 'Imprimante muette');
SELECT pc_test.as_user('cpt_b');
SELECT public.payables_resolve_exception_v1(pc_test.key('sa-unc-res'),
  (SELECT id FROM public.payables_exceptions WHERE form_id = pc_test.id('sa_form_unc') AND kind = 'FORM_PRINT_UNCERTAIN'), 1,
  'FOUND_PRINTED', NULL, 'Formule retrouvée imprimée', 'Formule retrouvée imprimée dans le bac');
SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-unc'), pc_test.id('sa_form_unc'),
  pc_test.content_of(pc_test.id('sa_form_unc')), pc_test.id('p_dirigeant'), pc_test.dakar_today(), NULL);
SELECT pc_test.assert((public.payables_confirm_issuance_v1(pc_test.key('sa-confirm-unc'), pc_test.id('sa_form_unc'),
  pc_test.form_version(pc_test.id('sa_form_unc')), pc_test.dakar_today(), false) ->> 'issuance_id') IS NOT NULL,
  'an uncertain print found printed is confirmed by the normal path');
RESET ROLE;
-- Imprimé : un paramètre changé entre l'intention et le résultat n'empêche pas
-- d'enregistrer le fait ; la confirmation le refuse et la formule imprimée
-- n'est jamais libérée.
INSERT INTO public.daily_statement_account_registry (id, created_by, bank, currency, safe_alias, account_fingerprint)
VALUES ('20000000-0000-4000-8000-0000000000a4', pc_test.id('admin'), 'ORA', 'XOF', 'ORA revue synthétique', repeat('7', 64));
SELECT pc_test.put('acct_ora_rev', '20000000-0000-4000-8000-0000000000a4');
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-rev-rule'), 'SIGNATURE_RULE', pc_test.id('acct_ora_rev')::text,
  pc_test.dakar_today() - 1, jsonb_build_object('account_registry_id', pc_test.id('acct_ora_rev'), 'required_signatures', 1),
  NULL, 0, 'Une signature');
SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-rev-sig-v1'), 'SIGNATORY',
  pc_test.id('p_dirigeant')::text || '|' || pc_test.id('acct_ora_rev')::text, pc_test.dakar_today() - 1,
  jsonb_build_object('person_id', pc_test.id('p_dirigeant'), 'account_registry_id', pc_test.id('acct_ora_rev'), 'state', 'ACTIVE',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')),
  'Pouvoirs bancaires synthétiques', 0, 'Signataire');
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.put('sa_inv_rev', (public.payables_create_invoice_v1(pc_test.key('sa-inv-rev'), pc_test.id('sa_supplier'),
  'SA-REF-REV', 45000, 'XOF', NULL, NULL, 'Original revue') ->> 'invoice_id')::uuid);
SELECT pc_test.put('sa_pay_rev', (public.payables_create_cheque_request_v1(pc_test.key('sa-req-rev'), pc_test.id('sa_inv_rev'),
  pc_test.id('acct_ora_rev'), 'PILOT_ADMIN', NULL, false, 'Bénéficiaire synthétique revue', 'Paiement revue') ->> 'payment_id')::uuid);
SELECT pc_test.put('sa_form_rev', (public.payables_assign_cheque_form_v1(pc_test.key('sa-assign-rev'), pc_test.id('sa_pay_rev'),
  pc_test.payment_version(pc_test.id('sa_pay_rev')), '0093000001', 'ORA_CHQ_170X95', pc_test.dakar_today()) ->> 'form_id')::uuid);
SELECT pc_test.put('sa_pe_rev', (public.payables_record_print_intent_v1(pc_test.key('sa-intent-rev'), pc_test.id('sa_form_rev'),
  pc_test.form_version(pc_test.id('sa_form_rev')), pc_test.content_of(pc_test.id('sa_form_rev')), 'Impression')
  ->> 'print_event_id')::uuid);
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-rev-sig-v2'), 'SIGNATORY',
  pc_test.id('p_dirigeant')::text || '|' || pc_test.id('acct_ora_rev')::text, pc_test.dakar_today(),
  jsonb_build_object('person_id', pc_test.id('p_dirigeant'), 'account_registry_id', pc_test.id('acct_ora_rev'), 'state', 'SUSPENDED',
    'categories', jsonb_build_array('*'), 'ceiling', jsonb_build_object('kind', 'UNLIMITED')),
  'Suspension synthétique', 1, 'Pouvoirs suspendus');
SELECT pc_test.as_user('cpt_a');
SELECT public.payables_record_print_outcome_v1(pc_test.key('sa-outcome-rev'), pc_test.id('sa_pe_rev'), 'PRINTED', NULL);
SELECT pc_test.as_user('cpt_b');
SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-rev'), pc_test.id('sa_form_rev'),
  pc_test.content_of(pc_test.id('sa_form_rev')), pc_test.id('p_dirigeant'), pc_test.dakar_today(), NULL);
SELECT pc_test.expect_error(pc_test.sa_confirm_sql('rev'), 'PAYABLES_SIGNATORY_NOT_ADMISSIBLE');
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.expect_error($$SELECT public.payables_abandon_payment_v1(pc_test.key('sa-abandon-rev'), pc_test.id('sa_pay_rev'),
  pc_test.payment_version(pc_test.id('sa_pay_rev')), 'Abandon après impression')$$, 'PAYABLES_RELEASE_FORBIDDEN_FORM_UNCERTAIN');
RESET ROLE;
SELECT pc_test.assert((SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('sa_form_rev')) = 'PRINTED'
  AND (SELECT status FROM public.payables_allocations WHERE payment_id = pc_test.id('sa_pay_rev')) = 'RESERVED',
  'a printed cheque is recorded as printed and keeps its reservation');

-- Revue indépendante P2-A : le contrôle indépendant ne vise que la confirmation
-- initiale. Une correction de date reste la décision de sortie d'un autre
-- acteur que le demandeur (règle inchangée), y compris quand il a préparé le chèque.
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.put('sa_inv_corr', (public.payables_create_invoice_v1(pc_test.key('sa-inv-corr'), pc_test.id('sa_supplier'),
  'SA-REF-CORR', 26000, 'XOF', NULL, NULL, 'Original correction') ->> 'invoice_id')::uuid);
SELECT pc_test.put('sa_pay_corr', (public.payables_create_cheque_request_v1(pc_test.key('sa-req-corr'), pc_test.id('sa_inv_corr'),
  pc_test.id('acct_ora'), 'ALL_PAYMENTS', NULL, false, 'Bénéficiaire synthétique correction', 'Paiement correction')
  ->> 'payment_id')::uuid);
SELECT pc_test.put('sa_form_corr', (public.payables_assign_cheque_form_v1(pc_test.key('sa-assign-corr'), pc_test.id('sa_pay_corr'),
  pc_test.payment_version(pc_test.id('sa_pay_corr')), '0095000002', 'ORA_CHQ_170X95', pc_test.dakar_today() - 2) ->> 'form_id')::uuid);
SELECT public.payables_record_print_outcome_v1(pc_test.key('sa-outcome-corr'),
  (public.payables_record_print_intent_v1(pc_test.key('sa-intent-corr'), pc_test.id('sa_form_corr'),
   pc_test.form_version(pc_test.id('sa_form_corr')), pc_test.content_of(pc_test.id('sa_form_corr')), 'Impression')
   ->> 'print_event_id')::uuid, 'PRINTED', NULL);
RESET ROLE;
SELECT pc_test.backdate_prints(pc_test.dakar_today() - 2, pc_test.id('sa_form_corr'));
SELECT pc_test.as_user('cpt_b');
SELECT public.payables_record_signature_v1(pc_test.key('sa-sign-corr'), pc_test.id('sa_form_corr'),
  pc_test.content_of(pc_test.id('sa_form_corr')), pc_test.id('p_dir'), pc_test.dakar_today() - 2, NULL);
SELECT public.payables_confirm_issuance_v1(pc_test.key('sa-confirm-corr'), pc_test.id('sa_form_corr'),
  pc_test.form_version(pc_test.id('sa_form_corr')), pc_test.dakar_today() - 2, false);
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-cap:cpt_a:EXIT_VALIDATE'), pc_test.id('cpt_a'), 'EXIT_VALIDATE', true,
  'Validation des sorties');
SELECT pc_test.put('sa_exit_corr', (public.payables_request_exit_v1(pc_test.key('sa-exit-corr'), pc_test.id('sa_form_corr'),
  pc_test.form_version(pc_test.id('sa_form_corr')), 'CORRECTION', jsonb_build_object('issue_date', pc_test.dakar_today() - 1),
  'Talon du chéquier', 'Date réelle d''émission') ->> 'exit_id')::uuid);
SELECT pc_test.as_user('cpt_a');
SELECT public.payables_validate_exit_v1(pc_test.key('sa-exit-corr-ok'), pc_test.id('sa_exit_corr'),
  pc_test.exit_version(pc_test.id('sa_exit_corr')), true, 'Correction validée');
RESET ROLE;
SELECT pc_test.assert((SELECT count(*) = 2 AND max(revision_no) = 2 FROM public.payables_issuances
  WHERE form_id = pc_test.id('sa_form_corr')), 'a date correction validated by another actor adds its revision');

-- L'opérateur ne retire pas l'identité de l'administrateur tant qu'un chèque
-- qu'il a préparé circule : course 95c–95d (rien ne circule encore ici).
SELECT pc_test.assert(NOT payables_private.user_prepares_pending_cheque(pc_test.id('dg')), 'administrator prepares nothing pending');

-- Propositions héritées de chaque type : closes par l'administrateur, sauf les siennes.
INSERT INTO public.payables_persons (display_name, proposed_by, reason)
VALUES ('Personne héritée en attente', pc_test.id('acc1'), 'Ancienne proposition');
SELECT pc_test.put('legacy_person', (SELECT id FROM public.payables_persons WHERE display_name = 'Personne héritée en attente'));
INSERT INTO public.payables_person_links (person_id, user_id, action, proposed_by, reason)
VALUES (pc_test.id('p_dirigeant'), pc_test.id('dg_next'), 'LINK', pc_test.id('acc2'), 'Ancienne proposition');
SELECT pc_test.put('legacy_link', (SELECT id FROM public.payables_person_links WHERE user_id = pc_test.id('dg_next') AND status = 'PROPOSED'));
INSERT INTO public.payables_capability_grants (user_id, capability, action, proposed_by, reason)
VALUES (pc_test.id('cpt_a'), 'AUDIT', 'GRANT', pc_test.id('dg'), 'Ancienne proposition de l''administrateur');
SELECT pc_test.put('legacy_own', (SELECT id FROM public.payables_capability_grants WHERE user_id = pc_test.id('cpt_a')
  AND capability = 'AUDIT' AND status = 'PROPOSED'));
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_reject_legacy_proposal_v1(pc_test.key('sa-close-person'), 'PERSON', pc_test.id('legacy_person'),
  'Proposition héritée close');
SELECT public.payables_admin_reject_legacy_proposal_v1(pc_test.key('sa-close-link'), 'PERSON_LINK', pc_test.id('legacy_link'),
  'Proposition héritée close');
SELECT pc_test.expect_error($$SELECT public.payables_admin_reject_legacy_proposal_v1(pc_test.key('sa-close-own'), 'CAPABILITY',
  pc_test.id('legacy_own'), 'Sa propre proposition')$$, 'PAYABLES_LEGACY_PROPOSAL_OWN');
RESET ROLE;
SELECT pc_test.assert((SELECT status = 'REJECTED' AND decided_by = pc_test.id('dg') FROM public.payables_persons
  WHERE id = pc_test.id('legacy_person')) AND (SELECT status = 'REJECTED' FROM public.payables_person_links
  WHERE id = pc_test.id('legacy_link')) AND (SELECT status = 'PROPOSED' FROM public.payables_capability_grants
  WHERE id = pc_test.id('legacy_own')), 'legacy proposals closed, own proposal left without effect');
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('dg_next')) IS NULL
  AND NOT payables_private.has_capability(pc_test.id('cpt_a'), 'AUDIT'), 'closed or own proposals confer nothing');

-- ---------------------------------------------------------------------------
-- 6. Chaque décision administrative est tracée ; journal et versions immuables.
-- ---------------------------------------------------------------------------
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_capability_grants g WHERE g.origin = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM public.payables_events e WHERE e.aggregate_id = g.id AND e.actor_id = g.decided_by
    AND e.event_type IN ('CAPABILITY_GRANTED_BY_ADMIN','CAPABILITY_REVOKED_BY_ADMIN'))), 'every admin grant decision journaled');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_persons p WHERE p.origin = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM public.payables_events e WHERE e.aggregate_id = p.id AND e.actor_id = p.decided_by
    AND e.event_type = 'PERSON_CREATED_BY_ADMIN')), 'every admin person creation journaled');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_person_links l WHERE l.origin = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM public.payables_events e WHERE e.aggregate_id = l.id AND e.actor_id = l.decided_by
    AND e.event_type IN ('PERSON_LINKED_BY_ADMIN','PERSON_UNLINKED_BY_ADMIN'))), 'every admin link decision journaled');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_parameter_versions v WHERE v.origin = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM public.payables_events e WHERE e.aggregate_id = v.id AND e.actor_id = v.decided_by
    AND e.event_type = 'PARAMETER_SET_BY_ADMIN')), 'every admin parameter version journaled');
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_events
  WHERE metadata::text ~* '(cheque_number|beneficiary|iban|description|display_name|email)'), 'journal carries no name or e-mail');
SELECT pc_test.expect_error($$UPDATE public.payables_capability_grants SET reason = 'réécriture' WHERE origin = 'ADMIN'$$,
  'PAYABLES_DECIDED_ROW_IMMUTABLE');
SELECT pc_test.expect_error($$UPDATE public.payables_persons SET display_name = 'Renommée' WHERE origin = 'ADMIN'$$,
  'PAYABLES_DECIDED_ROW_IMMUTABLE');
SELECT pc_test.expect_error($$UPDATE public.payables_parameter_versions SET payload = '{}'::jsonb WHERE origin = 'ADMIN'$$,
  'PAYABLES_DECIDED_ROW_IMMUTABLE');
SELECT pc_test.expect_error($$DELETE FROM public.payables_person_links$$, 'PAYABLES_DELETE_FORBIDDEN');
SELECT pc_test.expect_error($$UPDATE public.payables_events SET reason = 'réécriture'$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$UPDATE payables_private.admin_authority_events SET safe_reason = 'réécriture'$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$DELETE FROM payables_private.admin_authority_events$$, 'PAYABLES_APPEND_ONLY');
SELECT pc_test.expect_error($$DELETE FROM payables_private.admin_authority$$, 'PAYABLES_ADMIN_AUTHORITY_DELETE_FORBIDDEN');
SELECT pc_test.expect_error($$TRUNCATE payables_private.admin_authority$$, 'PAYABLES_ADMIN_AUTHORITY_DELETE_FORBIDDEN');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin(pc_test.id('dg'), pc_test.id('dg'), 'Same administrator again')$$,
  'PAYABLES_ADMIN_AUTHORITY_UNCHANGED');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin(pc_test.id('dg'), pc_test.id('dg_next'), 'court')$$,
  'PAYABLES_REASON_INVALID');
SELECT pc_test.expect_error($$UPDATE payables_private.admin_authority SET admin_user_id = pc_test.id('dg_next')$$,
  'PAYABLES_ADMIN_AUTHORITY_NEW_SAFE_REASON_REQUIRED');

-- ---------------------------------------------------------------------------
-- 8. Appels rejoués et modifications concurrentes maîtrisés.
-- ---------------------------------------------------------------------------
SELECT pc_test.as_user('dg');
SELECT pc_test.assert((public.payables_admin_set_capability_v1(pc_test.key('sa-cap:cpt_b:READ'), pc_test.id('cpt_b'), 'READ', true,
  'Rôle opérationnel') ->> 'replayed')::boolean, 'identical replay returns the stored result');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-cap:cpt_b:READ'), pc_test.id('cpt_b'),
  'READ', true, 'Contenu modifié')$$, 'PAYABLES_IDEMPOTENCY_PAYLOAD_MISMATCH');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-cap-again'), pc_test.id('cpt_b'),
  'READ', true, 'Déjà attribuée')$$, 'PAYABLES_CAPABILITY_UNCHANGED');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-cat-stale'), 'CATEGORY', 'PILOT_ADMIN',
  pc_test.dakar_today() + 1, jsonb_build_object('code', 'PILOT_ADMIN', 'label', 'Version concurrente', 'state', 'ACTIVE'), NULL, 0,
  'Version périmée')$$, 'PAYABLES_STALE_VERSION');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_parameter_v1(pc_test.key('sa-cat-overlap'), 'CATEGORY', 'PILOT_ADMIN',
  pc_test.dakar_today(), jsonb_build_object('code', 'PILOT_ADMIN', 'label', 'Même date', 'state', 'ACTIVE'), NULL, 1,
  'Même date d''effet')$$, 'PAYABLES_VALIDITY_OVERLAP');
SELECT pc_test.assert((public.payables_admin_set_parameter_v1(pc_test.key('sa-cat-v2'), 'CATEGORY', 'PILOT_ADMIN',
  pc_test.dakar_today() + 1, jsonb_build_object('code', 'PILOT_ADMIN', 'label', 'Pilote administrateur v2', 'state', 'ACTIVE'),
  NULL, 1, 'Nouvelle version') ->> 'version_no')::integer = 2, 'new version on top of the known one');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-link-conflict'), pc_test.id('p_dirigeant'),
  pc_test.id('cpt_b'), true, 'Second rattachement')$$, 'PAYABLES_LINK_CONFLICT');
SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-unlink-b'), pc_test.id('p_cpt_b'), pc_test.id('cpt_b'), false,
  'Retrait du rattachement');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-unlink-b2'), pc_test.id('p_cpt_b'),
  pc_test.id('cpt_b'), false, 'Second retrait')$$, 'PAYABLES_LINK_STATE_INVALID');
SELECT public.payables_admin_set_person_link_v1(pc_test.key('sa-relink-b'), pc_test.id('p_cpt_b'), pc_test.id('cpt_b'), true,
  'Nouveau rattachement');
SELECT pc_test.expect_error($$SELECT public.payables_admin_create_person_v1(pc_test.key('sa-person-dup'), '  COMPTABLE a synthetique ',
  'Doublon')$$, 'PAYABLES_PERSON_DUPLICATE');
SELECT pc_test.expect_error($$SELECT public.payables_admin_reject_legacy_proposal_v1(pc_test.key('sa-legacy-none'), 'PERSON',
  gen_random_uuid(), 'Inconnue')$$, 'PAYABLES_PROPOSAL_STATE_INVALID');
RESET ROLE;
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('cpt_b')) = pc_test.id('p_cpt_b'), 'relink effective');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_capability_grants WHERE user_id = pc_test.id('cpt_b')
  AND capability = 'READ' AND origin = 'ADMIN') = 1, 'replay created no second decision');

-- Préparatifs de la course « rattachement pendant une préparation » (95a–95b).
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.put('sa_inv_race', (public.payables_create_invoice_v1(pc_test.key('sa-inv-race'), pc_test.id('sa_supplier'),
  'SA-REF-RACE-LINK', 64000, 'XOF', NULL, NULL, 'Original course rattachement') ->> 'invoice_id')::uuid);
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_set_capability_v1(pc_test.key('sa-cap:cpt_b:CHEQUE_PREPARE_PRINT'), pc_test.id('cpt_b'),
  'CHEQUE_PREPARE_PRINT', true, 'Préparation pour la course');
RESET ROLE;
SELECT pc_test.assert(NOT payables_private.user_prepares_pending_cheque(pc_test.id('cpt_b')), 'cpt_b prepares nothing yet');

SELECT 'PASS 90_single_admin' AS marker;
