-- Retrait de l'autorité : l'écriture en cours a abouti ; droits implicites et
-- administration cessent dès l'appel suivant, session ouverte comprise (test 5).
SELECT pc_test.assert((SELECT count(*) FROM public.payables_capability_grants WHERE user_id = pc_test.id('cpt_b')
  AND capability = 'EXIT_REQUEST' AND origin = 'ADMIN') = 1, 'concurrent identical decisions recorded once');
SELECT pc_test.assert(EXISTS (SELECT 1 FROM public.payables_suppliers WHERE canonical_name = 'Fournisseur course autorité'),
  'administrator in-flight write committed before the withdrawal');
SELECT pc_test.assert((SELECT admin_user_id IS NULL FROM payables_private.admin_authority), 'administration closed');
SELECT pc_test.as_user('dg');
SELECT pc_test.expect_error($$SELECT public.payables_admin_create_person_v1(pc_test.key('race-after-1'), 'Personne', 'Après retrait')$$,
  'PAYABLES_ADMIN_REQUIRED');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1(pc_test.key('race-after-2'), 'Fournisseur sans droit',
  'Après retrait')$$, 'PAYABLES_CAPABILITY_REQUIRED:SUPPLIER_MANAGE');
SELECT pc_test.assert(NOT (public.payables_my_access_v1() ->> 'is_admin')::boolean
  AND jsonb_array_length(public.payables_my_access_v1() -> 'capabilities') = 0, 'implicit rights end with the authority');
-- Une clé déjà utilisée n'est pas rejouée pour un ancien administrateur : l'autorité est vérifiée d'abord.
SELECT pc_test.expect_error($$SELECT public.payables_admin_create_person_v1(pc_test.key('sa-person-dg'),
  'Dirigeant signataire synthétique', 'Signataire unique')$$, 'PAYABLES_ADMIN_REQUIRED');
-- Les décisions passées restent en vigueur et dans le journal.
SELECT pc_test.as_user('cpt_b');
SELECT pc_test.assert((public.payables_my_access_v1() -> 'capabilities') ? 'EXIT_REQUEST', 'past decisions remain effective');
RESET ROLE;
SELECT pc_test.assert((SELECT count(*) FROM payables_private.admin_authority_events WHERE new_admin_user_id IS NULL) = 1,
  'withdrawal journaled');
-- Un utilisateur rattaché à une personne n'est jamais désigné, quel que soit le chemin.
SELECT pc_test.expect_error($$SELECT payables_private.set_module_admin(NULL, pc_test.id('acc1'), 'Designation of a linked accountant')$$,
  'PAYABLES_ADMIN_DESIGNEE_LINKED');
SELECT pc_test.expect_error($$UPDATE payables_private.admin_authority SET admin_user_id = pc_test.id('acc1'),
  change_reason = 'Direct designation of a linked accountant'$$, 'PAYABLES_ADMIN_DESIGNEE_LINKED');
-- Nouvelle désignation pour la course suivante.
SELECT payables_private.set_module_admin(NULL, pc_test.id('dg'), 'Synthetic redesignation of the module administrator');
SELECT 'PASS 98_authority_withdraw_assert' AS marker;
