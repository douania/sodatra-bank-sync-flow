# LOT-4D.0 — Audit read-only fusion pipelines `/upload` et `/upload-bulk`

Statut : **REPORT_ONLY** — aucun src/ modifié, aucune suppression, aucune modification de `STATUS_REGISTRY.md` / `DEFERRED_BACKLOG.md` / `DB_TRUTH.md` / `LOT4A_PIPELINES_AUDIT.md` / `LOT4C*` / `LOT4B*`. Aucun SQL, aucune migration, aucune RLS/auth/schéma. UX-SYNC-COUNTERS T2/T3, DEF-10, DEF-14 non traités.

## A. Résumé exécutif

Deux pipelines parallèles confirmés (DEF-05 OPEN). **Les deux interfaces `ProcessingResult` sont strictement identiques** (vérification `python3` lignes 11-22 → IDENTIQUES). `enhancedFileProcessingService` est **fonctionnellement sur-ensemble** de `fileProcessingService` : même structure d'orchestration, plus `detectFileType()`, `processFilesArray()`, `processOrganizedFiles()`, et appels `qualityControlEngine`. **Recommandation : fusion progressive en 3 micro-lots, pas une migration sèche.**

## B. Cartographie

### B.1 — Pipeline `/upload`

```text
FileUpload.tsx (302 L)
  ├─ détection locale detectFileType() [tags BDK/ATB/BICIS/ORA/SGBS/BIS + Collection/Fund/Client]
  ├─ progressService.reset()
  └─ fileProcessingService.processFiles(File[])
       ├─ HeartbeatService.start()
       ├─ progressService (8 étapes : file_detection → excel_processing → intelligent_analysis → intelligent_sync → bank_analysis → fund_position → client_reconciliation → completion)
       ├─ excelProcessingService.processCollectionReportExcel
       ├─ intelligentSyncService.analyzeExcelFile + processIntelligentSync (par batch)
       ├─ bankReportProcessingService.processBankReportExcel (PDF bancaires)
       ├─ databaseService.saveBankReport
       ├─ extractFundPosition / extractClientReconciliation (dyn import)
       └─ ProcessingResult { success, data, errors, debugInfo }

UI résultat : ProcessingResultsDetailed (importe ProcessingResult depuis enhancedFileProcessingService — interfaces identiques, compatibilité accidentelle)
```

### B.2 — Pipeline `/upload-bulk`

```text
FileUploadBulk.tsx (376 L)
  ├─ détection locale detectFileType() [confidence high/medium/low + collectionReport/<bank>_analysis/<bank>_statement/fundsPosition/clientReconciliation]
  ├─ progressService.reset()
  └─ enhancedFileProcessingService.processFilesArray(File[])
       ├─ progressService (file_detection + processOrganizedFiles : excel_processing → intelligent_analysis → intelligent_sync → bank_analysis → fund_position → client_reconciliation)
       ├─ detectFileType (interne, plus riche)
       ├─ excelProcessingService.processCollectionReportExcel
       ├─ intelligentSyncService.analyzeExcelFile + processIntelligentSync (mode direct, pas batch)
       ├─ bankReportProcessingService.processBankReportExcel
       ├─ qualityControlEngine.* (présent uniquement dans enhanced)
       ├─ extractFundPosition / extractClientReconciliation (dyn import)
       └─ ProcessingResult { success, data, errors, debugInfo } — identique fileProcessingService

UI résultat : ProcessingResultsDetailed (canonique)
```

## C. Tableau comparatif

