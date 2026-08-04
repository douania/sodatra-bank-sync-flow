\set ON_ERROR_STOP on

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;

SELECT count(*) AS receipts FROM public.collection_receipts \gset before_
SELECT count(*) AS remittances FROM public.collection_bank_remittances \gset before_
SELECT count(*) AS items FROM public.collection_bank_remittance_items \gset before_
SELECT count(*) AS invoices FROM public.collection_invoice_allocations \gset before_
SELECT count(*) AS commands FROM public.collection_command_idempotency \gset before_

DO $$
BEGIN
  BEGIN
    PERFORM public.create_collection_entry_v1(
      'atomic-reload-recovery',
      jsonb_build_object(
        'client_name','ATOMIC FAILURE SYNTHETIC',
        'receipt_method','CASH',
        'expected_amount',777,
        'currency','XOF'
      ),
      jsonb_build_object(
        'deposit_account_id','10000000-0000-0000-0000-000000000001',
        'deposit_currency','XOF',
        'declared_total_amount',777,
        'deposit_date','2026-08-04',
        'slip_reference','ATOMIC-777',
        'capture_mode','MANUAL',
        'remittance_kind','LOGICAL_CASH'
      ),
      jsonb_build_object('item_amount',777,'currency','XOF'),
      jsonb_build_object(
        'invoice_reference','ATOMIC-FAIL',
        'amount',778,
        'currency','XOF',
        'validation_evidence','synthetic failure at final step'
      )
    );
    RAISE EXCEPTION 'TEST_FAILED: overallocated invoice unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_INVOICE_OVERALLOCATION%' THEN RAISE; END IF;
  END;
END $$;

SELECT poc_test.assert((SELECT count(*)=:'before_receipts'::bigint FROM public.collection_receipts),
  'failed atomic entry must not retain a receipt');
SELECT poc_test.assert((SELECT count(*)=:'before_remittances'::bigint FROM public.collection_bank_remittances),
  'failed atomic entry must not retain a remittance');
SELECT poc_test.assert((SELECT count(*)=:'before_items'::bigint FROM public.collection_bank_remittance_items),
  'failed atomic entry must not retain an item');
SELECT poc_test.assert((SELECT count(*)=:'before_invoices'::bigint FROM public.collection_invoice_allocations),
  'failed atomic entry must not retain an invoice allocation');
SELECT poc_test.assert((SELECT count(*)=:'before_commands'::bigint FROM public.collection_command_idempotency),
  'failed atomic entry must roll back all nested idempotency rows');

SELECT
  x->>'receipt_id' AS receipt_id,
  x->>'remittance_id' AS remittance_id,
  x->>'item_id' AS item_id,
  x->>'invoice_allocation_id' AS invoice_allocation_id
FROM (
  SELECT public.create_collection_entry_v1(
    'atomic-reload-recovery',
    jsonb_build_object(
      'client_name','ATOMIC SUCCESS SYNTHETIC',
      'receipt_method','CASH',
      'expected_amount',777,
      'currency','XOF'
    ),
    jsonb_build_object(
      'deposit_account_id','10000000-0000-0000-0000-000000000001',
      'deposit_currency','XOF',
      'declared_total_amount',777,
      'deposit_date','2026-08-04',
      'slip_reference','ATOMIC-777',
      'capture_mode','MANUAL',
      'remittance_kind','LOGICAL_CASH'
    ),
    jsonb_build_object('item_amount',777,'currency','XOF'),
    jsonb_build_object(
      'invoice_reference','ATOMIC-OK',
      'amount',777,
      'currency','XOF',
      'validation_evidence','synthetic successful retry'
    )
  ) x
) s \gset atomic_

SELECT poc_test.assert(
  (SELECT count(*)=1 FROM public.collection_bank_remittance_items
   WHERE id=:'atomic_item_id'::uuid
     AND receipt_id=:'atomic_receipt_id'::uuid
     AND remittance_id=:'atomic_remittance_id'::uuid),
  'successful retry must create one linked item');
SELECT poc_test.assert(
  (SELECT count(*)=1 FROM public.collection_invoice_allocations
   WHERE id=:'atomic_invoice_allocation_id'::uuid
     AND receipt_id=:'atomic_receipt_id'::uuid),
  'successful retry must create one linked invoice allocation');

SELECT poc_test.assert(
  (public.create_collection_entry_v1(
    'atomic-reload-recovery',
    jsonb_build_object(
      'client_name','ATOMIC SUCCESS SYNTHETIC',
      'receipt_method','CASH',
      'expected_amount',777,
      'currency','XOF'
    ),
    jsonb_build_object(
      'deposit_account_id','10000000-0000-0000-0000-000000000001',
      'deposit_currency','XOF',
      'declared_total_amount',777,
      'deposit_date','2026-08-04',
      'slip_reference','ATOMIC-777',
      'capture_mode','MANUAL',
      'remittance_kind','LOGICAL_CASH'
    ),
    jsonb_build_object('item_amount',777,'currency','XOF'),
    jsonb_build_object(
      'invoice_reference','ATOMIC-OK',
      'amount',777,
      'currency','XOF',
      'validation_evidence','synthetic successful retry'
    )
  )->>'remittance_id')::uuid=:'atomic_remittance_id'::uuid,
  'identical atomic replay must return the original remittance');
SELECT poc_test.assert(
  (SELECT count(*)=1 FROM public.collection_receipts WHERE client_name='ATOMIC SUCCESS SYNTHETIC'),
  'identical atomic replay must not duplicate the receipt');
SELECT poc_test.assert(
  (SELECT count(*)=0 FROM public.collection_bank_remittances r
   WHERE r.slip_reference='ATOMIC-777'
     AND NOT EXISTS (SELECT 1 FROM public.collection_bank_remittance_items i WHERE i.remittance_id=r.id)),
  'atomic entry must never leave an orphan remittance');

RESET ROLE;

SELECT 'ATOMIC_ENTRY_PASS' AS result;
