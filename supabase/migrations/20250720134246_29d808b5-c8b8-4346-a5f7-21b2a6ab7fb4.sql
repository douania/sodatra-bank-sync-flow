-- Corriger les policies pour permettre l'usage sans authentification

-- Policy pour bank_audit_log - permettre INSERT/SELECT pour les utilisateurs non authentifiés
DROP POLICY IF EXISTS "bank_audit_access" ON public.bank_audit_log;
CREATE POLICY "allow_all_access" 
ON public.bank_audit_log 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Policy pour universal_bank_reports - permettre l'usage sans authentification
DROP POLICY IF EXISTS "bank_reports_access" ON public.universal_bank_reports;
CREATE POLICY "allow_all_bank_reports" 
ON public.universal_bank_reports 
FOR ALL 
USING (true)
WITH CHECK (true);