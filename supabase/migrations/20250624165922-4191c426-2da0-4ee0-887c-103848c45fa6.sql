
-- Vider complètement la table collection_report pour repartir avec la nouvelle logique de traçabilité
DELETE FROM collection_report;

-- Optionnel: Réinitialiser la séquence si nécessaire (pas applicable ici car on utilise des UUID)
-- Mais on peut vérifier que la table est bien vide
SELECT COUNT(*) as remaining_records FROM collection_report;
