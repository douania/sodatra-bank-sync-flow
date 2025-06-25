
-- Étape 1 : Vider complètement la table collection_report pour repartir à zéro
DELETE FROM collection_report;

-- Étape 2 : Créer la contrainte unique manquante pour empêcher les doublons basés sur la traçabilité Excel
-- Cette contrainte garantira qu'une ligne Excel ne peut être insérée qu'une seule fois
ALTER TABLE collection_report 
DROP CONSTRAINT IF EXISTS idx_collection_excel_source;

-- Créer une nouvelle contrainte unique plus stricte
CREATE UNIQUE INDEX unique_excel_traceability 
ON collection_report (excel_filename, excel_source_row) 
WHERE excel_filename IS NOT NULL AND excel_source_row IS NOT NULL;

-- Ajouter également une contrainte pour empêcher les valeurs NULL dans ces champs critiques
-- (optionnel mais recommandé pour la traçabilité)
ALTER TABLE collection_report 
ADD CONSTRAINT check_excel_traceability_not_null 
CHECK (
  (excel_filename IS NOT NULL AND excel_source_row IS NOT NULL) 
  OR 
  (excel_filename IS NULL AND excel_source_row IS NULL)
);
