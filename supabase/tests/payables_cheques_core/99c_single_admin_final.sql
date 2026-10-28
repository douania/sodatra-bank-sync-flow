-- Remplacement concurrent de l'administrateur, puis refermeture : le
-- successeur administre module fermé, aucune écriture financière n'est admise.

SELECT pc_test.assert(EXISTS (SELECT 1 FROM public.payables_persons WHERE display_name = 'Personne course remplacement'
  AND origin = 'ADMIN' AND decided_by = pc_test.id('dg')), 'decision in flight committed before the replacement');
SELECT pc_test.assert((SELECT admin_user_id FROM payables_private.admin_authority) = pc_test.id('dg_next'), 'successor designated');
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_admin_create_person_v1(pc_test.key('final-1'), 'Personne', 'Ancien administrateur')$$,
  'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.as_user('dg_next');
SELECT pc_test.assert((public.payables_my_access_v1() ->> 'is_admin')::boolean
  AND (public.payables_my_access_v1() -> 'capabilities') ? 'READ', 'successor holds the authority and its rights');
RESET ROLE;

UPDATE payables_private.runtime_control
   SET business_writes_enabled = false, change_reason = 'Close synthetic window after single-admin checks';
SELECT pc_test.as_user('dg_next');
SELECT public.payables_admin_set_capability_v1(pc_test.key('final-revoke'), pc_test.id('cpt_b'), 'EXIT_REQUEST', false,
  'Retrait module fermé');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1(pc_test.key('final-2'), 'Fournisseur module fermé',
  'Module fermé')$$, 'PAYABLES_DOMAIN_READ_ONLY');
SELECT pc_test.as_user('cpt_b');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() -> 'capabilities') ? 'EXIT_REQUEST', 'closed-module revocation effective');
RESET ROLE;
SELECT pc_test.assert((SELECT NOT business_writes_enabled AND NOT export_enabled FROM payables_private.runtime_control),
  'module left closed');
SELECT pc_test.assert((SELECT count(*) FROM payables_private.admin_authority_events)
  = (SELECT count(*) FROM public.payables_events WHERE event_type = 'ADMIN_AUTHORITY_CHANGED'), 'both authority journals agree');

SELECT 'PASS 99c_single_admin_final' AS marker;
