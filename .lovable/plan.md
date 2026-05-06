# Lot 4D.2 — PLAN_REVIEW parité robustesse `enhancedFileProcessingService`

**Mode** : PLAN_REVIEW uniquement. Aucun patch, aucun code modifié, aucun doc mis à jour.
**Livrable unique** : `docs/LOT4D2_ROBUSTNESS_PLAN.md` (créé à l'exécution si GO).

---

## A. Diagnostic Heartbeat

**Source** : `src/services/supabaseClientService.ts` L148-180 → classe `HeartbeatService` avec `start()` / `stop()` (ping toutes les 30s).

**Dans `fileProcessingService.ts`** :
- L38-39 : `HeartbeatService.start()` au début de `processFiles`
- L257 : `HeartbeatService.stop()` en fin de bloc try
- L268-269 : `HeartbeatService.stop()` dans le `catch` global

**Dans `enhancedFileProcessingService.ts`** (déjà présent — L236-238, L285, L295-296) :
- `start()` après le timeout setTimeout
- `stop()` dans le succès, `stop()` dans le `catch`
- **Manque** : pas de `try/finally` → si une exception interrompt entre `start()` et `stop()` après `await this.processOrganizedFiles(...)`, le heartbeat peut rester actif si l'erreur ne remonte pas exactement par le `catch` (ex. rejet non-Error). Risque faible mais non nul.

**Conclusion A** : Heartbeat est **déjà présent** dans `enhanced` — la parité fonctionnelle existe. La seule lacune est la garantie `try/finally`.

---

## B. Diagnostic Batch

**`fileProcessingService.ts` L127-170** : utilise `BatchProcessingService.processCollectionsBatch` :
- batchSize: 50, pause 300ms
- chaque batch → `intelligentSyncService.analyzeExcelFile(batch)` puis `processIntelligentSync(batchAnalysis)`
- résultats agrégés via `aggregateBatchResults` (L478)

**`enhancedFileProcessingService.ts` L353-357** : appel **direct** unique :
```
intelligentSyncService.analyzeExcelFile(excelResult.data)
intelligentSyncService.processIntelligentSync(analysisResult)
```
Aucune segmentation. Sur ~5000+ lignes (`COLLECTION REPORT-2026.xlsx`) → risque OOM / timeout Supabase.

**Conclusion B** : `enhanced` n'a **pas** de mode batch. À reporter depuis `fileProcessingService`.

---

## C. Plan patch minimal proposé (NON appliqué)

**Fichiers qui seraient modifiés en 4D.2** :
1. `src/services/enhancedFileProcessingService.ts` — wrapper `try/finally` autour de `start()/stop()` + introduire un seuil batch dans la branche collections.
2. Aucun autre service touché. `BatchProcessingService` réutilisé tel quel.

**Patch logique** :
- **Heartbeat** : restructurer `processFilesArray` en `try { start(); ... } finally { stop(); clearTimeout(...) }`. Supprimer les deux `stop()` redondants.
- **Batch collections** : dans `processOrganizedFiles` (branche collection), si `excelResult.data.length > SEUIL` (proposé : **200**, identique à l'esprit `legacy`), passer par `BatchProcessingService.processCollectionsBatch` + `aggregateBatchResults` (à factoriser ou dupliquer localement). Sinon, appel direct conservé.
- **Aucun changement** sur `analyzeExcelFile` / `processIntelligentSync` / mapping Excel.

**Seuil 200** : justification = en-dessous, l'overhead batch (pauses 300ms + n sous-analyses) coûte plus que le gain. Au-dessus, OOM/timeout deviennent probables sur Supabase.

---

## D. Risques

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Double comptage compteurs UX-SYNC-COUNTERS en batch | Moyenne | Élevé | Vérifier que `aggregateBatchResults` somme bien `new_collections` / `idempotent_updates` / `enriched_collections` / `ignored_collections` sans recouvrement. T2/T3 manuels obligatoires. |
| Régression `/upload-bulk` sur petits fichiers | Faible | Moyen | Seuil 200 → branche actuelle inchangée pour fichiers courants. |
| `try/finally` masque une erreur en plus du heartbeat | Faible | Faible | `stop()` sans throw, idempotent. |
| Pause inter-batch ralentit UX | Faible | Faible | 300ms × N batches acceptable comparé au timeout. |
| `intelligentSyncService.analyzeExcelFile` partiel (par batch) perd contexte global | **Moyenne** | **Élevé** | À valider : l'analyse fichier-entier vs par-batch peut changer la détection de doublons inter-batch. **Point bloquant à arbitrer avant 4D.2.** |

---

## E. Tests manuels obligatoires (avant validation 4D.2)

1. `/upload-bulk` avec `COLLECTION REPORT-2026.xlsx` (gros) → vérifier : (a) pas de timeout, (b) heartbeat logs présents, (c) compteurs T1/T2/T3 cohérents avec ceux de `/upload`.
2. `/upload-bulk` avec **prochain Excel du jour** (petit/moyen) → vérifier branche non-batch inchangée.
3. `/upload` (legacy) sur le même fichier → comparer `syncResult` (`new_collections`, `idempotent_updates`, `enriched_collections`, `ignored_collections`). Doit être **identique**.
4. Forcer une exception réseau pendant import → vérifier `HeartbeatService` arrêté (logs `💓 Arrêt du heartbeat`).

---

## F. Interdits (rappel)

- Ne pas basculer `/upload` vers `enhanced` (réservé Lot 4D.3).
- Ne pas supprimer `fileProcessingService` (réservé Lot 4D.4).
- Ne pas modifier `intelligentSyncService`, `excelProcessingService`, `excelMappingService`, `progressService`.
- Aucun SQL, migration, RLS, auth, schéma.
- `ProcessingResult` / `src/types/processing.ts` non touchés.

---

## G. Recommandation CTO : **NO GO immédiat sur 4D.2**

**Motif** : le risque "analyse par batch vs analyse fichier-entier" (tableau D, ligne 5) n'est **pas tranché**. `intelligentSyncService.analyzeExcelFile(batch)` peut produire un `analysisResult` localement cohérent mais qui rate des collisions inter-batch (ex : doublon ligne 10 vs ligne 510). Avant de reporter le mode batch dans `enhanced`, il faut :

1. **Auditer `analyzeExcelFile`** : vérifie-t-elle uniquement le batch ou consulte-t-elle aussi la BD existante ? Si elle consulte la BD à chaque appel, la batch-isation est sûre. Sinon, elle introduit un trou de détection.
2. **Confirmer compteurs T2/T3** sur le **prochain fichier Excel du jour** via le pipeline actuel `/upload` (UX-SYNC-COUNTERS reste OPEN).

**Plan recommandé** :
- **4D.2.0** (READ_ONLY, ~30 min) : audit ciblé `intelligentSyncService.analyzeExcelFile` + `processIntelligentSync` pour répondre à la question 1. Livrable : `docs/LOT4D20_INTELLIGENTSYNC_BATCH_SAFETY.md`.
- Attendre UX-SYNC-COUNTERS T2/T3 validés.
- Puis seulement **4D.2** patch (Heartbeat try/finally + batch conditionnel).

**GO partiel possible** : si l'utilisateur veut avancer immédiatement, le sous-patch **Heartbeat try/finally seul** (sans batch) est sûr et indépendant. À considérer comme **Lot 4D.2.a** isolé.

---

## Statut

```
LOT-4D.2 — non ouvert (PLAN_REVIEW présenté)
LOT-4D.2.0 — proposé (audit ciblé batch-safety)
LOT-4D.2.a — proposé (Heartbeat try/finally seul, optionnel)
DEF-05 — OPEN (inchangé)
UX-SYNC-COUNTERS — OPEN (T2/T3 attendus)
```
