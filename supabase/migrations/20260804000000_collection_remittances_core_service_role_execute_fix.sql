-- 0Z1B Core Collections / Remittances
-- Corrective additive migration: close unintended service_role EXECUTE grants.
--
-- PostgreSQL/Supabase default privileges can grant EXECUTE to service_role on
-- newly-created functions. The 0Z1B Core migration revoked those grants for
-- collection_* helpers and the export, but fifteen write RPC names do not use
-- that prefix. Keep the authenticated API unchanged and revoke only the
-- unintended privileged backend surface.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.create_collection_remittance_v1(text,jsonb,jsonb)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.add_collection_remittance_item_v1(text,uuid,uuid,jsonb)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.validate_collection_remittance_v1(text,uuid,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.request_collection_remittance_withdrawal_v1(text,uuid,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.confirm_collection_remittance_withdrawal_v1(text,uuid,text,text,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.resubmit_collection_remittance_item_v1(text,uuid,uuid,date,text,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.import_collection_receipts_v1(text,text,jsonb)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.allocate_collection_invoice_v1(text,uuid,text,numeric,text,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.propose_collection_match_v1(text,text,uuid,jsonb)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.confirm_collection_match_v1(text,uuid,text,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.rebind_collection_superseded_evidence_v1(text,uuid,uuid,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.correct_collection_capture_v1(text,text,uuid,jsonb,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.cancel_collection_remittance_v1(text,uuid,text,text,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_collection_duplicate_v1(text,uuid,text,uuid,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.grant_collection_capability_v1(text,uuid,text,boolean,text)
  FROM service_role;

DO $verify$
DECLARE
  v_signature regprocedure;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_collection_remittance_v1(text,jsonb,jsonb)'::regprocedure,
    'public.add_collection_remittance_item_v1(text,uuid,uuid,jsonb)'::regprocedure,
    'public.validate_collection_remittance_v1(text,uuid,text)'::regprocedure,
    'public.request_collection_remittance_withdrawal_v1(text,uuid,text)'::regprocedure,
    'public.confirm_collection_remittance_withdrawal_v1(text,uuid,text,text,text)'::regprocedure,
    'public.resubmit_collection_remittance_item_v1(text,uuid,uuid,date,text,text)'::regprocedure,
    'public.import_collection_receipts_v1(text,text,jsonb)'::regprocedure,
    'public.allocate_collection_invoice_v1(text,uuid,text,numeric,text,text)'::regprocedure,
    'public.propose_collection_match_v1(text,text,uuid,jsonb)'::regprocedure,
    'public.confirm_collection_match_v1(text,uuid,text,text)'::regprocedure,
    'public.rebind_collection_superseded_evidence_v1(text,uuid,uuid,text)'::regprocedure,
    'public.correct_collection_capture_v1(text,text,uuid,jsonb,text)'::regprocedure,
    'public.cancel_collection_remittance_v1(text,uuid,text,text,text)'::regprocedure,
    'public.resolve_collection_duplicate_v1(text,uuid,text,uuid,text)'::regprocedure,
    'public.grant_collection_capability_v1(text,uuid,text,boolean,text)'::regprocedure
  ]::regprocedure[]
  LOOP
    IF has_function_privilege('service_role',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'SERVICE_ROLE_EXECUTE_NOT_REVOKED:%',v_signature;
    END IF;
    IF NOT has_function_privilege('authenticated',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'AUTHENTICATED_EXECUTE_LOST:%',v_signature;
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
    'service_role',
    'public.collection_current_actor_has_capability(text)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'SERVICE_ROLE_READ_HELPER_EXECUTE_LOST';
  END IF;
END
$verify$;

COMMIT;
