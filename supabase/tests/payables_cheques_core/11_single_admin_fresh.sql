-- Installation neuve des trois migrations : administration fermée tant que
-- l'opérateur n'a désigné personne, gouvernance à deux acteurs désactivée,
-- désignation par l'opérateur seulement. Rôle postgres sauf mention.

SELECT pc_test.assert(encode(convert_to('é', 'UTF8'), 'hex') = 'c3a9', 'SQL transport keeps UTF-8 intact');
SELECT pc_test.assert((SELECT admin_user_id IS NULL FROM payables_private.admin_authority), 'no administrator by default');
SELECT pc_test.assert((SELECT NOT business_writes_enabled AND NOT export_enabled FROM payables_private.runtime_control),
  'runtime control closed by default');

-- Aucun administrateur configuré : personne n'administre, pas même le premier connecté.
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_admin_create_person_v1(pc_test.key('fresh-1'), 'Personne', 'Avant désignation')$$,
  'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() ->> 'admin_configured')::boolean
  AND NOT (public.payables_my_access_v1() ->> 'is_admin')::boolean
  AND jsonb_array_length(public.payables_my_access_v1() -> 'capabilities') = 0, 'no implicit authority without designation');
SELECT pc_test.assert(public.payables_my_access_v1() ->> 'governance_model' = 'SINGLE_ADMIN', 'governance model exposed');
-- Rôle global admin : aucun droit métier ni d'administration du module.
SELECT pc_test.as_user('admin');
SELECT pc_test.expect_error($$SELECT public.payables_admin_set_capability_v1(pc_test.key('fresh-2'), pc_test.id('acc1'), 'READ',
  true, 'Rôle global')$$, 'PAYABLES_ADMIN_REQUIRED');
-- Gouvernance héritée désactivée, quel que soit l'appelant.
SELECT pc_test.expect_error($$SELECT public.payables_propose_capability_v1(pc_test.key('fresh-3'), pc_test.id('acc1'), 'READ',
  'GRANT', 'Ancienne voie')$$, 'PAYABLES_LEGACY_GOVERNANCE_DISABLED');
-- La désignation n'est pas accessible à un utilisateur applicatif.
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin(NULL, auth.uid(), 'Auto désignation applicative')$$,
  'permission denied');
SELECT pc_test.expect_error($$UPDATE payables_private.admin_authority SET admin_user_id = auth.uid(),
  change_reason = 'Auto désignation directe'$$, 'permission denied');
RESET ROLE;
SELECT pc_test.expect_error($$SELECT payables_private.bootstrap_parameter_governance(pc_test.id('gov_a'), pc_test.id('gov_b'),
  'Ancien amorçage')$$, 'PAYABLES_LEGACY_GOVERNANCE_DISABLED');

-- Désignation opérateur (test local uniquement), journalisée deux fois.
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin(NULL, gen_random_uuid(), 'Designation of an unknown user')$$,
  'PAYABLES_USER_UNKNOWN');
SELECT payables_private.set_module_admin(NULL, pc_test.id('dg'), 'Synthetic designation of the module administrator');
SELECT pc_test.assert((SELECT admin_user_id FROM payables_private.admin_authority) = pc_test.id('dg'), 'administrator designated');
SELECT pc_test.assert((SELECT count(*) FROM payables_private.admin_authority_events
  WHERE previous_admin_user_id IS NULL AND new_admin_user_id = pc_test.id('dg')) = 1, 'designation journaled privately');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_events WHERE event_type = 'ADMIN_AUTHORITY_CHANGED') = 1,
  'designation journaled in the domain log');
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin(NULL, pc_test.id('acc1'), 'Second designation attempt')$$,
  'PAYABLES_ADMIN_AUTHORITY_STALE');
SELECT pc_test.as_user('dg');
SELECT pc_test.assert((public.payables_my_access_v1() ->> 'is_admin')::boolean, 'designated administrator sees the authority');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() -> 'capabilities') ? 'PARAM_PROPOSE', 'no retired capability exposed');
RESET ROLE;

-- Contrôles de 10_structure_security repris : anonyme, module fermé, lecture sans capacité.
SELECT pc_test.as_anonymous();
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1('pc-test:fresh-anon','X','reason')$$, 'permission denied');
RESET ROLE;
SELECT pc_test.as_user('acc1');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1(pc_test.key('fresh-closed'), 'Fournisseur', 'Raison test')$$,
  'PAYABLES_DOMAIN_READ_ONLY');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_suppliers) = 0, 'no read without capability');
SELECT pc_test.expect_error($$SELECT * FROM public.payables_invoice_overview_v1()$$, 'PAYABLES_CAPABILITY_REQUIRED:READ');
RESET ROLE;

-- Ouverture opérateur de la fenêtre de qualification (comme 10_structure_security).
UPDATE payables_private.runtime_control
   SET business_writes_enabled = true, change_reason = 'Open synthetic PG17 qualification window';

SELECT 'PASS 11_single_admin_fresh' AS marker;
