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
    AND d.item !~ '^function:(payables_private\.(set_module_admin|require_admin|prepare_admin_authority_change|append_admin_authority_event|user_prepares_pending_cheque)|payables_admin_(set_capability|create_person|set_person_link|set_parameter|reject_legacy_proposal)_v1)\('
    AND d.item !~ '^trigger:admin_authority(_events)?\.payables_admin_authority_'
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

-- 3. Désignation opérateur de l'administrateur. Un ancien gouverneur encore
-- rattaché à une personne ne peut pas être désigné (revue indépendante P2-2).
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('gov_a')) = pc_test.id('p_gova'), 'former governor is linked');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin(NULL, pc_test.id('gov_a'), 'Designation of a linked governor')$$,
  'PAYABLES_ADMIN_DESIGNEE_LINKED');
SELECT payables_private.set_module_admin(NULL, pc_test.id('dg'), 'Synthetic designation of the module administrator');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events WHERE event_type = 'ADMIN_AUTHORITY_CHANGED') = 1,
  'designation journaled');

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

SELECT 'PASS 85_single_admin_upgrade' AS marker;
