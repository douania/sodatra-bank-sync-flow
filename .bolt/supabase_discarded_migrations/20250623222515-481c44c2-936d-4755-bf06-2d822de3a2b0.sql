
-- Add missing date_of_validity column and other required fields to collection_report table
ALTER TABLE collection_report ADD COLUMN date_of_validity DATE;

-- Add other missing columns from the Excel structure
ALTER TABLE collection_report ADD COLUMN facture_no VARCHAR(50);
ALTER TABLE collection_report ADD COLUMN no_chq_bd VARCHAR(50);
ALTER TABLE collection_report ADD COLUMN bank_name_display VARCHAR(100);
ALTER TABLE collection_report ADD COLUMN depo_ref VARCHAR(50);
ALTER TABLE collection_report ADD COLUMN nj INTEGER;
ALTER TABLE collection_report ADD COLUMN taux DECIMAL(8,4);
ALTER TABLE collection_report ADD COLUMN interet DECIMAL(15,2);
ALTER TABLE collection_report ADD COLUMN commission DECIMAL(15,2);
ALTER TABLE collection_report ADD COLUMN tob DECIMAL(15,2);
ALTER TABLE collection_report ADD COLUMN frais_escompte DECIMAL(15,2);
ALTER TABLE collection_report ADD COLUMN bank_commission DECIMAL(15,2);
ALTER TABLE collection_report ADD COLUMN sg_or_fa_no VARCHAR(50);
ALTER TABLE collection_report ADD COLUMN d_n_amount DECIMAL(15,2);
ALTER TABLE collection_report ADD COLUMN income DECIMAL(15,2);
ALTER TABLE collection_report ADD COLUMN date_of_impay DATE;
ALTER TABLE collection_report ADD COLUMN reglement_impaye DATE;
ALTER TABLE collection_report ADD COLUMN remarques TEXT;
ALTER TABLE collection_report ADD COLUMN credited_date DATE;
ALTER TABLE collection_report ADD COLUMN processing_status VARCHAR(20) DEFAULT 'NEW';
ALTER TABLE collection_report ADD COLUMN matched_bank_deposit_id UUID;
ALTER TABLE collection_report ADD COLUMN match_confidence DECIMAL(3,2);
ALTER TABLE collection_report ADD COLUMN match_method VARCHAR(50);
ALTER TABLE collection_report ADD COLUMN processed_at TIMESTAMP;

-- Create optimized indexes for performance
CREATE INDEX idx_collection_report_date_of_validity ON collection_report(date_of_validity);
CREATE INDEX idx_collection_report_status_date ON collection_report(status, report_date);
CREATE INDEX idx_collection_report_facture ON collection_report(facture_no);
CREATE INDEX idx_collection_report_matching ON collection_report(bank_name, collection_amount, date_of_validity, status);

-- Add unique constraint to prevent duplicates
ALTER TABLE collection_report ADD CONSTRAINT unique_collection_entry 
UNIQUE(facture_no, report_date, bank_name, client_code);
