
-- Ajouter les champs de traçabilité Excel à la table collection_report
ALTER TABLE collection_report 
ADD COLUMN excel_source_row integer,
ADD COLUMN excel_filename text,
ADD COLUMN excel_processed_at timestamp with time zone DEFAULT now();

-- Créer un index unique pour empêcher les doublons basés sur le fichier source et la ligne
CREATE UNIQUE INDEX idx_collection_excel_source 
ON collection_report (excel_filename, excel_source_row) 
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;

-- Créer un index pour optimiser les requêtes de vérification
CREATE INDEX idx_collection_excel_filename ON collection_report (excel_filename);
