-- Invariants après les courses : une seule réservation, une seule émission.
SELECT pc_test.assert((SELECT count(*) FROM public.payables_payments WHERE invoice_id = pc_test.id('inv_conc')) = 1,
  'S9: exactly one reservation survives the race');
SELECT pc_test.assert((SELECT sum(amount) FROM public.payables_allocations WHERE invoice_id = pc_test.id('inv_conc')
  AND status IN ('RESERVED','ENGAGED')) = 5000, 'S9: the invoice is never over-committed');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_issuances WHERE form_id = pc_test.id('form_pay_race')) = 1,
  'S8: exactly one issuance under concurrent confirmations');
SELECT pc_test.assert((SELECT count(*) FROM public.payables_allocations WHERE payment_id = pc_test.id('pay_race')
  AND status = 'ENGAGED') = 1, 'S8: one engaged allocation');
SELECT 'PASS 75_concurrency_assert' AS marker;
