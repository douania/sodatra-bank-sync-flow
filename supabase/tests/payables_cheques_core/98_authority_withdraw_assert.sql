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
SELECT pc_test.assert((SELECT count(*) FROM payables_private.admin_authority_events
  WHERE previous_admin_user_id = pc_test.id('dg') AND new_admin_user_id IS NULL) = 1, 'withdrawal journaled');
-- Le retrait de l'autorité ne touche pas l'identité personnelle établie par l'opérateur.
SELECT pc_test.assert(payables_private.person_of_user(pc_test.id('dg')) = pc_test.id('p_dirigeant'), 'identity survives the withdrawal');
-- Nouvelle désignation pour la course suivante.
SELECT payables_private.set_module_admin(NULL, pc_test.id('dg'), 'Synthetic redesignation of the module administrator');
SELECT 'PASS 98_authority_withdraw_assert' AS marker;
