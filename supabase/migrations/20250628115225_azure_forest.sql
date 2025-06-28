/*
  # Optimisation des index pour collection_report

  1. Modifications
     - Suppression de l'index `idx_collection_excel_source` qui cause des conflits
     - Création d'un nouvel index unique `unique_excel_traceability` avec condition NOT NULL
     - Ajout d'un index sur client_code et report_date pour les recherches fréquentes
  
  2. Objectif
     - Résoudre les erreurs de clé dupliquée lors des imports
     - Permettre l'UPSERT basé sur la traçabilité Excel
     - Optimiser les requêtes de recherche par client et date
*/

-- Supprimer l'index problématique qui cause des conflits
DROP INDEX IF EXISTS idx_collection_excel_source;

-- Créer un nouvel index unique avec condition NOT NULL
-- Cela permet d'avoir des lignes avec excel_filename ou excel_source_row NULL
CREATE UNIQUE INDEX IF NOT EXISTS unique_excel_traceability 
ON collection_report (excel_filename, excel_source_row) 
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;

-- Ajouter un index pour les recherches fréquentes par client et date
CREATE INDEX IF NOT EXISTS idx_collection_client_date 
ON collection_report (client_code, report_date);

-- Ajouter un index pour les recherches par banque
CREATE INDEX IF NOT EXISTS idx_collection_bank 
ON collection_report (bank_name);