
-- Désactiver temporairement RLS sur toutes les tables pour permettre l'insertion des données
ALTER TABLE public.bank_reports DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits_not_cleared DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_facilities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.impayes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_position DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_reconciliation DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_report DISABLE ROW LEVEL SECURITY;
