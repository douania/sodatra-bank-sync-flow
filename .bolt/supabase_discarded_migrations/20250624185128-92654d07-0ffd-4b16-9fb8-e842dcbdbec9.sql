
-- Modifier le type de la colonne collection_amount pour accepter les décimales
ALTER TABLE collection_report 
ALTER COLUMN collection_amount TYPE numeric;

-- Vérifier le changement
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'collection_report' 
AND column_name = 'collection_amount';
