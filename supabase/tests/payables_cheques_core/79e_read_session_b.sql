-- Session B : pendant la lecture de A, déplace une facture dans l'ordre
-- (échéance) et change son montant, à nombre de lignes constant, puis valide.
SELECT pc_test.as_user('acc3');
SELECT public.payables_correct_invoice_v1(pc_test.key('read-race-b'), pc_test.id('inv_read_1'),
  (SELECT row_version FROM public.payables_invoices WHERE id = pc_test.id('inv_read_1')), 1500, NULL, DATE '2026-11-01',
  'Original lecture 1 corrigé', 'Correction pendant une lecture');
