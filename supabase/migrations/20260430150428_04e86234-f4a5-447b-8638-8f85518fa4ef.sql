
-- ============================================================
-- LOT 2B — MIGRATION RLS ADDITIVE
-- Projet : Bank Sync Flow / SODATRA
-- Date : 2026-04-30
-- ============================================================

BEGIN;

-- ============================================================
-- ÉTAPE 0 : Promotion admin additive
-- ============================================================
INSERT INTO public.user_roles (user_id, role)
VALUES ('9539d4f5-a600-4bf7-931f-315e597e4441', 'admin'::public.app_role)
ON CONFLICT (user_id, role) DO NOTHING;

-- ============================================================
-- ÉTAPE 0B : Sécuriser les fonctions SECURITY DEFINER
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- ============================================================
-- ÉTAPE 1 : bank_evolution_tracking
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_bank_evolution" ON public.bank_evolution_tracking;
DROP POLICY IF EXISTS "bank_evolution_access" ON public.bank_evolution_tracking;
DROP POLICY IF EXISTS "bank_evolution_tracking_select" ON public.bank_evolution_tracking;
DROP POLICY IF EXISTS "bank_evolution_tracking_insert" ON public.bank_evolution_tracking;
DROP POLICY IF EXISTS "bank_evolution_tracking_update" ON public.bank_evolution_tracking;
DROP POLICY IF EXISTS "bank_evolution_tracking_delete" ON public.bank_evolution_tracking;

CREATE POLICY "bank_evolution_tracking_select" ON public.bank_evolution_tracking
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
    OR public.has_role(auth.uid(), 'user'::public.app_role)
  );

CREATE POLICY "bank_evolution_tracking_insert" ON public.bank_evolution_tracking
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "bank_evolution_tracking_update" ON public.bank_evolution_tracking
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "bank_evolution_tracking_delete" ON public.bank_evolution_tracking
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- ÉTAPE 2 : bank_facilities
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_facilities" ON public.bank_facilities;
DROP POLICY IF EXISTS "Allow authenticated users to insert bank_facilities" ON public.bank_facilities;
DROP POLICY IF EXISTS "Allow authenticated users to view bank_facilities" ON public.bank_facilities;
DROP POLICY IF EXISTS "allow_authenticated_insert" ON public.bank_facilities;
DROP POLICY IF EXISTS "allow_authenticated_select" ON public.bank_facilities;
DROP POLICY IF EXISTS "bank_facilities_select" ON public.bank_facilities;
DROP POLICY IF EXISTS "bank_facilities_insert" ON public.bank_facilities;
DROP POLICY IF EXISTS "bank_facilities_update" ON public.bank_facilities;
DROP POLICY IF EXISTS "bank_facilities_delete" ON public.bank_facilities;

CREATE POLICY "bank_facilities_select" ON public.bank_facilities
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
    OR public.has_role(auth.uid(), 'user'::public.app_role)
  );

CREATE POLICY "bank_facilities_insert" ON public.bank_facilities
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "bank_facilities_update" ON public.bank_facilities
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "bank_facilities_delete" ON public.bank_facilities
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- ÉTAPE 3 : bank_reports
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_bank_reports" ON public.bank_reports;
DROP POLICY IF EXISTS "Allow authenticated users to insert bank_reports" ON public.bank_reports;
DROP POLICY IF EXISTS "Allow authenticated users to update bank_reports" ON public.bank_reports;
DROP POLICY IF EXISTS "Allow authenticated users to view bank_reports" ON public.bank_reports;
DROP POLICY IF EXISTS "allow_authenticated_insert" ON public.bank_reports;
DROP POLICY IF EXISTS "allow_authenticated_select" ON public.bank_reports;
DROP POLICY IF EXISTS "allow_authenticated_update" ON public.bank_reports;
DROP POLICY IF EXISTS "bank_reports_select" ON public.bank_reports;
DROP POLICY IF EXISTS "bank_reports_insert" ON public.bank_reports;
DROP POLICY IF EXISTS "bank_reports_update" ON public.bank_reports;
DROP POLICY IF EXISTS "bank_reports_delete" ON public.bank_reports;

CREATE POLICY "bank_reports_select" ON public.bank_reports
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
    OR public.has_role(auth.uid(), 'user'::public.app_role)
  );

