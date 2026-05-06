# LOT-4D.2.0 — Audit batch-safety `enhancedFileProcessingService`

**Mode** : READ-ONLY / REPORT_ONLY. Aucun fichier `src/` modifié, aucun `STATUS_REGISTRY` / `DEFERRED_BACKLOG` / `DB_TRUTH` touché.

**Date** : 2026-05-06.

---

## A. Diagnostic du batch actuel dans `fileProcessingService`

**Localisation** : `src/services/fileProcessingService.ts` L113-176.

**Séquence exacte** :
1. **Phase analyse globale** (L117-121) — `intelligentSyncService.analyzeExcelFile(allCollections)` est appelé **une fois sur la totalité** via `SupabaseRetryService.executeWithRetry` (3 retries). Résultat : `analysisResult` (uniquement utilisé pour les logs et les compteurs `NEW`/`EXISTS_INCOMPLETE` du `progressService`).
2. **Phase synchro batch** (L132-148) — `BatchProcessingService.processCollectionsBatch(allCollections, async (batch) => { ... }, { batchSize: 50, pauseBetweenBatchesMs: 300, enableProgressTracking: true }, 'intelligent_sync')`.
3. **Dans le processor de chaque batch** (L137-140) :
   - `batchAnalysis = await intelligentSyncService.analyzeExcelFile(batch)` — re-analyse sur le **sous-ensemble** uniquement (50 lignes).
   - `return await intelligentSyncService.processIntelligentSync(batchAnalysis)` — sync ce sous-ensemble.
4. **Agrégation** (L151) — `this.aggregateBatchResults(batchSyncResult.results)`.

**Seuil batch** : **inconditionnel**. Pas de seuil, tout fichier passe par le batch dès qu'il y a `> 0` collection. `batchSize=50` codé en dur.

**Note importante** : la phase 1 (analyse globale) **n'est utilisée que pour les logs** — le résultat sync définitif vient des batches L137-140. Donc la version "globale" est essentiellement décorative.

## B. Diagnostic de l'absence de batch dans `enhancedFileProcessingService`

**Localisation** : `src/services/enhancedFileProcessingService.ts` L353-358.

**Séquence exacte** :
1. `analysisResult = await intelligentSyncService.analyzeExcelFile(excelResult.data)` — appel **direct, fichier entier**.
2. `syncResult = await intelligentSyncService.processIntelligentSync(analysisResult)` — appel **direct, fichier entier**.
3. Aucun `BatchProcessingService`, aucun `SupabaseRetryService` autour. Aucune pause inter-batch.

**Conséquence** : sur `COLLECTION REPORT-2026.xlsx` (~5000 lignes), la totalité passe en une seule transaction logique. Risques :
- Timeout Supabase (REST/PostgREST limites).
- OOM côté navigateur lors de la construction du tableau d'opérations.
- Aucune granularité de retry — si la ligne 4500 échoue, tout est perdu.

## C. Analyse des compteurs UX-SYNC-COUNTERS en batch

**Source compteurs** : `intelligentSyncService.SyncResult` (L29-44) :
```ts
{ new_collections, idempotent_updates, enriched_collections, ignored_collections,
  errors[], summary: { total_processed, enrichments: { ... } } }
```

**Agrégation `aggregateBatchResults`** (`fileProcessingService.ts` L478-519) :

| Champ | Agrégation | Statut |
|---|---|---|
| `new_collections` | `+=` | OK |
| `idempotent_updates` | `+=` | OK |
| `enriched_collections` | `+=` | OK |
| `ignored_collections` | `+=` | OK |
| `errors[]` | `push(...)` | OK |
| `summary.enrichments.*` | `+=` (4 sous-champs) | OK |
| **`summary.total_processed`** | **NON AGRÉGÉ** | **BUG mineur existant** |

**Conclusion C** : les 4 compteurs UX-SYNC-COUNTERS critiques (T1=new, T2=idempotent, T3=enriched, T4=ignored) sont correctement sommés. Seul `summary.total_processed` est **silencieusement perdu** dans la version legacy — `ProcessingResultsDetailed` ne l'affiche pas, donc impact UX nul, mais à corriger un jour.

## D. Risques de double comptage / double update

**Question pivot** : `analyzeExcelFile(batch)` voit-elle uniquement le batch ou aussi la BD existante ?

**Réponse** (`intelligentSyncService.ts` L165-196 → `batchLoadExistingCollections`) :
> `select('*') from collection_report` **sans filtre**. Charge **TOUTES** les collections existantes en BD avant chaque appel.

**Implications** :
- Batch A insère 50 lignes → commit DB.
- Batch B (300ms après) recharge `select('*')` → voit les lignes du batch A → toute collision intra-fichier détectée comme `EXISTS_COMPLETE` ou `EXISTS_INCOMPLETE`.
- ✅ **Pas de double insert** entre batches du même fichier.
- ✅ **Pas de double comptage `new_collections`** : la 2e occurrence d'une ligne sera comptée `idempotent_updates`, pas `new_collections`.

**Risque résiduel** : **doublons intra-batch** (50 lignes identiques dans le même batch). `batchLoadExistingCollections` est appelé une seule fois au début du batch → 2 lignes identiques dans le batch ne se voient pas mutuellement. Probabilité réelle sur Collection Report : très faible (clé = date+client+banque+montant+facture).

