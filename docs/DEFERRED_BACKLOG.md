# DEFERRED BACKLOG — Bank Sync Flow

> Sujets reportés volontairement. Chaque entrée explique pourquoi le report, le risque, et le lot probable.

---

## Import Excel

### DEF-01 : Dates fallback "du jour" automatiques

**Fichier** : `src/services/excelMappingService.ts`
**Problème** : Quand une date est manquante ou invalide dans l'Excel, le service utilise `new Date()` comme fallback silencieux. Pour une application bancaire, cela crée des enregistrements avec des dates fausses.
**Risque** : Données bancaires datées incorrectement → rapprochements faux, reporting erroné.
**Raison du report** : Nécessite une décision métier sur le comportement correct (rejeter la ligne ? demander à l'utilisateur ?).
**Lot probable** : Lot 3 — **traité dans Lot 3B.2** (`IN_PROGRESS` depuis 2026-05-04, voir STATUS_REGISTRY)

### DEF-02 : Math.trunc sur les montants

**Fichier** : `src/services/excelMappingService.ts`
**Problème** : Les montants sont tronqués avec `Math.trunc()`, supprimant les centimes.
**Risque** : Perte de précision financière. Écarts dans les rapprochements.
**Lot probable** : Lot 3 — **traité dans Lot 3B.4** (`IN_PROGRESS` depuis 2026-05-04). Règle métier validée CTO : décimales nulles (`100000.00`) acceptées sur champs `bigint`, décimales significatives rejetées explicitement, décimales conservées sur champs `numeric` (`taux`, `interet`, `commission`, `tob`, `frais_escompte`, `bank_commission`, `nj`, `d_n_amount`, `income`).

### DEF-03 : Math.random() pour traçabilité Excel

**Fichier** : `src/services/intelligentSyncService.ts`
**Problème** : Quand la traçabilité manque (`excel_filename`, `excel_source_row`), le service génère des valeurs aléatoires pour contourner les contraintes d'unicité.
**Risque** : Import non idempotent. Doublons possibles. Piste d'audit cassée.
**Précisions Lot 3A** : fallbacks confirmés `IMPORT_<date>` + `Math.floor(Math.random()*1_000_000)` (L. 415-416), `Date.now()` + `Math.random()` en fallback ultime de conflit (L. 543-545), `excelMappingService` L. 104-105 (`UNKNOWN_FILE` / `0`).
**Lot probable** : Lot 3 — **traité en priorité dans Lot 3B.1** (`IN_PROGRESS` depuis 2026-05-04, prochain micro-patch après 3B.0).

### DEF-04 : Validation headers Excel

**Problème** : Aucune validation stricte des en-têtes de colonnes avant import. Un fichier avec des colonnes manquantes ou mal nommées est importé avec des valeurs nulles/par défaut.
**Risque** : Données corrompues silencieusement.
**Lot probable** : Lot 3 — **traité dans Lot 3B.3** (`IN_PROGRESS` depuis 2026-05-04). Matrice headers obligatoires/optionnels à confirmer métier avant patch.

### DEF-05 : Pipelines d'import divergents

**Problème** : Plusieurs services d'extraction coexistent (`extractionService.ts`, `extractionService_PRODUCTION.ts`, `advancedExtractionService.ts`, `positionalExtractionService.ts`, `bdkExtractionService.ts`, `enhancedBDKExtractionService.ts`). Il n'est pas clair quel pipeline est réellement utilisé en production.
**Précisions Lot 3A** : services PDF/BDK (extraction) confirmés **hors pipeline Excel**. Les pipelines Excel actifs sont `fileProcessingService` (FileUpload) et `enhancedFileProcessingService` (FileUploadBulk), redondants à ~90 %.
**Risque** : Comportement imprévisible selon le chemin d'exécution.
**Lot probable** : Lot 4 (fusion `fileProcessingService` / `enhancedFileProcessingService`, suppression services PDF orphelins)

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
**Précisions Lot 3A** : confirmé pour `databaseService.saveBankReport` (4 inserts séquentiels : `bank_reports`, `bank_facilities`, `deposits_not_cleared`, `impayes`) et `saveFundPosition` (3 tables liées). `safeValue()` L. 640 utilise aussi `Math.floor(Math.abs(...))` qui supprime le signe.
**Lot probable** : Lot 5 (refonte via RPC Supabase `SECURITY DEFINER`). **Hors scope Lot 3B** — ne pas traiter par micro-patch chirurgical.

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