CREATE POLICY "bank_reports_insert" ON public.bank_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "bank_reports_update" ON public.bank_reports
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "bank_reports_delete" ON public.bank_reports
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- ÉTAPE 4 : client_reconciliation
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_client_reconciliation" ON public.client_reconciliation;
DROP POLICY IF EXISTS "Allow authenticated users to insert client_reconciliation" ON public.client_reconciliation;
DROP POLICY IF EXISTS "Allow authenticated users to view client_reconciliation" ON public.client_reconciliation;
DROP POLICY IF EXISTS "client_reconciliation_select" ON public.client_reconciliation;
DROP POLICY IF EXISTS "client_reconciliation_insert" ON public.client_reconciliation;
DROP POLICY IF EXISTS "client_reconciliation_update" ON public.client_reconciliation;
DROP POLICY IF EXISTS "client_reconciliation_delete" ON public.client_reconciliation;

CREATE POLICY "client_reconciliation_select" ON public.client_reconciliation
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
    OR public.has_role(auth.uid(), 'user'::public.app_role)
  );

CREATE POLICY "client_reconciliation_insert" ON public.client_reconciliation
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "client_reconciliation_update" ON public.client_reconciliation
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "client_reconciliation_delete" ON public.client_reconciliation
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- ÉTAPE 5 : collection_report (corrections INSERT + UPDATE)
-- ============================================================
DROP POLICY IF EXISTS "authenticated_insert_collections" ON public.collection_report;
DROP POLICY IF EXISTS "Only admins and managers can update collections" ON public.collection_report;
DROP POLICY IF EXISTS "collection_report_insert" ON public.collection_report;
DROP POLICY IF EXISTS "collection_report_update" ON public.collection_report;

CREATE POLICY "collection_report_insert" ON public.collection_report
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "collection_report_update" ON public.collection_report
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- ============================================================
-- ÉTAPE 6 : deposits_not_cleared
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_deposits" ON public.deposits_not_cleared;
DROP POLICY IF EXISTS "Allow authenticated users to insert deposits_not_cleared" ON public.deposits_not_cleared;
DROP POLICY IF EXISTS "Allow authenticated users to view deposits_not_cleared" ON public.deposits_not_cleared;
DROP POLICY IF EXISTS "allow_authenticated_insert" ON public.deposits_not_cleared;
DROP POLICY IF EXISTS "allow_authenticated_select" ON public.deposits_not_cleared;
DROP POLICY IF EXISTS "deposits_not_cleared_select" ON public.deposits_not_cleared;
DROP POLICY IF EXISTS "deposits_not_cleared_insert" ON public.deposits_not_cleared;
DROP POLICY IF EXISTS "deposits_not_cleared_update" ON public.deposits_not_cleared;
DROP POLICY IF EXISTS "deposits_not_cleared_delete" ON public.deposits_not_cleared;

CREATE POLICY "deposits_not_cleared_select" ON public.deposits_not_cleared
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
    OR public.has_role(auth.uid(), 'user'::public.app_role)
  );

CREATE POLICY "deposits_not_cleared_insert" ON public.deposits_not_cleared
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "deposits_not_cleared_update" ON public.deposits_not_cleared
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "deposits_not_cleared_delete" ON public.deposits_not_cleared
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- ÉTAPE 7 : fund_position
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_fund_position" ON public.fund_position;
DROP POLICY IF EXISTS "Allow authenticated users to insert fund_position" ON public.fund_position;
DROP POLICY IF EXISTS "Allow authenticated users to view fund_position" ON public.fund_position;
DROP POLICY IF EXISTS "allow_authenticated_insert" ON public.fund_position;
DROP POLICY IF EXISTS "allow_authenticated_select" ON public.fund_position;
DROP POLICY IF EXISTS "fund_position_select" ON public.fund_position;
DROP POLICY IF EXISTS "fund_position_insert" ON public.fund_position;
DROP POLICY IF EXISTS "fund_position_update" ON public.fund_position;
DROP POLICY IF EXISTS "fund_position_delete" ON public.fund_position;

CREATE POLICY "fund_position_select" ON public.fund_position
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
    OR public.has_role(auth.uid(), 'user'::public.app_role)
  );

