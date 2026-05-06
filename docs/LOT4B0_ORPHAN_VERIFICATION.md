# LOT-4B.0 — Vérification finale d'inutilisation des orphelins

Statut : **REPORT_ONLY** — aucune suppression, aucun patch `src/`, aucune migration, aucun SQL, aucun changement RLS/auth/schéma. `STATUS_REGISTRY.md` et `DEFERRED_BACKLOG.md` non modifiés (consigne 4B.0).

## Méthode

Pour chaque candidat :
1. `rg -F "<basename>"` sur tout le repo (hors `.git` et `*.tsbuildinfo`).
2. `rg` sur les exports principaux (classes, fonctions, constantes nommées).
3. Recherche d'imports dynamiques : `rg "import\(['\"].*<name>"` sur `src/`.
4. Recherche `React.lazy` / `lazy(` : **0 occurrence dans tout `src/`**.
5. Routes (`src/App.tsx`) : déjà cartographiées en Lot 4A, aucune ne pointe sur ces fichiers.

## Résultats

### 1. `src/services/extractionService_PRODUCTION.ts`

| Type | Référence | Localisation |
|---|---|---|
| self | nom du fichier | `src/services/extractionService_PRODUCTION.ts` |
| doc | dette technique | `docs/MASTER_CONTEXT.md:77` ("version alternative non utilisée en production") |
| doc | DEF-05 backlog | `docs/DEFERRED_BACKLOG.md:47,78` |
| doc | audit Lot 4A | `docs/LOT4A_PIPELINES_AUDIT.md` (4 occurrences) |
| doc | STATUS_REGISTRY | `docs/STATUS_REGISTRY.md:250,338` |
| runtime | **aucun** | — |
| dyn import | **aucun** | — |

**Verdict : SUPPRIMABLE.** Toutes les références sont documentaires. Aucun import statique, aucun import dynamique, aucune route. Justification : fichier explicitement documenté comme "version alternative non utilisée en production" dans `MASTER_CONTEXT`.

### 2. `src/services/advancedExtractionService.ts`

Exports principaux : `MULTI_BANK_PATTERNS`, `BANK_CONFIGS`, `extractAdvancedBankReport`.

| Type | Référence | Localisation |
|---|---|---|
| self | usages internes des constantes | `src/services/advancedExtractionService.ts` (12 occurrences internes) |
| doc | DEF-05 backlog | `docs/DEFERRED_BACKLOG.md:47` |
| doc | audit Lot 4A | `docs/LOT4A_PIPELINES_AUDIT.md` |
| runtime | **aucun** | — |
| dyn import | **aucun** | — |

`MULTI_BANK_PATTERNS`, `BANK_CONFIGS`, `extractAdvancedBankReport` : **0 import dans `src/` hors le fichier lui-même**.

**Verdict : SUPPRIMABLE.** Aucune référence runtime. Tous les usages des constantes sont internes au fichier.

### 3. `src/components/ProcessingResultsDetailed copy.tsx`

| Type | Référence | Localisation |
|---|---|---|
| self | nom du fichier | `src/components/ProcessingResultsDetailed copy.tsx` |
| doc | STATUS_REGISTRY | `docs/STATUS_REGISTRY.md:250` |
| doc | audit Lot 4A | `docs/LOT4A_PIPELINES_AUDIT.md` |
| runtime | **aucun** | — |
| dyn import | **aucun** | — |

Note : `ProcessingResultsDetailed` (sans suffixe " copy") reste activement importé par `pages/FileUpload.tsx` et `pages/FileUploadBulk.tsx`. **Seul le duplicata "copy" est concerné.**

**Verdict : SUPPRIMABLE.** Duplicata évident (suffixe " copy" dans le nom de fichier). Aucun import.

## Tableau de synthèse

| Fichier | Refs runtime | Refs doc | Refs self | Import dyn | Verdict | Justification |
|---|---|---|---|---|---|---|
| `src/services/extractionService_PRODUCTION.ts` | 0 | 5 | 1 | 0 | **SUPPRIMABLE** | Documenté comme alternative non utilisée |
| `src/services/advancedExtractionService.ts` | 0 | 2 | 12 (internes) | 0 | **SUPPRIMABLE** | Exports `MULTI_BANK_PATTERNS`/`BANK_CONFIGS`/`extractAdvancedBankReport` 0 import |
| `src/components/ProcessingResultsDetailed copy.tsx` | 0 | 2 | 1 | 0 | **SUPPRIMABLE** | Duplicata du composant actif |

## Mise en attente — A_VERIFIER (exclus de Lot 4B)

Conformément à la consigne CTO, ces fichiers ont 0 import statique mais restent **A_VERIFIER**, pas SUPPRIMABLE :

- `src/services/bankReportDetectionService.ts`
- `src/services/batchProcessingService.ts`
- `src/services/specializedMatchingService.ts`
- `src/components/BDKDebugPanel.tsx`
- `src/components/BDKCalibrationInsights.tsx`
- `src/components/DataViewer.tsx`
- `src/components/ValidationMatrix.tsx`

Raisons : composants debug BDK potentiellement réintroduisibles ; services bancaires possiblement référencés par d'autres pipelines à confirmer hors 4B.0.

## Prochaine étape proposée

Si CTO valide ce 4B.0, alors **Lot 4B** :
- suppression des 3 fichiers SUPPRIMABLE ci-dessus
- vérification build TypeScript vert
- mise à jour `STATUS_REGISTRY.md` (LOT-4B = CLOSED) et `DEFERRED_BACKLOG.md` (DEF-05 partiellement avancé)

## Interdits respectés

- Aucune suppression effectuée dans ce lot.
- Aucun fichier de `src/` modifié.
- `STATUS_REGISTRY.md` non modifié.
- `DEFERRED_BACKLOG.md` non modifié.
- `fileProcessingService` / `enhancedFileProcessingService` non touchés.
- Lot 4D non ouvert.
