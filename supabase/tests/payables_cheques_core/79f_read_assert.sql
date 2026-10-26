-- Après la course : B a validé pendant la lecture de A, et A a lu l'état
-- d'avant B, complet, sans ligne omise ni répétée.
SELECT pc_test.assert((SELECT amount FROM public.payables_invoices WHERE id = pc_test.id('inv_read_1')) = 1500
  AND (SELECT due_date FROM public.payables_invoices WHERE id = pc_test.id('inv_read_1')) = DATE '2026-11-01',
  'read race: the concurrent correction committed');
SELECT pc_test.assert((SELECT count(*) FROM pc_test.read_capture) = 1, 'read race: one capture');
SELECT pc_test.assert((SELECT jsonb_array_length(payload) FROM pc_test.read_capture) = (SELECT invoice_count FROM pc_test.read_before)
  AND (SELECT count(DISTINCT e ->> 'invoice_id') FROM pc_test.read_capture c, jsonb_array_elements(c.payload) e)
  = (SELECT invoice_count FROM pc_test.read_before), 'read race: every invoice exactly once (no omission, no repetition)');
SELECT pc_test.assert((SELECT (e ->> 'amount')::numeric = 1000 AND e ->> 'due_date' = '2026-12-01'
  FROM pc_test.read_capture c, jsonb_array_elements(c.payload) e WHERE e ->> 'invoice_id' = pc_test.id('inv_read_1')::text),
  'read race: the moved invoice is read in its single pre-write state');
SELECT pc_test.assert((SELECT sum((e ->> 'amount')::numeric) FROM pc_test.read_capture c, jsonb_array_elements(c.payload) e)
  = (SELECT total FROM pc_test.read_before), 'read race: the total comes from one snapshot');
SELECT 'PASS 79f_read_assert' AS marker;
