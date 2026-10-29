-- Mise à niveau d'un domaine installé avec l'ancienne gouvernance (test 9),
-- neutralisation des capacités PARAM_* (test 3) et clôture des propositions
-- héritées. Rôle postgres sauf mention.

-- 1. Données, historique et objets hors gouvernance conservés à l'identique.
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pc_test.upgrade_snapshot s LEFT JOIN pc_test.upgrade_digest() d USING (item)
  WHERE d.item IS NULL OR s.rows <> d.rows OR s.digest <> d.digest),
  'upgrade keeps every row, the history and every non-governance definition');
-- Seuls apparaissent les objets du modèle administrateur unique.
SELECT pc_test.assert(NOT EXISTS (
  SELECT 1 FROM pc_test.upgrade_digest() d WHERE NOT EXISTS (SELECT 1 FROM pc_test.upgrade_snapshot s WHERE s.item = d.item)
    AND d.item !~ '^function:(payables_private\.(set_module_admin|require_admin|prepare_admin_authority_change|append_admin_authority_event|user_prepares_pending_cheque|identity_change_frozen|set_module_admin_identity|cheque_preparers|controller_independent|cheque_confirmability_issues|assert_cheque_confirmable|precheck_cheque_request|precheck_cheque_content|precheck_print_event|check_cheque_controller)|payables_admin_(set_capability|create_person|set_person_link|set_parameter|reject_legacy_proposal)_v1)\('
    AND d.item !~ '^trigger:admin_authority(_events)?\.payables_admin_authority_'
    AND d.item !~ '^trigger:(payables_payments\.payables_payments_precheck_request|payables_cheque_contents\.payables_cheque_contents_precheck|payables_print_events\.payables_print_events_precheck_(intent|outcome)|payables_signatures\.payables_signatures_controller|payables_issuances\.payables_issuances_controller)$'
    AND d.item !~ '^constraint:admin_authority(_events)?\.'
    AND d.item !~ '^constraint:payables_(persons|person_links|parameter_versions)\.payables_(persons|person_links|parameter_versions)_origin_check$'),
  'only single-admin objects are new');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_persons WHERE origin <> 'PROPOSAL') = 0
  AND (SELECT count(*) FROM public.payables_parameter_versions WHERE origin <> 'PROPOSAL') = 0
  AND (SELECT count(*) FROM public.payables_capability_grants WHERE origin = 'ADMIN') = 0,
  'existing decisions keep their origin');

-- 2. Anciennes capacités de gouvernance : plus aucun effet (test 3).
SELECT pc_test.assert(EXISTS (SELECT 1 FROM public.payables_capability_grants
  WHERE capability IN ('PARAM_PROPOSE','PARAM_VALIDATE') AND status = 'VALIDATED'), 'legacy governance grants are kept as history');
SELECT pc_test.assert(NOT payables_private.has_capability(u, c), 'retired capability ' || c || ' has no effect')
FROM unnest(ARRAY[pc_test.id('gov_a'), pc_test.id('gov_b'), pc_test.id('acc4')]) u,
     unnest(ARRAY['PARAM_PROPOSE','PARAM_VALIDATE']) c;
-- Les capacités de travail déjà validées restent effectives (l'administrateur pourra les retirer).
SELECT pc_test.assert(payables_private.has_capability(pc_test.id('acc1'), 'READ')
  AND payables_private.has_capability(pc_test.id('acc2'), 'CHEQUE_CONFIRM_ISSUE'), 'working grants are preserved');
SELECT pc_test.as_user('gov_a');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() -> 'capabilities') ?| ARRAY['PARAM_PROPOSE','PARAM_VALIDATE']
  AND NOT (public.payables_my_access_v1() ->> 'is_admin')::boolean, 'former governor holds no governance capability');
SELECT pc_test.expect_error($$SELECT public.payables_propose_capability_v1(pc_test.key('up-1'), pc_test.id('acc4'), 'READ',
  'GRANT', 'Ancien gouverneur')$$, 'PAYABLES_LEGACY_GOVERNANCE_DISABLED');
SELECT pc_test.expect_error($$SELECT public.payables_propose_parameter_v1(pc_test.key('up-2'), 'CATEGORY', 'NEW_CAT',
  DATE '2026-11-01', jsonb_build_object('code', 'NEW_CAT', 'label', 'Nouvelle', 'state', 'ACTIVE'), NULL, 'Ancien gouverneur')$$,
  'PAYABLES_LEGACY_GOVERNANCE_DISABLED');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('up-3'), pc_test.id('acc4'), 'READ',
  true, 'Ancien gouverneur')$$, 'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.as_user('gov_b');