| Critère | `fileProcessingService` (715 L) | `enhancedFileProcessingService` (820 L) |
|---|---|---|
| Méthode publique principale | `processFiles(File[])` | `processFilesArray(File[])` + alias `processFiles({[key]:File})` |
| Interface `ProcessingResult` | identique | identique |
| `FileDetectionResult` exporté | ❌ | ✅ |
| `detectFileType()` interne | ❌ (pas de classification interne, repose sur appelant) | ✅ (riche, par patterns + extension) |
| Étapes `progressService` | 8 étapes nommées + HeartbeatService.start/stop | ~7 étapes équivalentes, **pas de HeartbeatService** |
| HeartbeatService | ✅ (start L.50, stop L.268, L.280) | ❌ |
| Sync intelligent par batch | ✅ (batchProcessingService dyn import L.143) | ❌ (sync direct L.371-375) |
| `qualityControlEngine.*` appels runtime | importé mais 0 usage | importé, usage runtime |
| `excelProcessingService` | ✅ | ✅ |
| `bankReportProcessingService` | ✅ (dyn) | ✅ (dyn) |
| `intelligentSyncService` | ✅ (batch) | ✅ (direct) |
| `databaseService.saveBankReport` | ✅ explicite | ✅ explicite |
| `extractFundPosition` | dyn import | dyn import |
| `extractClientReconciliation` | dyn import | dyn import |
| Importe `XLSX` direct | ❌ (dyn import L.693) | ✅ statique L.9 |
| Lignes | 715 | 820 |
| Consommateurs UI | `FileUpload.tsx` | `FileUploadBulk.tsx`, `IntelligentSyncManager` (indirect via `intelligentSyncService`), `ProcessingResultsDetailed` (type) |

## D. Réponses aux questions CTO

1. **Pipeline `/upload`** : `FileUpload → fileProcessingService.processFiles → {excel, intelligentSync batch, bankReport, fund, client} → ProcessingResult`.
2. **Pipeline `/upload-bulk`** : `FileUploadBulk → enhancedFileProcessingService.processFilesArray → detectFileType → processOrganizedFiles → {excel, intelligentSync direct, bankReport, qualityControl, fund, client} → ProcessingResult`.
3. **Communes** : `progressService`, `excelProcessingService`, `bankReportProcessingService`, `intelligentSyncService`, `databaseService.saveBankReport`, `extractionService.{extractFundPosition,extractClientReconciliation}`, interface `ProcessingResult`.
4. **Divergent** : (a) détection type fichier (locale FileUpload vs interne enhanced), (b) `HeartbeatService` (uniquement file), (c) sync batch vs direct, (d) `qualityControlEngine` (uniquement enhanced runtime), (e) import XLSX (statique vs dyn), (f) wrapping `processFiles` map vs array.
5. **Plus fiable / canonique** : `enhancedFileProcessingService`. Détection plus structurée, intégration QC, type `FileDetectionResult`, importé par `ProcessingResultsDetailed`. **Mais** moins robuste sur (a) HeartbeatService anti-timeout Supabase, (b) batching pour gros fichiers Collection.
6. **Remplacement direct ?** **NON, pas en l'état.** Risques :
   - `HeartbeatService` absent ⇒ risque de timeout Supabase sur gros fichiers (régression silencieuse).
   - Sync direct (non-batch) ⇒ risque OOM ou timeout sur COLLECTION REPORT-2026.xlsx volumineux.
   - Aucun test e2e couvre `/upload` ⇒ régression non détectable automatiquement.
7. **`ProcessingResultsDetailed` compatible avec les deux ?** Oui par accident structurel. Importe `ProcessingResult` depuis `enhancedFileProcessingService` mais l'interface est strictement identique à celle de `fileProcessingService` ⇒ TS accepte. Risque : si une des deux interfaces évolue indépendamment, rupture silencieuse.
8. **UX-SYNC-COUNTERS dans chaque pipeline** :
   - `fileProcessingService` : émet `intelligent_sync` step avec `processedItems`, mais pas de compteur explicite T2/T3 documenté ici. À confirmer sur Excel du jour.
   - `enhancedFileProcessingService` : émet aussi `intelligent_sync` step, mode direct ⇒ compteurs cumulés batch potentiellement absents. UX-SYNC-COUNTERS reste OPEN.
9. **Risques régression COLLECTION REPORT-2026.xlsx** :
   - **Élevé** si on bascule `/upload` vers `enhanced` : perte du batch + perte du HeartbeatService.
   - **Faible** si on conserve `fileProcessingService` et on aligne uniquement la détection / les types.
10. **Plan chirurgical recommandé** : voir §F.

## E. Risques de fusion

