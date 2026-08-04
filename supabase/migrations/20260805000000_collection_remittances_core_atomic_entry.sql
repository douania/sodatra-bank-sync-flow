BEGIN;

CREATE OR REPLACE FUNCTION public.create_collection_entry_v1(
  p_command_key text,
  p_receipt jsonb,
  p_remittance jsonb,
  p_item jsonb,
  p_invoice jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := public.collection_require_actor();
  v_cached jsonb;
  v_created jsonb;
  v_item jsonb;
  v_invoice jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.collection_require_capability(v_actor,'ENTRY');
  v_cached := public.collection_idempotency_begin(
    v_actor,
    'create_collection_entry_v1',
    p_command_key,
    jsonb_build_object(
      'receipt',p_receipt,
      'remittance',p_remittance,
      'item',p_item,
      'invoice',p_invoice
    )
  );
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  v_created := public.create_collection_remittance_v1(
    p_command_key || ':create',
    p_receipt,
    p_remittance
  );
  v_item := public.add_collection_remittance_item_v1(
    p_command_key || ':item',
    (v_created->>'remittance_id')::uuid,
    (v_created->>'receipt_id')::uuid,
    p_item
  );

  IF p_invoice IS NOT NULL AND p_invoice <> 'null'::jsonb THEN
    IF jsonb_typeof(p_invoice) <> 'object' THEN
      RAISE EXCEPTION 'COLLECTION_INVOICE_PAYLOAD_INVALID';
    END IF;
    v_invoice := public.allocate_collection_invoice_v1(
      p_command_key || ':invoice',
      (v_created->>'receipt_id')::uuid,
      p_invoice->>'invoice_reference',
      (p_invoice->>'amount')::numeric,
      p_invoice->>'currency',
      p_invoice->>'validation_evidence'
    );
  END IF;

  v_result := jsonb_build_object(
    'outcome','created',
    'receipt_id',v_created->>'receipt_id',
    'remittance_id',v_created->>'remittance_id',
    'item_id',v_item->>'item_id',
    'invoice_allocation_id',v_invoice->>'invoice_allocation_id'
  );
  RETURN public.collection_idempotency_finish(
    v_actor,
    'create_collection_entry_v1',
    p_command_key,
    v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_collection_entry_v1(text,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_collection_entry_v1(text,jsonb,jsonb,jsonb,jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.create_collection_entry_v1(text,jsonb,jsonb,jsonb,jsonb) IS
  'Atomically creates one receipt, one remittance, its first item and optional invoice allocation.';

COMMIT;
