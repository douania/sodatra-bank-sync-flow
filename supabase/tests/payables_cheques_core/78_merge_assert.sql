-- Après la course : la fusion a vu la réservation concurrente.
SELECT pc_test.assert((SELECT count(*) FROM public.payables_payments WHERE invoice_id = pc_test.id('inv_race_merge')) = 1,
  'P2-6: the concurrent reservation committed');
SELECT pc_test.assert((SELECT status = 'PROPOSED' AND touches_engagements FROM public.payables_supplier_merges
  WHERE absorbed_id = pc_test.id('sup_race_abs')), 'P2-6: the merge waits for a second actor once engagements exist');
SELECT pc_test.assert((SELECT status FROM public.payables_suppliers WHERE id = pc_test.id('sup_race_abs')) = 'ACTIVE'
  AND (SELECT supplier_id FROM public.payables_invoices WHERE id = pc_test.id('inv_race_merge')) = pc_test.id('sup_race_abs'),
  'P2-6: nothing was merged without the second actor');
SELECT 'PASS 78_merge_assert' AS marker;
