-- Corriger les policies RLS et activer RLS sur toutes les tables manquantes

-- Activer RLS sur les tables manquantes
ALTER TABLE public.bank_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits_not_cleared ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impayes ENABLE ROW LEVEL SECURITY;

-- Corriger la policy bank_audit_access pour éviter les références à auth.users
DROP POLICY IF EXISTS "bank_audit_access" ON public.bank_audit_log;
CREATE POLICY "bank_audit_access" 
ON public.bank_audit_log 
FOR SELECT 
TO authenticated
USING (auth.uid() IS NOT NULL);

-- Corriger la policy bank_reports_access pour éviter les références à auth.users
DROP POLICY IF EXISTS "bank_reports_access" ON public.universal_bank_reports;
CREATE POLICY "bank_reports_access" 
ON public.universal_bank_reports 
FOR ALL 
TO authenticated
USING (auth.uid() = user_id OR auth.uid() IS NOT NULL);

-- Ajouter des policies basiques pour les nouvelles tables
CREATE POLICY "allow_authenticated_select" ON public.bank_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "allow_authenticated_insert" ON public.bank_reports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "allow_authenticated_update" ON public.bank_reports FOR UPDATE TO authenticated USING (true);

CREATE POLICY "allow_authenticated_select" ON public.bank_facilities FOR SELECT TO authenticated USING (true);
CREATE POLICY "allow_authenticated_insert" ON public.bank_facilities FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "allow_authenticated_select" ON public.deposits_not_cleared FOR SELECT TO authenticated USING (true);
CREATE POLICY "allow_authenticated_insert" ON public.deposits_not_cleared FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "allow_authenticated_select" ON public.fund_position FOR SELECT TO authenticated USING (true);
CREATE POLICY "allow_authenticated_insert" ON public.fund_position FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "allow_authenticated_select" ON public.fund_position_detail FOR SELECT TO authenticated USING (true);
CREATE POLICY "allow_authenticated_insert" ON public.fund_position_detail FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "allow_authenticated_select" ON public.fund_position_hold FOR SELECT TO authenticated USING (true);
CREATE POLICY "allow_authenticated_insert" ON public.fund_position_hold FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "allow_authenticated_select" ON public.impayes FOR SELECT TO authenticated USING (true);
CREATE POLICY "allow_authenticated_insert" ON public.impayes FOR INSERT TO authenticated WITH CHECK (true);

-- Corriger les fonctions pour le search_path
ALTER FUNCTION public.clean_client_name(text, text) SET search_path = public;
ALTER FUNCTION public.detect_collection_type() SET search_path = public;
ALTER FUNCTION public.update_client_reconciliation_names() SET search_path = public;