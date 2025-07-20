
-- Tables spécialisées pour le système bancaire universel
CREATE TABLE universal_bank_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name TEXT NOT NULL, -- BDK, SGS, BICIS, ATB, ORA, BIS
  report_date DATE NOT NULL,
  raw_data JSONB NOT NULL, -- Données extraites du PDF
  processed_data JSONB NOT NULL, -- RapportBancaire structuré
  checksum TEXT NOT NULL, -- Pour détecter les modifications
  parser_version TEXT DEFAULT '1.0.0',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id),
  UNIQUE(bank_name, report_date, checksum)
);

CREATE TABLE bank_evolution_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name TEXT NOT NULL,
  report_date DATE NOT NULL,
  evolution_type TEXT NOT NULL, -- 'cheque_debite', 'depot_credite', 'nouvel_impaye'
  reference TEXT, -- Numéro chèque, référence dépôt
  amount DECIMAL(15,2),
  description TEXT,
  previous_status TEXT,
  current_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE bank_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  bank_name TEXT,
  report_date DATE,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS pour sécuriser les données bancaires
ALTER TABLE universal_bank_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_evolution_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_audit_log ENABLE ROW LEVEL SECURITY;

-- Politiques d'accès strictes
CREATE POLICY "bank_reports_access" ON universal_bank_reports
FOR ALL USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = auth.uid() 
      AND raw_user_meta_data->>'role' IN ('admin', 'finance_manager', 'bank_operator')
    )
  )
);

CREATE POLICY "bank_evolution_access" ON bank_evolution_tracking
FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "bank_audit_access" ON bank_audit_log
FOR SELECT USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = auth.uid() 
      AND raw_user_meta_data->>'role' = 'admin'
    )
  )
);

-- Index pour optimiser les performances
CREATE INDEX idx_universal_bank_reports_bank_date ON universal_bank_reports(bank_name, report_date);
CREATE INDEX idx_universal_bank_reports_date ON universal_bank_reports(report_date DESC);
CREATE INDEX idx_bank_evolution_bank_date ON bank_evolution_tracking(bank_name, report_date);
CREATE INDEX idx_bank_evolution_type ON bank_evolution_tracking(evolution_type);
CREATE INDEX idx_bank_audit_user_date ON bank_audit_log(user_id, created_at DESC);
