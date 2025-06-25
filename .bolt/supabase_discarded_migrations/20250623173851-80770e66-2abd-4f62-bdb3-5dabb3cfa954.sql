
-- Tables pour les rapports bancaires selon le guide d'implémentation
CREATE TABLE bank_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_name TEXT NOT NULL,
  report_date DATE NOT NULL,
  opening_balance BIGINT NOT NULL,
  closing_balance BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour les dépôts non crédités
CREATE TABLE deposits_not_cleared (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_report_id UUID REFERENCES bank_reports(id) ON DELETE CASCADE,
  date_depot DATE NOT NULL,
  date_valeur DATE,
  type_reglement TEXT NOT NULL,
  client_code TEXT,
  reference TEXT,
  montant BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour les facilités bancaires
CREATE TABLE bank_facilities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_report_id UUID REFERENCES bank_reports(id) ON DELETE CASCADE,
  facility_type TEXT NOT NULL,
  limit_amount BIGINT NOT NULL,
  used_amount BIGINT NOT NULL,
  available_amount BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour les impayés
CREATE TABLE impayes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_report_id UUID REFERENCES bank_reports(id) ON DELETE CASCADE,
  date_echeance DATE NOT NULL,
  date_retour DATE,
  client_code TEXT NOT NULL,
  description TEXT,
  montant BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour Fund Position
CREATE TABLE fund_position (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date DATE NOT NULL,
  total_fund_available BIGINT NOT NULL,
  collections_not_deposited BIGINT NOT NULL,
  grand_total BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour Client Reconciliation
CREATE TABLE client_reconciliation (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date DATE NOT NULL,
  client_code TEXT NOT NULL,
  client_name TEXT,
  impayes_amount BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour Collection Report
CREATE TABLE collection_report (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date DATE NOT NULL,
  client_code TEXT NOT NULL,
  collection_amount BIGINT NOT NULL,
  bank_name TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour optimiser les requêtes
CREATE INDEX idx_bank_reports_date ON bank_reports(report_date);
CREATE INDEX idx_bank_reports_bank ON bank_reports(bank_name);
CREATE INDEX idx_client_reconciliation_date ON client_reconciliation(report_date);
CREATE INDEX idx_fund_position_date ON fund_position(report_date);

-- RLS policies pour sécuriser les données
ALTER TABLE bank_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits_not_cleared ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE impayes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_report ENABLE ROW LEVEL SECURITY;

-- Policies pour permettre l'accès aux utilisateurs authentifiés
CREATE POLICY "Allow authenticated users to view bank_reports" ON bank_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert bank_reports" ON bank_reports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update bank_reports" ON bank_reports FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to view deposits_not_cleared" ON deposits_not_cleared FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert deposits_not_cleared" ON deposits_not_cleared FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to view bank_facilities" ON bank_facilities FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert bank_facilities" ON bank_facilities FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to view impayes" ON impayes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert impayes" ON impayes FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to view fund_position" ON fund_position FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert fund_position" ON fund_position FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to view client_reconciliation" ON client_reconciliation FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert client_reconciliation" ON client_reconciliation FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to view collection_report" ON collection_report FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert collection_report" ON collection_report FOR INSERT TO authenticated WITH CHECK (true);
