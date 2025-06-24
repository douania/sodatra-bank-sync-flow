
-- Supprimer toutes les collections partielles du fichier COLLECTION REPORT-2025.xlsx
DELETE FROM collection_report 
WHERE excel_filename = 'COLLECTION REPORT-2025.xlsx';

-- Vérifier que toutes les collections ont été supprimées
SELECT COUNT(*) as collections_restantes 
FROM collection_report 
WHERE excel_filename = 'COLLECTION REPORT-2025.xlsx';
