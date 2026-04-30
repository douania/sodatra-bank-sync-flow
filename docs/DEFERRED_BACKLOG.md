# DEFERRED BACKLOG — Bank Sync Flow

> Sujets reportés volontairement. Chaque entrée explique pourquoi le report, le risque, et le lot probable.

---

## Import Excel

### DEF-01 : Dates fallback "du jour" automatiques

**Fichier** : `src/services/excelMappingService.ts`
**Problème** : Quand une date est manquante ou invalide dans l'Excel, le service utilise `new Date()` comme fallback silencieux. Pour une application bancaire, cela crée des enregistrements avec des dates fausses.
**Risque** : Données bancaires datées incorrectement → rapprochements faux, reporting erroné.
**Raison du report** : Nécessite une décision métier sur le comportement correct (rejeter la ligne ? demander à l'utilisateur ?).
**Lot probable** : Lot 3

### DEF-02 : Math.trunc sur les montants

**Fichier** : `src/services/excelMappingService.ts`
**Problème** : Les montants sont tronqués avec `Math.trunc()`, supprimant les centimes.
**Risque** : Perte de précision financière. Écarts dans les rapprochements.
**Lot probable** : Lot 3

### DEF-03 : Math.random() pour traçabilité Excel

**Fichier** : `src/services/intelligentSyncService.ts`
**Problème** : Quand la traçabilité manque (`excel_filename`, `excel_source_row`), le service génère des valeurs aléatoires pour contourner les contraintes d'unicité.
**Risque** : Import non idempotent. Doublons possibles. Piste d'audit cassée.
**Lot probable** : Lot 3

### DEF-04 : Validation headers Excel

**Problème** : Aucune validation stricte des en-têtes de colonnes avant import. Un fichier avec des colonnes manquantes ou mal nommées est importé avec des valeurs nulles/par défaut.
**Risque** : Données corrompues silencieusement.
**Lot probable** : Lot 3

### DEF-05 : Pipelines d'import divergents

**Problème** : Plusieurs services d'extraction coexistent (`extractionService.ts`, `extractionService_PRODUCTION.ts`, `advancedExtractionService.ts`, `positionalExtractionService.ts`, `bdkExtractionService.ts`, `enhancedBDKExtractionService.ts`). Il n'est pas clair quel pipeline est réellement utilisé en production.
**Risque** : Comportement imprévisible selon le chemin d'exécution.
**Lot probable** : Lot 3 ou 4

---

## Rapprochement bancaire

### DEF-06 : Moteur de rapprochement fictif

**Fichier** : `src/components/BankReconciliationEngine.tsx`
**Problème** : Les résultats sont générés côté client avec `index % 3`, `index % 4`, `bank-tx-${index}`. Les boutons "Valider" / "Rejeter" modifient l'état React local sans persistance.
**Risque** : Aucune fonctionnalité réelle de rapprochement.
**Action Lot 1** : Retiré de la nav, bandeau ajouté.
**Lot probable** : Lot 4 ou projet dédié

---

## Nettoyage code

### DEF-07 : Pages mockées — code mort

**Fichiers** : `BankingDashboard.tsx`, `BankingReports.tsx`, `Alerts.tsx`, `ConsolidatedDashboard.tsx`
**Problème** : Le code mock reste dans les fichiers (derrière early return ou réécrit avec bandeau). Il devra être supprimé ou remplacé par de vraies connexions données.
**Lot probable** : Lot 4

### DEF-08 : Fichiers orphelins

**Fichiers** :
- `src/components/ProcessingResultsDetailed copy.tsx` — copie non nettoyée
- `src/services/extractionService_PRODUCTION.ts` — version alternative
- `src/components/ConsolidatedDashboard.tsx` — composant avec mock, non routé
**Lot probable** : Lot 4

### DEF-09 : Migrations historiques discardées

**Dossier** : `.bolt/supabase_discarded_migrations/` (16+ fichiers)
**Problème** : Migrations abandonnées qui encombrent le repo sans utilité.
**Risque** : Confusion. Certaines peuvent contenir des indices sur l'état réel du schéma.
**Lot probable** : Lot 4 (après audit schéma)

---

## Infrastructure

### DEF-10 : Transactionnalisation saveBankReport

**Problème** : L'enregistrement d'un rapport bancaire insère dans plusieurs tables (`bank_reports`, `bank_facilities`, `deposits_not_cleared`, `impayes`) sans transaction. Si une insertion échoue, les données sont partiellement sauvegardées.
**Risque** : Données incohérentes en base.
**Lot probable** : Lot 3 ou 5

### DEF-11 : Tests automatisés

**Problème** : Aucun test unitaire ou d'intégration.
**Risque** : Régressions non détectées à chaque modification.
**Lot probable** : Post Lot 4

### DEF-12 : Documentation utilisateur

**Problème** : Aucun guide utilisateur pour les opérations d'import, de consultation, d'interprétation des données.
**Lot probable** : Post Lot 4

### DEF-13 : Nettoyage imports inutilisés

**Problème** : Après le Lot 1, plusieurs fichiers ont des imports non utilisés (icônes, composants retirés). Non bloquant mais pollue le code.
**Lot probable** : Lot 4
