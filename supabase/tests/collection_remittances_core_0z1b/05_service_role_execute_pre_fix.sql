\set ON_ERROR_STOP on

-- Reproduce the staging-only gap before applying the additive correction.
-- The platform default privilege gives service_role EXECUTE on new functions;
-- the original prefix-based revoke misses these fifteen write RPCs.
WITH expected(signature) AS (VALUES
 ('public.create_collection_remittance_v1(text,jsonb,jsonb)'::regprocedure),
 ('public.add_collection_remittance_item_v1(text,uuid,uuid,jsonb)'::regprocedure),
 ('public.validate_collection_remittance_v1(text,uuid,text)'::regprocedure),
 ('public.request_collection_remittance_withdrawal_v1(text,uuid,text)'::regprocedure),
 ('public.confirm_collection_remittance_withdrawal_v1(text,uuid,text,text,text)'::regprocedure),
 ('public.resubmit_collection_remittance_item_v1(text,uuid,uuid,date,text,text)'::regprocedure),
 ('public.import_collection_receipts_v1(text,text,jsonb)'::regprocedure),
 ('public.allocate_collection_invoice_v1(text,uuid,text,numeric,text,text)'::regprocedure),
 ('public.propose_collection_match_v1(text,text,uuid,jsonb)'::regprocedure),
 ('public.confirm_collection_match_v1(text,uuid,text,text)'::regprocedure),
 ('public.rebind_collection_superseded_evidence_v1(text,uuid,uuid,text)'::regprocedure),
 ('public.correct_collection_capture_v1(text,text,uuid,jsonb,text)'::regprocedure),
 ('public.cancel_collection_remittance_v1(text,uuid,text,text,text)'::regprocedure),
 ('public.resolve_collection_duplicate_v1(text,uuid,text,uuid,text)'::regprocedure),
 ('public.grant_collection_capability_v1(text,uuid,text,boolean,text)'::regprocedure)
)
SELECT poc_test.assert(
  (SELECT count(*)=15 FROM expected
   WHERE has_function_privilege('service_role',signature,'EXECUTE')),
  'staging default privileges must reproduce fifteen unintended service_role grants');

SELECT poc_test.assert(
  NOT has_function_privilege(
    'service_role','public.export_collection_register_v1()'::regprocedure,'EXECUTE'),
  'the export was already covered by the original explicit revoke');

SELECT 'SERVICE_ROLE_EXPOSURE_REPRODUCED' AS result;