**Risque coût performance** : `select('*')` rechargé N fois (N = nombre de batches). Sur 5000 lignes / batchSize 50 = 100 batches → 100 SELECT full-table. Acceptable si la table reste < 50k lignes, dégradation linéaire au-delà.

**Risque double sync** : aucun. `processIntelligentSync` opère ligne par ligne et utilise `excel_filename + excel_source_row` comme clé d'idempotence.

## E. Plan patch recommandé — 4 options

### Option 1 — Heartbeat seul (try/finally)
- Patch : ~10 lignes dans `enhancedFileProcessingService.processFilesArray`.
- Risque : nul.
- Bénéfice : nul sur le vrai problème (timeout sync collections). Le heartbeat est déjà appelé.
- **Verdict** : faux confort.

### Option 2 — Batch seul (sans Heartbeat refactor)
- Patch : remplacer L353-358 de `enhancedFileProcessingService.ts` par le bloc `BatchProcessingService.processCollectionsBatch` + `aggregateBatchResults` (à dupliquer ou factoriser dans un util).
- Seuil : inconditionnel (parité legacy) **ou** conditionnel (`if data.length > 200`).
- Risque : faible (logique batch-safety prouvée en C+D).
- Bénéfice : **résout le vrai problème** OOM/timeout sur gros fichiers.

### Option 3 — Heartbeat try/finally + Batch
- Patch : Option 1 + Option 2.
- Risque : faible.
- Bénéfice : parité fonctionnelle complète avec legacy.
- **Recommandé** pour Lot 4D.2.

### Option 4 — Gel temporaire
- Aucun patch. Documentation seule.
- Bénéfice : nul. DEF-05 reste OPEN sans progrès.
- **Verdict** : non retenu sauf si UX-SYNC-COUNTERS T2/T3 instables.

## F. Recommandation CTO argumentée

**GO sur Option 3** (Heartbeat try/finally + Batch inconditionnel parité legacy), à ouvrir comme **Lot 4D.2.b** — mais **uniquement après** :

1. **UX-SYNC-COUNTERS T2/T3 validés** sur `/upload` legacy avec le prochain fichier Excel du jour. Tant que les compteurs ne sont pas confirmés stables côté legacy, reporter le même mécanisme dans `enhanced` propage le risque.
2. **Refactor `aggregateBatchResults`** : sortir de `fileProcessingService` (privé) vers `src/services/syncResultAggregator.ts` (utilitaire public) pour éviter la duplication et corriger au passage `summary.total_processed`.

**NO GO immédiat** sur Option 1 seule (Heartbeat) : ne traite pas la cause racine, donne fausse impression de sécurité — exactement le motif invoqué par le CTO.

**Séquence proposée** :
- 4D.2.b.0 (READ_ONLY, ~15 min) — extraction `aggregateBatchResults` proposée + diff prévisionnel.
- 4D.2.b (~30 min) — patch `enhancedFileProcessingService` Option 3.
- 4D.3 (plus tard) — bascule `/upload` vers enhanced après 2 jours d'observation.
- 4D.4 — suppression `fileProcessingService`.

## G. Tests obligatoires avant patch 4D.2.b

1. **Régression `/upload` legacy** sur `COLLECTION REPORT-2026.xlsx` :
   - Compteurs `new_collections / idempotent_updates / enriched_collections / ignored_collections` notés.
   - Heartbeat logs `💓` présents.
2. **Réimport idempotent** du même fichier sur `/upload` :
   - `new_collections = 0`, `idempotent_updates ≈ total lignes`.
3. **Prochain fichier Excel du jour** sur `/upload` :
   - UX-SYNC-COUNTERS T2/T3 validés visuellement.
4. **Vérification SQL 0 doublon** :
   ```sql
   select excel_filename, excel_source_row, count(*)
   from collection_report
   group by 1,2 having count(*) > 1;
   ```
   → 0 ligne attendu.
5. **Test négatif réseau** : couper le réseau au milieu d'un import → vérifier `HeartbeatService.stop()` exécuté (logs `💓 Arrêt du heartbeat`).
6. **Après 4D.2.b** : refaire 1+2+3 via `/upload-bulk`. Compteurs **strictement identiques** à `/upload`.

## H. Interdits respectés

- ✅ Aucun fichier `src/` modifié.
- ✅ `STATUS_REGISTRY.md` non touché.
- ✅ `DEFERRED_BACKLOG.md` non touché.
- ✅ `DB_TRUTH.md` non touché.
- ✅ Aucun SQL, migration, RLS, auth, schéma.
- ✅ `excelMappingService`, `excelProcessingService`, `intelligentSyncService` non touchés.
- ✅ `/upload` non basculé.
- ✅ `fileProcessingService` non supprimé.
- ✅ Lot 4D.3 non ouvert.

---

## Statut maintenu

```
LOT-4D.2.0 — CLOSED / REPORT_ONLY
LOT-4D.2  runtime patch — bloqué
LOT-4D.2.a Heartbeat seul — NON RECOMMANDÉ (faux confort)
LOT-4D.2.b Heartbeat + Batch — recommandé après UX-SYNC-COUNTERS T2/T3 validés
LOT-4D.3  bascule /upload — interdit
DEF-05    — OPEN
UX-SYNC-COUNTERS — OPEN (bloquant pour 4D.2.b)
```
