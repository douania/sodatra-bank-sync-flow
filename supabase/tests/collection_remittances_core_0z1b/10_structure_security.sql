\set ON_ERROR_STOP on

SELECT poc_test.assert(
  (SELECT count(*)=11 FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN (
    'collection_bank_remittances','collection_bank_remittance_items','collection_receipts',
    'collection_import_origins','collection_instruments','collection_invoice_allocations',
    'collection_match_proposals','collection_bank_line_allocations','collection_events',
    'collection_command_idempotency','collection_domain_assignments')),
  'eleven Core tables must exist');

SELECT poc_test.assert(to_regclass('public.collection_exception_status_v') IS NOT NULL,
  'single exception view must exist');

SELECT poc_test.assert(
  (SELECT n.nspname='extensions' FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
   WHERE e.extname='pgcrypto'),
  'portability replay must place pgcrypto outside public');
SELECT poc_test.assert(
  public.collection_payload_hash('{"portable":true}'::jsonb)=
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('{"portable": true}'::jsonb::text,'UTF8')),'hex'),
  'payload hash must use schema-stable native PostgreSQL SHA-256');
SELECT poc_test.assert(
  pg_get_functiondef('public.collection_payload_hash(jsonb)'::regprocedure) NOT ILIKE '%digest(%',
  'payload hash must not depend on pgcrypto digest resolution');
SELECT poc_test.assert(
  (SELECT count(*)=1 FROM information_schema.views
   WHERE table_schema='public' AND table_name LIKE 'collection\_%\_v' ESCAPE '\'),
  'only one Core view is allowed');

SELECT poc_test.assert(
  (SELECT count(*)=11 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN (
    'collection_bank_remittances','collection_bank_remittance_items','collection_receipts',
    'collection_import_origins','collection_instruments','collection_invoice_allocations',
    'collection_match_proposals','collection_bank_line_allocations','collection_events',
    'collection_command_idempotency','collection_domain_assignments') AND c.relrowsecurity),
  'RLS must be enabled on all Core tables');

SELECT poc_test.assert(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='collection_events'
    AND policyname='collection_events_audit_select')
  AND EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='collection_domain_assignments'
    AND policyname='collection_domain_assignments_bounded_select'),
  'audit and capability tables must use dedicated bounded SELECT policies');

SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name LIKE 'collection\_%' ESCAPE '\'
      AND grantee IN ('PUBLIC','anon','authenticated')
      AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')),
  'no direct Core DML may be granted to application roles');

SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name LIKE 'collection\_%' ESCAPE '\'
      AND grantee IN ('PUBLIC','anon')),
  'PUBLIC and anon must have no Core table/view grants');

WITH expected(name) AS (VALUES
 ('create_collection_remittance_v1'),('add_collection_remittance_item_v1'),
 ('validate_collection_remittance_v1'),('request_collection_remittance_withdrawal_v1'),
 ('confirm_collection_remittance_withdrawal_v1'),('resubmit_collection_remittance_item_v1'),
 ('import_collection_receipts_v1'),('allocate_collection_invoice_v1'),
 ('propose_collection_match_v1'),('confirm_collection_match_v1'),
 ('rebind_collection_superseded_evidence_v1'),('correct_collection_capture_v1'),
 ('cancel_collection_remittance_v1'),('resolve_collection_duplicate_v1'),
 ('grant_collection_capability_v1'))
SELECT poc_test.assert(
  (SELECT count(*)=15 FROM expected e WHERE to_regprocedure(
    CASE e.name
      WHEN 'create_collection_remittance_v1' THEN 'public.create_collection_remittance_v1(text,jsonb,jsonb)'
      WHEN 'add_collection_remittance_item_v1' THEN 'public.add_collection_remittance_item_v1(text,uuid,uuid,jsonb)'
      WHEN 'validate_collection_remittance_v1' THEN 'public.validate_collection_remittance_v1(text,uuid,text)'
      WHEN 'request_collection_remittance_withdrawal_v1' THEN 'public.request_collection_remittance_withdrawal_v1(text,uuid,text)'
      WHEN 'confirm_collection_remittance_withdrawal_v1' THEN 'public.confirm_collection_remittance_withdrawal_v1(text,uuid,text,text,text)'
      WHEN 'resubmit_collection_remittance_item_v1' THEN 'public.resubmit_collection_remittance_item_v1(text,uuid,uuid,date,text,text)'
      WHEN 'import_collection_receipts_v1' THEN 'public.import_collection_receipts_v1(text,text,jsonb)'
      WHEN 'allocate_collection_invoice_v1' THEN 'public.allocate_collection_invoice_v1(text,uuid,text,numeric,text,text)'
      WHEN 'propose_collection_match_v1' THEN 'public.propose_collection_match_v1(text,text,uuid,jsonb)'
      WHEN 'confirm_collection_match_v1' THEN 'public.confirm_collection_match_v1(text,uuid,text,text)'
      WHEN 'rebind_collection_superseded_evidence_v1' THEN 'public.rebind_collection_superseded_evidence_v1(text,uuid,uuid,text)'
      WHEN 'correct_collection_capture_v1' THEN 'public.correct_collection_capture_v1(text,text,uuid,jsonb,text)'
      WHEN 'cancel_collection_remittance_v1' THEN 'public.cancel_collection_remittance_v1(text,uuid,text,text,text)'
      WHEN 'resolve_collection_duplicate_v1' THEN 'public.resolve_collection_duplicate_v1(text,uuid,text,uuid,text)'
      ELSE 'public.grant_collection_capability_v1(text,uuid,text,boolean,text)' END) IS NOT NULL),
  'all fifteen write commands must exist');

SELECT poc_test.assert(to_regprocedure('public.export_collection_register_v1()') IS NOT NULL,
  'read-only export RPC must exist');

SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND (p.proname LIKE '%collection%_v1' OR p.proname='export_collection_register_v1')
      AND (NOT p.prosecdef OR coalesce(array_to_string(p.proconfig,','),'') NOT LIKE '%search_path=%')),
  'every exposed Core RPC must be SECURITY DEFINER with bounded search_path');

SELECT poc_test.assert(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE n.nspname='public' AND (p.proname LIKE 'collection\_%' ESCAPE '\' OR p.proname='export_collection_register_v1')
      AND acl.privilege_type='EXECUTE'
      AND acl.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname='anon'))),
  'PUBLIC and anon must not execute Core functions');

SELECT poc_test.assert(
  (SELECT count(*)=16 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND has_function_privilege('authenticated',p.oid,'EXECUTE')
     AND (p.proname LIKE '%collection%_v1' OR p.proname='export_collection_register_v1')),
  'authenticated must execute exactly fifteen commands plus the export');

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.collection_receipts(created_by,client_name,receipt_method,expected_amount,currency)
    VALUES(auth.uid(),'forbidden','CASH',1,'XOF');
    RAISE EXCEPTION 'TEST_FAILED: direct insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

INSERT INTO public.collection_events(actor_id,command_name,event_type,aggregate_type,correlation_id,reason)
VALUES('00000000-0000-0000-0000-000000000001','test_only','TEST_APPEND_ONLY','TEST',gen_random_uuid(),'synthetic');

DO $$
BEGIN
  BEGIN
    UPDATE public.collection_events SET reason='forbidden';
    RAISE EXCEPTION 'TEST_FAILED: append-only update unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%COLLECTION_EVENTS_APPEND_ONLY%' THEN RAISE; END IF;
  END;
END $$;

SELECT 'STRUCTURE_SECURITY_PASS' AS result;