| Risque | Sévérité | Mitigation |
|---|---|---|
| Timeout Supabase sur `/upload` après bascule (perte HeartbeatService) | Haute | Reporter HeartbeatService dans `enhanced` AVANT bascule |
| OOM/timeout sur gros Collection (perte batch) | Haute | Reporter `BatchProcessingService` dans `enhanced` AVANT bascule |
| Divergence interface `ProcessingResult` future | Moyenne | Extraire `ProcessingResult` dans `src/types/banking.ts` partagé |
| Régression UX-SYNC-COUNTERS | Moyenne | Audit T2/T3 sur Excel du jour avant tout patch |
| Casser `IntelligentSyncManager` (UI manuelle Reconciliation) | Faible | Ne touche que les services, pas le composant |
| Perte `qualityControlEngine` si on garde `fileProcessingService` canonique | Moyenne | Ajouter QC dans `fileProcessingService` |

## F. Recommandation CTO — proposition de micro-lots

### Lot 4D.1 — Convergence interface (READ + petite extraction de type)
- Extraire `ProcessingResult` (et `FileDetectionResult`) dans `src/types/processing.ts` (nouveau fichier).
- Faire pointer `fileProcessingService`, `enhancedFileProcessingService`, `ProcessingResultsDetailed` vers ce type partagé.
- 0 changement de logique, build vert, périmètre minimal (~3 fichiers + 1 nouveau).
- **Préalable obligatoire** avant toute fusion.

### Lot 4D.2 — Convergence robustesse (parité fonctionnelle)
- Reporter `HeartbeatService.start/stop` dans `enhancedFileProcessingService.processFilesArray`.
- Reporter le mode batch (`BatchProcessingService` dyn import) dans `enhancedFileProcessingService` quand `analysisResult.length > seuil`.
- Aucun changement côté `/upload` ni `/upload-bulk` UI.
- Test manuel obligatoire : upload `COLLECTION REPORT-2026.xlsx` via `/upload-bulk` post-patch.

### Lot 4D.3 — Bascule `/upload` vers `enhanced` (uniquement après 4D.1 + 4D.2 verts)
- Patcher `src/pages/FileUpload.tsx` : remplacer import + appel `fileProcessingService.processFiles` par `enhancedFileProcessingService.processFilesArray`.
- Conserver `fileProcessingService.ts` **temporairement** (zéro suppression) pour rollback rapide.
- Test manuel obligatoire des deux pages.

### Lot 4D.4 — Suppression `fileProcessingService.ts` (uniquement après 4D.3 stabilisé ≥ 1 cycle)
- `rg "fileProcessingService"` → 0 résultat.
- Suppression sèche.
- DEF-05 → CLOSED.

### Alternative — Gel temporaire
Si la priorité passe à un autre chantier (sécurité, DB, UX), **option valide** : geler 4D, garder les deux pipelines, maintenir DEF-05 OPEN. Coût : duplication ~715 L. Pas de risque immédiat.

**Préférence CTO recommandée** : **Lot 4D.1 immédiatement** (extraction type partagé, périmètre ridicule, 0 risque). Ensuite arbitrer entre 4D.2 et gel.

## G. Interdits respectés

- Aucun fichier `src/` modifié.
- Aucune suppression effectuée.
- Aucune fusion effectuée.
- `fileProcessingService`, `enhancedFileProcessingService`, `intelligentSyncService`, `excelMappingService`, `excelProcessingService`, `ProcessingResultsDetailed` non touchés.
- `STATUS_REGISTRY.md`, `DEFERRED_BACKLOG.md` non modifiés.
- Aucun SQL, aucune migration, aucune RLS/auth/schéma.
- Lot 4D.1 non ouvert (proposé seulement).

## H. Statut

- **LOT-4D.0 = CLOSED / REPORT_ONLY**
- **LOT-4D.1, 4D.2, 4D.3, 4D.4 = proposés, non ouverts**
- **DEF-05 = OPEN inchangé** (sera CLOSED par 4D.4)
- **DEF-07 = CLOSED** (périmètre initial atteint, voir LOT4C_FINAL)
- **UX-SYNC-COUNTERS T2/T3 = OPEN inchangé** (à mesurer pendant 4D.2)
