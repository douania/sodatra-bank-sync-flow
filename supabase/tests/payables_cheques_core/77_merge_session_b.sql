-- Session B : fusion proposée pendant la réservation en cours ; elle doit
-- attendre la réservation puis la voir (aucune application sans second acteur).
SELECT pc_test.as_user('acc3');
SELECT public.payables_propose_supplier_merge_v1(pc_test.key('race-merge-b'), pc_test.id('sup_race_abs'),
  pc_test.id('sup_race_kept'), 'Course fusion B') ->> 'outcome';