CREATE POLICY "fund_position_insert" ON public.fund_position
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "fund_position_update" ON public.fund_position
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "fund_position_delete" ON public.fund_position
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- ÉTAPE 8 : fund_position_detail
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_fund_position_detail" ON public.fund_position_detail;
DROP POLICY IF EXISTS "Allow authenticated users to insert fund_position_detail" ON public.fund_position_detail;
DROP POLICY IF EXISTS "Allow authenticated users to view fund_position_detail" ON public.fund_position_detail;
DROP POLICY IF EXISTS "allow_authenticated_insert" ON public.fund_position_detail;
DROP POLICY IF EXISTS "allow_authenticated_select" ON public.fund_position_detail;
DROP POLICY IF EXISTS "fund_position_detail_select" ON public.fund_position_detail;
DROP POLICY IF EXISTS "fund_position_detail_insert" ON public.fund_position_detail;
DROP POLICY IF EXISTS "fund_position_detail_update" ON public.fund_position_detail;
DROP POLICY IF EXISTS "fund_position_detail_delete" ON public.fund_position_detail;

CREATE POLICY "fund_position_detail_select" ON public.fund_position_detail
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
    OR public.has_role(auth.uid(), 'user'::public.app_role)
  );

CREATE POLICY "fund_position_detail_insert" ON public.fund_position_detail
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "fund_position_detail_update" ON public.fund_position_detail
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "fund_position_detail_delete" ON public.fund_position_detail
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- ÉTAPE 9 : fund_position_hold
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_fund_position_hold" ON public.fund_position_hold;
DROP POLICY IF EXISTS "Allow authenticated users to insert fund_position_hold" ON public.fund_position_hold;
DROP POLICY IF EXISTS "Allow authenticated users to view fund_position_hold" ON public.fund_position_hold;
DROP POLICY IF EXISTS "allow_authenticated_insert" ON public.fund_position_hold;
DROP POLICY IF EXISTS "allow_authenticated_select" ON public.fund_position_hold;
DROP POLICY IF EXISTS "fund_position_hold_select" ON public.fund_position_hold;
DROP POLICY IF EXISTS "fund_position_hold_insert" ON public.fund_position_hold;
DROP POLICY IF EXISTS "fund_position_hold_update" ON public.fund_position_hold;
DROP POLICY IF EXISTS "fund_position_hold_delete" ON public.fund_position_hold;

CREATE POLICY "fund_position_hold_select" ON public.fund_position_hold
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
    OR public.has_role(auth.uid(), 'user'::public.app_role)
  );

CREATE POLICY "fund_position_hold_insert" ON public.fund_position_hold
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "fund_position_hold_update" ON public.fund_position_hold
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "fund_position_hold_delete" ON public.fund_position_hold
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- ÉTAPE 10 : impayes
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all_impayes" ON public.impayes;
DROP POLICY IF EXISTS "Allow authenticated users to insert impayes" ON public.impayes;
DROP POLICY IF EXISTS "Allow authenticated users to view impayes" ON public.impayes;
DROP POLICY IF EXISTS "allow_authenticated_insert" ON public.impayes;
DROP POLICY IF EXISTS "allow_authenticated_select" ON public.impayes;
DROP POLICY IF EXISTS "impayes_select" ON public.impayes;
DROP POLICY IF EXISTS "impayes_insert" ON public.impayes;
DROP POLICY IF EXISTS "impayes_update" ON public.impayes;
DROP POLICY IF EXISTS "impayes_delete" ON public.impayes;

CREATE POLICY "impayes_select" ON public.impayes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
    OR public.has_role(auth.uid(), 'user'::public.app_role)
  );

CREATE POLICY "impayes_insert" ON public.impayes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "impayes_update" ON public.impayes
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

CREATE POLICY "impayes_delete" ON public.impayes
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- ÉTAPE 11 : universal_bank_reports (correction SELECT orphelins)
-- ============================================================
DROP POLICY IF EXISTS "authenticated_view_bank_reports" ON public.universal_bank_reports;
DROP POLICY IF EXISTS "universal_bank_reports_select" ON public.universal_bank_reports;

CREATE POLICY "universal_bank_reports_select" ON public.universal_bank_reports
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

COMMIT;
