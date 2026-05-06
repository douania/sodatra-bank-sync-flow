# LOT-4A — Audit read-only des pipelines d'import et du code mort

Statut : **REPORT_ONLY** — aucune modification de `src/`, aucune suppression, aucune migration, aucun SQL, aucun changement RLS/auth/schéma.
Ne touche pas : `docs/DB_TRUTH.md`, DEF-10, DEF-14, DB-FREEZE-1B, `cold_shore`, `shiny_waterfall`, pipeline Excel.

Méthode : grep d'imports (`rg "from ['\"].*<service>"`) sur `src/`, recoupé avec les routes déclarées dans `src/App.tsx`. Un fichier n'est marqué ACTIF que s'il est atteignable depuis une route active. Sinon il est `A_VERIFIER` ou `ORPHELIN_PROBABLE`.

---

## A. Résumé exécutif

**Pipelines d'import réellement utilisés** (deux pipelines parallèles, divergence DEF-05 confirmée) :

- `/upload` → `fileProcessingService` → `extractionService`
- `/upload-bulk` → `enhancedFileProcessingService` → `extractionService` + `excelProcessingService` + `bankReportProcessingService` + `qualityControlEngine` + `intelligentSyncService` + `databaseService`
- `/document-understanding` → `enhancedFileProcessingService` + `bdkExtractionService` + `enhancedBDKExtractionService` + `positionalExtractionService`

**Fichiers critiques** : `extractionService.ts`, `enhancedFileProcessingService.ts`, `bdkExtractionService.ts`, `enhancedBDKExtractionService.ts`, `positionalExtractionService.ts`, `bdkColumnDetectionService.ts`, `excelProcessingService.ts`, `databaseService.ts`, `intelligentSyncService.ts`, `progressService.ts`, `qualityControlEngine.ts`, `bankingUniversalService.ts`.

**Orphelins probables (0 import entrant)** : `services/extractionService_PRODUCTION.ts`, `services/advancedExtractionService.ts`, `services/bankReportDetectionService.ts`, `services/batchProcessingService.ts`, `services/specializedMatchingService.ts`, `components/ProcessingResultsDetailed copy.tsx`.

**Mock / bannérisés** : `pages/Alerts.tsx`, `pages/ConsolidatedDashboard.tsx`. **Routés mais avec services réels** (à confirmer page par page) : `BankingDashboard`, `BankingReports`, `Reconciliation`, `QualityControl`.

**Risques** :
- Doublon `fileProcessingService` ↔ `enhancedFileProcessingService` (715 vs 820 lignes, mêmes imports de tête). Suppression aveugle de `fileProcessingService` casserait `/upload`.
- `bdkExtractionService` est protégé par mémoire core (extraction 7 colonnes BDK forcée) — aucune modification tolérée.
- `extractionService_PRODUCTION.ts` (328 lignes) ressemble à un fork de `extractionService.ts` (531 lignes) — preuve d'inutilisation à reconfirmer avant Lot 4B.

---

## B. Cartographie des dépendances

Légende statut : `ACTIF_CRITIQUE` / `ACTIF_A_CONSOLIDER` / `MOCK_BANNER` / `ORPHELIN_PROBABLE` / `NE_PAS_TOUCHER` / `A_VERIFIER`.

### Services

| Fichier | Statut | Importé par | Importe (principal) | Rôle | Recommandation |
|---|---|---|---|---|---|
| `services/extractionService.ts` | ACTIF_CRITIQUE | fileProcessingService, enhancedFileProcessingService (+ dyn imports) | — | Extracteurs `extractBankReport/FundPosition/ClientReconciliation` | NE PAS TOUCHER avant Lot 4D |
| `services/extractionService_PRODUCTION.ts` | ORPHELIN_PROBABLE | 0 | — | Fork apparent de extractionService | Candidat Lot 4B après second grep |
| `services/advancedExtractionService.ts` | ORPHELIN_PROBABLE | 0 | types/banking | Patterns regex multi-banques | Candidat Lot 4B |
| `services/fileProcessingService.ts` | ACTIF_A_CONSOLIDER | `pages/FileUpload.tsx` | extractionService, excelProcessingService, databaseService, intelligentSyncService, qualityControlEngine, supabaseClientService, progressService | Pipeline d'import legacy | Lot 4D : migrer `/upload` vers enhancedFileProcessingService |
| `services/enhancedFileProcessingService.ts` | ACTIF_CRITIQUE | `pages/FileUploadBulk.tsx`, `pages/DocumentUnderstanding.tsx`, `components/ProcessingResultsDetailed.tsx` (type), `components/ProcessingResultsDetailed copy.tsx` (type) | extractionService, excelProcessingService, databaseService, intelligentSyncService, qualityControlEngine, progressService, supabase, dyn(bankReportProcessingService) | Pipeline d'import courant | NE PAS TOUCHER hors Lot 4D |
| `services/bdkExtractionService.ts` | NE_PAS_TOUCHER | DocumentUnderstanding, UniversalBankParser, BDKDetailedReport, enhancedBDKExtractionService | — | Extraction BDK 7-colonnes (mémoire core) | Verrouillé par mémoire projet |
| `services/enhancedBDKExtractionService.ts` | ACTIF_CRITIQUE | DocumentUnderstanding | bdkExtractionService, positionalExtractionService | BDK enrichi | NE PAS TOUCHER |
| `services/positionalExtractionService.ts` | ACTIF_CRITIQUE | enhancedBDKExtractionService, bdkColumnDetectionService, BDKDebugPanel, BDKCalibrationInsights, DataViewer, ValidationMatrix, PositionalPDFViewer | — | Types `Column/TextItem/PositionalData` | NE PAS TOUCHER |
| `services/bdkColumnDetectionService.ts` | ACTIF_CRITIQUE | 7 fichiers | positionalExtractionService | Détection colonnes BDK | NE PAS TOUCHER |
| `services/bankReportProcessingService.ts` | ACTIF_CRITIQUE (dyn import) | enhancedFileProcessingService (dynamic) | — | Traitement rapports bancaires PDF | NE PAS TOUCHER |
| `services/bankReportDetectionService.ts` | ORPHELIN_PROBABLE | 0 (statique) | — | Détection type rapport | A_VERIFIER (peut être dyn import) avant Lot 4B |
| `services/bankReportSectionExtractor.ts` | ACTIF_CRITIQUE | 1 | — | Extraction sections | NE PAS TOUCHER |
| `services/bankingUniversalService.ts` | ACTIF_CRITIQUE | BankingDashboard + 4 autres | — | Service banking universel | NE PAS TOUCHER |
| `services/batchProcessingService.ts` | ORPHELIN_PROBABLE | 0 | — | Batch processing | A_VERIFIER avant Lot 4B |
| `services/specializedMatchingService.ts` | ORPHELIN_PROBABLE | 0 | — | Matching | A_VERIFIER avant Lot 4B |
| `services/excelProcessingService.ts` | ACTIF_CRITIQUE | 5 fichiers | — | Pipeline Excel | NE PAS TOUCHER (périmètre Excel verrouillé) |
| `services/excelMappingService.ts` | ACTIF_CRITIQUE | 2 | — | Mapping Excel | NE PAS TOUCHER |
| `services/intelligentSyncService.ts` | ACTIF_CRITIQUE | 4 (dont Reconciliation) | — | Sync UX-SYNC-COUNTERS | NE PAS TOUCHER (T2/T3 en attente) |
| `services/databaseService.ts` | ACTIF_CRITIQUE | 7 | — | Accès DB | NE PAS TOUCHER |
| `services/supabaseClientService.ts` | ACTIF_CRITIQUE | 3 | — | Retry/Heartbeat | NE PAS TOUCHER |
| `services/progressService.ts` | ACTIF_CRITIQUE | 6 | — | Progress UI | NE PAS TOUCHER |
| `services/progressPersistenceService.ts` | ACTIF_A_CONSOLIDER | 1 | — | Persistance progress | A_VERIFIER |
| `services/qualityControlEngine.ts` | ACTIF_CRITIQUE | 3 (QualityControl, pipelines) | — | Quality control | NE PAS TOUCHER |
| `services/columnClusteringService.ts` | ACTIF_A_CONSOLIDER | 1 | — | Clustering colonnes | A_VERIFIER |
| `services/crossBankAnalysisService.ts` | ACTIF_A_CONSOLIDER | 2 | — | Analyse cross-bank | A_VERIFIER |
| `services/dashboardMetricsService.ts` | ACTIF_A_CONSOLIDER | 2 | — | Métriques dashboard | A_VERIFIER |

### Composants

| Fichier | Statut | Importé par | Recommandation |
|---|---|---|---|
| `components/ProcessingResultsDetailed.tsx` | ACTIF_CRITIQUE | `/upload`, `/upload-bulk` | NE PAS TOUCHER |
| `components/ProcessingResultsDetailed copy.tsx` | ORPHELIN_PROBABLE | 0 | Candidat Lot 4B (duplicata évident, nom contient "copy") |
| `components/UniversalBankParser.tsx` | ACTIF_CRITIQUE | DocumentUnderstanding | NE PAS TOUCHER |
| `components/BDKDetailedReport.tsx` | ACTIF_CRITIQUE | DocumentUnderstanding | NE PAS TOUCHER |
| `components/PositionalPDFViewer.tsx` | ACTIF_CRITIQUE | DocumentUnderstanding | NE PAS TOUCHER |
| `components/BDKDebugPanel.tsx` | ORPHELIN_PROBABLE | 0 (depuis pages) | A_VERIFIER (composant debug — peut-être à réinstaller) |
| `components/BDKCalibrationInsights.tsx` | ORPHELIN_PROBABLE | 0 (depuis pages) | A_VERIFIER |
| `components/DataViewer.tsx` | ORPHELIN_PROBABLE | 0 (depuis pages) | A_VERIFIER |
| `components/ValidationMatrix.tsx` | ORPHELIN_PROBABLE | 0 (depuis pages) | A_VERIFIER |

### Pages routées

| Page | Route | Statut | Notes |
|---|---|---|---|
| `Index.tsx` | `/` | ACTIF_CRITIQUE | — |
| `Auth.tsx`, `ResetPassword.tsx` | `/auth`, `/reset-password` | ACTIF_CRITIQUE | — |
| `Dashboard.tsx` | `/dashboard` | A_VERIFIER | À auditer (lecture page non incluse en 4A) |
| `FileUpload.tsx` | `/upload` | ACTIF_A_CONSOLIDER | Voir section C |
| `FileUploadBulk.tsx` | `/upload-bulk` | ACTIF_CRITIQUE | Voir section D |
| `DocumentUnderstanding.tsx` | `/document-understanding` | ACTIF_CRITIQUE | Pipeline BDK |
| `ConsolidatedDashboard.tsx` | `/consolidated`, `/consolidated-dashboard` | MOCK_BANNER | Aucun service importé, bandeau warning. 2 routes pointent dessus. |
| `Alerts.tsx` | `/alerts` | MOCK_BANNER | Bandeau warning, aucun service |
| `BankingDashboard.tsx` | `/banking/dashboard` | A_VERIFIER | Importe `bankingUniversalService` réel + composants. **Pas mocké** malgré le wording du backlog. |
| `BankingReports.tsx` | `/banking/reports` | A_VERIFIER | Aucun service importé en tête, mais types/UI riches. Probable mock partiel. |
| `Reconciliation.tsx` | `/reconciliation` | A_VERIFIER | Importe `intelligentSyncService` (réel) + `BankReconciliationEngine`. Bandeau warning présent. Comportement à confirmer. |
| `QualityControl.tsx` | `/quality-control` | A_VERIFIER | Importe `qualityControlEngine`, `excelProcessingService`, `databaseService` (réels). **Pas mocké.** |
| `NotFound.tsx` | `*` | ACTIF_CRITIQUE | — |

---

## C. Analyse `/upload`

- Composant : `pages/FileUpload.tsx`
- Pipeline : `fileProcessingService.processFiles(files)` → `extractionService.extractBankReport/extractFundPosition/extractClientReconciliation`
- Affichage : `ProcessingResultsDetailed`
- Le typage `ProcessingResult` consommé par `ProcessingResultsDetailed` provient de `enhancedFileProcessingService` — **incohérence de typage** entre runtime (`fileProcessingService`) et UI (type d'`enhancedFileProcessingService`). À traiter en Lot 4D.
- 715 vs 820 lignes : `fileProcessingService` est probablement un sous-ensemble de `enhancedFileProcessingService` (mêmes 6 imports de tête, mêmes services dynamiques attendus). À diff-er finement avant fusion.

## D. Analyse `/upload-bulk`

- Composant : `pages/FileUploadBulk.tsx`
- Pipeline : `enhancedFileProcessingService.processFiles(files)` → `extractionService` + dyn imports `bankReportProcessingService`, `excelProcessingService`, `supabaseClientService` (Heartbeat, Retry), `pdfjs-dist`
- Affichage : `ProcessingResultsDetailed` (cohérent)
- Pipeline canonique. Sert de référence cible pour Lot 4D.

## E. Services PDF / BDK

- Pipeline BDK actif : `bdkExtractionService` + `enhancedBDKExtractionService` + `positionalExtractionService` + `bdkColumnDetectionService` + composants `UniversalBankParser`, `BDKDetailedReport`, `PositionalPDFViewer`. Tous atteignables depuis `/document-understanding`.
- **Mémoire core** : extraction 7 colonnes BDK forcée via `isBDKDocument()` ; aucun fallback. Aucune modification tolérée.
- `advancedExtractionService.ts` (regex multi-banques) : 0 import. Doublon conceptuel de `bankReportProcessingService` mais sans preuve d'utilisation actuelle.
- Composants debug BDK (`BDKDebugPanel`, `BDKCalibrationInsights`, `DataViewer`, `ValidationMatrix`) : import du service `positionalExtractionService` mais 0 import depuis pages → orphelins probables, mais utiles si on veut réactiver le debug. Décision Lot 4C.

## F. Pages mockées

- `Alerts.tsx`, `ConsolidatedDashboard.tsx` : **vrais mocks**, code court, bandeau warning, aucun service. Code mort potentiel : néant (bandeau seulement).
- `BankingDashboard.tsx`, `QualityControl.tsx` : **non mocks**, importent des services réels. Le wording du backlog "pages mockées" est inexact pour ces deux-là.
- `BankingReports.tsx`, `Reconciliation.tsx` : statut hybride (bandeau warning + imports partiels). À auditer page par page en Lot 4C.
- `/consolidated` et `/consolidated-dashboard` pointent tous deux sur `ConsolidatedDashboard.tsx` → doublon de route à clarifier.

## G. Proposition de micro-lots (rien d'exécuté)

### Lot 4B — Suppression code mort (preuve d'inutilisation requise)

Candidats avec **0 import entrant statique** :
- `src/services/extractionService_PRODUCTION.ts`
- `src/services/advancedExtractionService.ts`
- `src/components/ProcessingResultsDetailed copy.tsx`

Candidats `A_VERIFIER` (chercher dyn imports + références string) avant suppression :
- `src/services/bankReportDetectionService.ts`
- `src/services/batchProcessingService.ts`
- `src/services/specializedMatchingService.ts`

Critère GO Lot 4B : `rg -F "<basename>"` sur tout `src/` retourne 0 hit hors fichier lui-même, **et** build TypeScript vert après suppression.

### Lot 4C — Clarification pages mockées et routes

- Décider sort de `/consolidated` vs `/consolidated-dashboard` (doublon).
- Décider sort de `Alerts.tsx` (supprimer route, garder bandeau, ou implémenter).
- Auditer `BankingReports.tsx` et `Reconciliation.tsx` pour confirmer mock partiel ou actif.
- Décider sort des composants debug BDK (`BDKDebugPanel`, `BDKCalibrationInsights`, `DataViewer`, `ValidationMatrix`) : réintroduire dans `/document-understanding` ou supprimer.

### Lot 4D — Consolidation `fileProcessingService` ↔ `enhancedFileProcessingService` (DEF-05)

1. Diff ligne à ligne `fileProcessingService.ts` vs `enhancedFileProcessingService.ts`.
2. Vérifier que `enhancedFileProcessingService` couvre fonctionnellement le mode `/upload`.
3. Migrer `pages/FileUpload.tsx` vers `enhancedFileProcessingService` (1 ligne d'import + 1 appel).
4. Test runtime `/upload` (upload Excel + PDF, vérifier idempotence via `(excel_filename, excel_source_row)` — règle DB_TRUTH).
5. Supprimer `fileProcessingService.ts` uniquement après validation runtime + CTO.

Risque principal : régression silencieuse si `fileProcessingService` contient une branche métier absente de `enhancedFileProcessingService`. Diff obligatoire.

### Lot 4E — UX wording (différé)

Headers manquants / wording bandeaux mock. Hors périmètre code mort.

---

## Statuts à inscrire dans `STATUS_REGISTRY.md` (livrable séparé, pas dans ce rapport)

- `LOT-4A` : CLOSED (REPORT_ONLY)
- `LOT-4B` / `4C` / `4D` / `4E` : PROPOSED, awaiting CTO GO
- `LOT-4` global : reste ouvert, aucun changement code

## Rappel interdits permanents

- Pas de modification dans `src/`
- Pas de migration, pas de SQL, pas de RLS, pas d'auth, pas de schéma
- Pas de modification de `cold_shore` / `shiny_waterfall` / pipeline Excel
- Pas de réouverture Lot 1 / 2B / 3 / SEC-ENV-1 / DB-FREEZE-1A
- DB-FREEZE-1B reste différé jusqu'à staging
- DEF-10 et DEF-14 hors périmètre Lot 4A