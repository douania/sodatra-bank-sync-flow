# LOT-4C.4 — Vérification finale `src/components/ConsolidatedDashboard.tsx`

Statut : **REPORT_ONLY** — aucun src/ modifié, aucune suppression, aucune route touchée, aucune migration, aucun SQL, aucun changement RLS/auth/schéma. `STATUS_REGISTRY.md`, `DEFERRED_BACKLOG.md`, `LOT4C_PAGES_ROUTES_AUDIT.md`, `LOT4C2_BANKING_DASHBOARD_AUDIT.md`, `LOT4C3_RECONCILIATION_AUDIT.md`, `DB_TRUTH.md` non modifiés.

## 1. Vérifications effectuées

```
rg "ConsolidatedDashboard" src/
→ src/components/ConsolidatedDashboard.tsx:48: export function ConsolidatedDashboard()
```

**Une seule occurrence : la déclaration elle-même.** Aucun import, aucune référence runtime.

```
rg "from .*ConsolidatedDashboard|components/ConsolidatedDashboard" src/
→ 0 résultat
```

```
rg "import\(|React\.lazy|lazy\(" src/ | grep -i consolidated
→ 0 résultat
```

Vérifications ciblées :
- `src/App.tsx` → aucune référence.
- `src/components/Layout.tsx` → aucune référence.
- `src/pages/Index.tsx` → aucune référence.
- `src/pages/Dashboard.tsx` → aucune référence à `ConsolidatedDashboard`.

**Conclusion : `src/components/ConsolidatedDashboard.tsx` est orphelin confirmé. 0 importeur runtime, 0 import dynamique, 0 lazy.**

## 2. Dépendances internes (cascade éventuelle)

`ConsolidatedDashboard.tsx` importe :
- `ConsolidatedMetrics` (L.19)
- `ConsolidatedCharts` (L.20)
- `ConsolidatedBankView` (L.21)
- `CriticalAlertsPanel` (L.22)
- `BankingUniversalService` (L.23)

Usage hors `ConsolidatedDashboard` :

| Composant/Service | Autres importeurs | Verdict |
|---|---|---|
| `ConsolidatedMetrics` | `src/pages/Dashboard.tsx:11,236` | **A_CONSERVER** |
| `ConsolidatedCharts` | `src/pages/Dashboard.tsx:12,247` | **A_CONSERVER** |
| `ConsolidatedBankView` | aucun autre | **SUPPRIMABLE (cascade)** |
| `CriticalAlertsPanel` | `src/pages/Dashboard.tsx:13,240` | **A_CONSERVER** |
| `BankingUniversalService` (`bankingUniversalService.ts`) | `src/components/UniversalBankParser.tsx:225` (via `DocumentUnderstanding`) | **NE_PAS_TOUCHER** (déjà classé Lot 4C.2) |

## 3. Tableau de classification

| Élément | Classification | Justification |
|---|---|---|
| `src/components/ConsolidatedDashboard.tsx` | **SUPPRIMABLE** | orphelin confirmé : 0 import statique, 0 import dynamique, 0 lazy, 0 route ; seule occurrence = déclaration |
| `src/components/ConsolidatedBankView.tsx` | **SUPPRIMABLE (cascade)** | importé exclusivement par `ConsolidatedDashboard` |
| `src/components/ConsolidatedMetrics.tsx` | **NE_PAS_TOUCHER** | utilisé par `Dashboard.tsx` (actif) |
| `src/components/ConsolidatedCharts.tsx` | **NE_PAS_TOUCHER** | utilisé par `Dashboard.tsx` (actif) |
| `src/components/CriticalAlertsPanel.tsx` | **NE_PAS_TOUCHER** | utilisé par `Dashboard.tsx` (actif) |
| `src/services/bankingUniversalService.ts` | **NE_PAS_TOUCHER** | usage runtime via `UniversalBankParser` |

## 4. Recommandation CTO

**Option (a) — Suppression chirurgicale dans Lot 4C.4.bis (recommandée)** :
- Supprimer `src/components/ConsolidatedDashboard.tsx` (orphelin confirmé).
- Supprimer `src/components/ConsolidatedBankView.tsx` (cascade exclusive).
- Aucune autre modification (App.tsx, Layout.tsx, Index.tsx non touchés).
- Build TypeScript vert obligatoire.

**Option (b) — Conservation** : aucune justification fonctionnelle. Pure dette.

**Préférence : option (a).** Périmètre minimal, 0 risque runtime.

## 5. Pré-requis avant Lot 4C.4.bis

- `rg "ConsolidatedDashboard|ConsolidatedBankView" src/` post-suppression → 0 résultat.
- Build TypeScript vert (`tsc --noEmit` → 0 erreur).

## 6. Interdits respectés

- Aucun fichier `src/` modifié.
- Aucune suppression effectuée.
- Aucune route, migration, SQL, RLS/auth/schéma.
- `bankingUniversalService`, `UniversalBankParser`, `DocumentUnderstanding`, `Reconciliation`, `QualityControl`, `fileProcessingService`, `enhancedFileProcessingService` non touchés.
- Lot 4D non ouvert.

## 7. Statut

- **LOT-4C.4 = CLOSED / REPORT_ONLY**
- **LOT-4C.4.bis (suppression chirurgicale) = proposé, non ouvert**
- **LOT-4D = non ouvert**
- **DEF-05 = inchangé / OPEN**
- **DEF-07 = inchangé**
