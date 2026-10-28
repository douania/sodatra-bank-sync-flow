-- L'écriture en cours a abouti ; la révocation s'applique à l'appel suivant (test 5).
SELECT pc_test.assert(EXISTS (SELECT 1 FROM public.payables_suppliers WHERE canonical_name = 'Fournisseur course révocation'),
  'in-flight write committed before the revocation');
SELECT pc_test.assert((SELECT g.action FROM public.payables_capability_grants g WHERE g.user_id = pc_test.id('cpt_a')
  AND g.capability = 'SUPPLIER_MANAGE' AND g.status = 'VALIDATED' ORDER BY g.decision_seq DESC LIMIT 1) = 'REVOKE',
  'revocation recorded last');
SELECT pc_test.as_user('cpt_a');
SELECT pc_test.expect_error($$SELECT public.payables_create_supplier_v1(pc_test.key('race-revoke-after'), 'Fournisseur refusé',
  'Après révocation concurrente')$$, 'PAYABLES_CAPABILITY_REQUIRED:SUPPLIER_MANAGE');
RESET ROLE;
SELECT 'PASS 93_admin_revoke_assert' AS marker;