SELECT pc_test.expect_error($$SELECT public.payables_decide_parameter_v1(pc_test.key('up-4'), pc_test.id('sig_gova'), true,
  'Ancienne validation')$$, 'PAYABLES_LEGACY_GOVERNANCE_DISABLED');
SELECT pc_test.as_user('acc4');
SELECT pc_test.expect_error($$SELECT public.payables_decide_capability_v1(pc_test.key('up-5'), pc_test.id('cap_gova_audit'), true,
  'Ancien valideur')$$, 'PAYABLES_LEGACY_GOVERNANCE_DISABLED');
RESET ROLE;
SELECT pc_test.expect_error($$SELECT payables_private.bootstrap_parameter_governance(pc_test.id('acc1'), pc_test.id('acc2'),
  'Ancien amorçage')$$, 'PAYABLES_LEGACY_GOVERNANCE_DISABLED');
SELECT pc_test.assert((SELECT admin_user_id IS NULL FROM payables_private.admin_authority), 'upgrade designates nobody');

-- 3. Désignation opérateur de l'administrateur. L'autorité ne dépend pas de
-- l'identité (contre-revue CTO F1) : un ancien gouverneur rattaché par
-- l'ancienne gouvernance à deux acteurs est désignable, garde cette identité
-- établie par d'autres et ne la modifie pas lui-même.
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('gov_a')) = pc_test.id('p_gova'), 'former governor is linked');
SELECT payables_private.set_module_admin(NULL, pc_test.id('gov_a'), 'Synthetic designation of a linked governor');
SELECT pc_test.as_user('gov_a');
SELECT pc_test.assert((public.payables_my_access_v1() ->> 'is_admin')::boolean
  AND (public.payables_my_access_v1() ->> 'person_id')::uuid = pc_test.id('p_gova'), 'linked designee keeps his established identity');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('up-self-unlink'), pc_test.id('p_gova'),
  pc_test.id('gov_a'), false, 'Se détacher soi-même')$$, 'PAYABLES_ADMIN_SELF_TARGET_FORBIDDEN');
RESET ROLE;
SELECT payables_private.set_module_admin(pc_test.id('gov_a'), NULL, 'Synthetic withdrawal of the linked governor');
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('gov_a')) = pc_test.id('p_gova'), 'authority changes never touch identity');
SELECT payables_private.set_module_admin(NULL, pc_test.id('dg'), 'Synthetic designation of the module administrator');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events WHERE event_type = 'ADMIN_AUTHORITY_CHANGED') = 3,
  'designations and withdrawal journaled');

-- 4. Propositions héritées en attente : closes par l'administrateur, motif conservé.
SELECT pc_test.as_user('dg');
SELECT public.payables_admin_reject_legacy_proposal_v1(pc_test.key('up-close-1'), 'CAPABILITY', pc_test.id('cap_gova_audit'),
  'Proposition héritée close');
SELECT public.payables_admin_reject_legacy_proposal_v1(pc_test.key('up-close-2'), 'PARAMETER', pc_test.id('sig_gova'),
  'Proposition héritée close');
SELECT pc_test.expect_error($$SELECT public.payables_admin_reject_legacy_proposal_v1(pc_test.key('up-close-3'), 'PARAMETER',
  pc_test.id('sig_gova'), 'Deuxième clôture')$$, 'PAYABLES_PROPOSAL_STATE_INVALID');
SELECT pc_test.expect_error($$SELECT public.payables_admin_reject_legacy_proposal_v1(pc_test.key('up-close-4'), 'SUPPLIER',
  pc_test.id('sig_gova'), 'Type inconnu')$$, 'PAYABLES_LEGACY_PROPOSAL_KIND_INVALID');
RESET ROLE;
SELECT pc_test.assert((SELECT status = 'REJECTED' AND decided_by = pc_test.id('dg') AND origin = 'PROPOSAL'
  FROM public.payables_capability_grants WHERE id = pc_test.id('cap_gova_audit')), 'legacy capability proposal closed');
SELECT pc_test.assert((SELECT status = 'REJECTED' AND decided_by = pc_test.id('dg')
  FROM public.payables_parameter_versions WHERE id = pc_test.id('sig_gova')), 'legacy parameter proposal closed');
SELECT pc_test.assert(NOT payables_private.has_capability(pc_test.id('gov_a'), 'AUDIT'), 'closing a proposal grants nothing');
SELECT pc_test.assert(payables_private.effective_parameter('SIGNATORY',
  pc_test.id('p_gova')::text || '|' || pc_test.id('acct_ora')::text, DATE '2026-12-31') IS NULL, 'closing a proposal validates nothing');

