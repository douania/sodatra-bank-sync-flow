-- Security Fix Migration: Enable RLS and Fix Permissive Policies
-- This migration addresses critical security issues by:
-- 1. Enabling RLS on all public tables
-- 2. Removing overly permissive policies
-- 3. Setting up proper authenticated access control

-- Enable RLS on all tables in public schema
ALTER TABLE public.bank_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_evolution_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits_not_cleared ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impayes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.universal_bank_reports ENABLE ROW LEVEL SECURITY;

-- Drop overly permissive policies
DROP POLICY IF EXISTS "allow_all_access" ON public.bank_audit_log;
DROP POLICY IF EXISTS "allow_all_bank_reports" ON public.universal_bank_reports;
DROP POLICY IF EXISTS "Allow authenticated users to view collection_report" ON public.collection_report;
DROP POLICY IF EXISTS "Allow authenticated users to insert collection_report" ON public.collection_report;

-- bank_audit_log: Audit logs should be system-only for INSERT, admin-read only
-- For now, allow authenticated users to view their own audit logs
CREATE POLICY "authenticated_view_own_audit_logs"
ON public.bank_audit_log
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "authenticated_insert_audit_logs"
ON public.bank_audit_log
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- universal_bank_reports: Restrict to authenticated users only
CREATE POLICY "authenticated_view_bank_reports"
ON public.universal_bank_reports
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "authenticated_insert_bank_reports"
ON public.universal_bank_reports
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "authenticated_update_bank_reports"
ON public.universal_bank_reports
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "authenticated_delete_bank_reports"
ON public.universal_bank_reports
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- collection_report: Restrict to authenticated users
CREATE POLICY "authenticated_view_collections"
ON public.collection_report
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "authenticated_insert_collections"
ON public.collection_report
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "authenticated_update_collections"
ON public.collection_report
FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "authenticated_delete_collections"
ON public.collection_report
FOR DELETE
TO authenticated
USING (true);

-- bank_reports: Authenticated access
CREATE POLICY "authenticated_all_bank_reports"
ON public.bank_reports
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- deposits_not_cleared: Authenticated access
CREATE POLICY "authenticated_all_deposits"
ON public.deposits_not_cleared
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- bank_facilities: Authenticated access
CREATE POLICY "authenticated_all_facilities"
ON public.bank_facilities
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- impayes: Authenticated access
CREATE POLICY "authenticated_all_impayes"
ON public.impayes
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- fund_position: Authenticated access
CREATE POLICY "authenticated_all_fund_position"
ON public.fund_position
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- fund_position_detail: Authenticated access
CREATE POLICY "authenticated_all_fund_position_detail"
ON public.fund_position_detail
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- fund_position_hold: Authenticated access
CREATE POLICY "authenticated_all_fund_position_hold"
ON public.fund_position_hold
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- client_reconciliation: Authenticated access
CREATE POLICY "authenticated_all_client_reconciliation"
ON public.client_reconciliation
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- bank_evolution_tracking: Authenticated access
CREATE POLICY "authenticated_all_bank_evolution"
ON public.bank_evolution_tracking
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);