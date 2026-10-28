-- Session B : écriture du titulaire pendant la révocation ; elle attend la
-- décision, relit l'état validé et échoue fermée.
SELECT pc_test.as_user('cpt_a');
SELECT public.payables_create_invoice_v1(pc_test.key('race-revoke-first-b'), pc_test.id('sa_supplier'), 'SA-REF-RACE', 1000,
  'XOF', NULL, NULL, 'Pendant la révocation');