-- 5. Préparateurs hérités (contre-revue CTO F1 ; revue indépendante P2-1, P3-4).
-- Un compte jamais rattaché dont le chèque imprimé n'a encore aucune signature
-- reçoit une première identité, figée ensuite, et le chèque se confirme
-- normalement. L'identité n'est jamais choisie au vu des signataires : un compte
-- jamais rattaché dont le chèque porte déjà une signature n'en reçoit pas. Un
-- compte qui a déjà eu une identité n'en reçoit ni une autre ni l'ancienne tant
-- que son chèque circule ; le résultat réel de son impression reste
-- enregistrable par un autre préparateur.
SELECT pc_test.assert(NOT EXISTS (SELECT 1 FROM public.payables_person_links WHERE user_id IN (pc_test.id('acc4'), pc_test.id('cpt_e')))
  AND payables_private.user_prepares_pending_cheque(pc_test.id('acc4'))
  AND payables_private.user_prepares_pending_cheque(pc_test.id('cpt_e'))
  AND EXISTS (SELECT 1 FROM public.payables_signatures WHERE form_id = pc_test.id('form_pay_unlinked')),
  'legacy never-linked preparers with printed cheques, one already signed');
SELECT pc_test.as_user('dg');
SELECT pc_test.put('p_cpt_e', (public.payables_admin_create_person_v1(pc_test.key('up-person-cpt-e'), 'Comptable E synthétique',
  'Identité vérifiée') ->> 'person_id')::uuid);
SELECT public.payables_admin_set_person_link_v1(pc_test.key('up-link-cpt-e'), pc_test.id('p_cpt_e'), pc_test.id('cpt_e'), true,
  'Première identité du préparateur');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('up-unlink-cpt-e'), pc_test.id('p_cpt_e'),
  pc_test.id('cpt_e'), false, 'Détacher après coup')$$, 'PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE');
SELECT pc_test.put('p_acc4', (public.payables_admin_create_person_v1(pc_test.key('up-person-acc4'), 'Comptable synthétique 4',
  'Identité vérifiée') ->> 'person_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('up-link-acc4'), pc_test.id('p_acc4'),
  pc_test.id('acc4'), true, 'Identité après signature')$$, 'PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE');
SELECT pc_test.put('p_cpt_d_bis', (public.payables_admin_create_person_v1(pc_test.key('up-person-cpt-d'), 'Comptable D bis synthétique',
  'Autre identité') ->> 'person_id')::uuid);
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('up-link-cpt-d'), pc_test.id('p_cpt_d_bis'),
  pc_test.id('cpt_d'), true, 'Nouvelle identité après détachement')$$, 'PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_person_link_v1(pc_test.key('up-relink-cpt-d'), pc_test.id('p_cpt_d'),
  pc_test.id('cpt_d'), true, 'Ancienne identité après détachement')$$, 'PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE');
RESET ROLE;
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('cpt_e')) = pc_test.id('p_cpt_e')
  AND payables_private.person_of_user(pc_test.id('acc4')) IS NULL
  AND payables_private.person_of_user(pc_test.id('cpt_d')) IS NULL, 'first identity only, never after a signature');
UPDATE payables_private.runtime_control
   SET business_writes_enabled = true, change_reason = 'Open synthetic window for the upgrade remedies';
SELECT pc_test.sign('pay_legacy_e', 'p_dir', DATE '2026-10-28');
SELECT pc_test.as_user('acc2');
SELECT pc_test.assert((public.payables_confirm_issuance_v1(pc_test.key('up-confirm-legacy-e'), pc_test.id('form_pay_legacy_e'),
  pc_test.form_version(pc_test.id('form_pay_legacy_e')), DATE '2026-10-28', false) ->> 'issuance_id') IS NOT NULL,
  'legacy cheque of a formerly unlinked preparer is confirmed by the normal path');
-- Impression héritée en attente d'un préparateur détaché : le fait s'enregistre (cause étrangère au déclarant).
SELECT pc_test.as_user('acc1');
SELECT public.payables_record_print_outcome_v1(pc_test.key('up-outcome-legacy-d'), pc_test.id('pe_legacy_d'), 'PRINTED', NULL);
RESET ROLE;
SELECT pc_test.assert((SELECT state FROM public.payables_cheque_forms WHERE id = pc_test.id('form_legacy_d')) = 'PRINTED',
  'the real outcome of a legacy print is recorded');
UPDATE payables_private.runtime_control
   SET business_writes_enabled = false, change_reason = 'Close synthetic window after the upgrade remedies';

SELECT 'PASS 85_single_admin_upgrade' AS marker;
