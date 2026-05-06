# LOT-4C — Audit read-only pages mockées, routes doublons, composants debug

Statut : **REPORT_ONLY** — aucun patch, aucune suppression, aucune migration, aucun SQL, aucun changement RLS/auth/schéma. `STATUS_REGISTRY.md` et `DEFERRED_BACKLOG.md` non modifiés (consigne 4C).

## 1. Cartographie routes (`src/App.tsx`) vs navigation (`src/components/Layout.tsx`)

| Route | Composant | Exposée nav | Statut réel |
|---|---|---|---|
| `/` | `Index` | oui (Accueil) | ACTIF_REEL |
| `/auth` | `Auth` | non (publique) | ACTIF_REEL |
| `/reset-password` | `ResetPassword` | non | ACTIF_REEL |
| `/dashboard` | `Dashboard` | oui | ACTIF_REEL |
| `/upload` | `FileUpload` | oui (Import Fichiers) | ACTIF_REEL (pipeline `fileProcessingService`) |
| `/upload-bulk` | `FileUploadBulk` | **non** | ACTIF_REEL non exposé |
| `/document-understanding` | `DocumentUnderstanding` | oui (Analyse Documents) | ACTIF_REEL (pipeline BDK) |
| `/quality-control` | `QualityControl` | oui (Contrôle Qualité) | ACTIF_REEL |
| `/consolidated` | `ConsolidatedDashboard` | non | MOCK (bandeau seul) |
| `/consolidated-dashboard` | `ConsolidatedDashboard` | non | MOCK (doublon strict) |
| `/reconciliation` | `Reconciliation` | non (retiré Lot 1B) | HYBRIDE_A_DECIDER |
| `/banking/dashboard` | `BankingDashboard` | non (retiré Lot 1) | MOCK (logique réelle commentée) |
| `/banking/reports` | `BankingReports` | non (retiré Lot 1) | MOCK (early return ; code mort en dessous) |
| `/alerts` | `Alerts` | non (retiré Lot 1) | MOCK (bandeau seul) |
| `*` | `NotFound` | — | ACTIF_REEL |

**Constat clé** : 6 routes (`/consolidated`, `/consolidated-dashboard`, `/reconciliation`, `/banking/dashboard`, `/banking/reports`, `/alerts`) sont **enregistrées dans `App.tsx`** mais **absentes du menu de navigation** (`Layout.tsx`). Elles restent atteignables par URL directe.

## 2. Analyse fichier par fichier

### `src/pages/Alerts.tsx` (19 lignes) — **MOCK_SUPPRIMABLE**
Fichier réduit à un bandeau. Aucun import service, aucun état, aucun useEffect. Plus rien d'utilisable.
Action recommandée 4C.1 : supprimer la route `/alerts` ; supprimer le fichier.

### `src/pages/ConsolidatedDashboard.tsx` (19 lignes) — **MOCK_SUPPRIMABLE**
Identique au précédent : bandeau seul. **Mais** la route est mappée deux fois (`/consolidated` et `/consolidated-dashboard` — doublon strict, même composant).
Action recommandée 4C.1 : supprimer les 2 routes ; supprimer le fichier.

### `src/pages/BankingReports.tsx` (639 lignes) — **MOCK_SUPPRIMABLE (avec garde)**
Analyse :
- ligne 43-55 : `return` précoce avec bandeau ⇒ tout le code en dessous (lignes 57-639 : `useState`, `useToast`, sections rapports, génération PDF) est **mort par construction** (unreachable code).
- 0 import de service de données réel. Le composant est purement frontend.
Action recommandée 4C.1 : supprimer la route `/banking/reports` ; supprimer le fichier.

### `src/pages/BankingDashboard.tsx` (487 lignes) — **HYBRIDE_A_DECIDER**
Contredit l'audit Lot 4A qui le classait "faux mock / actif".
- ligne 43 : bandeau de démonstration affiché **avant** le contenu.
- ligne 59 : `mockData` en dur.
- ligne 136 : appel réel `bankingUniversalService.generateConsolidatedReport(...)` **commenté**.
- ligne 140 : `setConsolidatedData(mockData as RapportConsolide)` ⇒ alimente toujours avec du mock.
- imports réels présents : `bankingUniversalService`, `EvolutionAnalysis`, `IntelligenceMetier`, `RealtimeManager`.

Verdict révisé vs Lot 4A : ce n'est pas un "vrai actif". C'est un mock affiché avec bandeau, mais qui **importe** un service réel et trois composants lourds (`EvolutionAnalysis`, `IntelligenceMetier`, `RealtimeManager`) — ces composants sont la vraie raison de garder le fichier ou pas.
À vérifier hors 4C : ces 3 composants sont-ils utilisés ailleurs ? Si non, ils tombent avec la page.

### `src/pages/Reconciliation.tsx` (132 lignes) — **HYBRIDE_A_DECIDER**
- Bandeau de mise en garde présent.
- 4 onglets, dont 3 brancher des composants réels :
  - `IntelligentSyncManager` (utilise `intelligentSyncService` réel — sync Excel actif)
  - `BankReconciliationEngine` (selon DEF-06 = moteur fictif)
  - `CollectionsManager` (à vérifier)
- Onglet "Statistiques" : valeurs en dur (85%, 425M, 65/25/10) ⇒ mock visuel.

Verdict : page à risque. **L'onglet Synchronisation Intelligente touche au pipeline Excel actif** (`intelligentSyncService`). On ne peut pas supprimer cette page sans déplacer cet onglet ailleurs, ou sans casser un usage potentiel.
NE_PAS_TOUCHER en 4C.1. Décision séparée requise.

### `src/pages/QualityControl.tsx` (249 lignes) — **ACTIF_REEL**
- Imports réels : `qualityControlEngine`, `excelProcessingService`, `databaseService`.
- Appels réels : `excelProcessingService.processCollectionReportExcel(...)`, `databaseService.getAllBankReports()`.
- Exposé dans la nav.
Verdict : **NE_PAS_TOUCHER**. Confirme l'audit Lot 4A.

### Composants debug BDK

Tous tirent leurs types de `positionalExtractionService` et `bdkColumnDetectionService` (qui sont le cœur BDK actif).

| Composant | Importé par | Verdict |
|---|---|---|
| `BDKDebugPanel.tsx` (552 l) | `PositionalPDFViewer.tsx` | **DEBUG_REUTILISABLE** |
| `BDKCalibrationInsights.tsx` (217 l) | `BDKDebugPanel.tsx` | **DEBUG_REUTILISABLE** (transitif via DebugPanel) |
| `DataViewer.tsx` (227 l) | `BDKDebugPanel.tsx` | **DEBUG_REUTILISABLE** (transitif) |
| `ValidationMatrix.tsx` (263 l) | `BDKDebugPanel.tsx` | **DEBUG_REUTILISABLE** (transitif) |

Chaîne d'usage : `DocumentUnderstanding` (route `/document-understanding`, exposée nav) → `PositionalPDFViewer` → `BDKDebugPanel` → {`BDKCalibrationInsights`, `DataViewer`, `ValidationMatrix`}.

**Verdict consolidé : aucun de ces 4 composants n'est orphelin.** L'audit Lot 4A et la note "0 import page" étaient incomplets — ils sont atteints **transitivement** via `PositionalPDFViewer`. Reclassement : `A_VERIFIER` → `DEBUG_REUTILISABLE` actif. **NE_PAS_TOUCHER.**

## 3. Réponses synthétiques aux questions CTO

1. **Routes vers pages mockées** : `/alerts`, `/consolidated`, `/consolidated-dashboard`, `/banking/dashboard`, `/banking/reports`. Toutes hors nav.
2. **Pages bannérisées avec logique réelle restante** : `Reconciliation` (sync Excel réel), `BankingDashboard` (imports réels mais commentés).
3. **`/consolidated` ↔ `/consolidated-dashboard`** : doublon strict, même composant `ConsolidatedDashboard`. Confirmé.
4. **BankingReports** : MOCK pur (early return ; code en dessous mort).
5. **Reconciliation** : HYBRIDE — sync Excel réel via `IntelligentSyncManager`.
6. **BankingDashboard** : MOCK affiché + imports réels commentés. PAS un "actif" malgré l'audit 4A.
7. **QualityControl** : ACTIF_REEL.
8. **Debug BDK** : tous atteints via `PositionalPDFViewer` ⇒ DEBUG_REUTILISABLE actif.
9. **Suppressible sans risque** : `Alerts.tsx`, `ConsolidatedDashboard.tsx`, `BankingReports.tsx` + leurs routes.
10. **À garder** : `QualityControl`, `Reconciliation`, `BankingDashboard`, tous les debug BDK, `PositionalPDFViewer`.
11. **Micro-lots proposés** ci-dessous.

## 4. Tableau de classification

| Élément | Classification |
|---|---|
| `src/pages/Alerts.tsx` + route `/alerts` | **MOCK_SUPPRIMABLE** |
| `src/pages/ConsolidatedDashboard.tsx` + routes `/consolidated`, `/consolidated-dashboard` | **MOCK_SUPPRIMABLE** |
| `src/pages/BankingReports.tsx` + route `/banking/reports` | **MOCK_SUPPRIMABLE** |
| `src/pages/BankingDashboard.tsx` + route `/banking/dashboard` | **HYBRIDE_A_DECIDER** |
| `src/pages/Reconciliation.tsx` + route `/reconciliation` | **HYBRIDE_A_DECIDER** |
| `src/pages/QualityControl.tsx` | **ACTIF_REEL / NE_PAS_TOUCHER** |
| `src/components/BDKDebugPanel.tsx` | **DEBUG_REUTILISABLE / NE_PAS_TOUCHER** |
| `src/components/BDKCalibrationInsights.tsx` | **DEBUG_REUTILISABLE / NE_PAS_TOUCHER** |
| `src/components/DataViewer.tsx` | **DEBUG_REUTILISABLE / NE_PAS_TOUCHER** |
| `src/components/ValidationMatrix.tsx` | **DEBUG_REUTILISABLE / NE_PAS_TOUCHER** |

## 5. Micro-lots proposés (sans exécution)

### Lot 4C.1 — Suppression mocks purs (faible risque)
Périmètre :
- supprimer `src/pages/Alerts.tsx` + route `/alerts` dans `App.tsx`
- supprimer `src/pages/ConsolidatedDashboard.tsx` + routes `/consolidated` **et** `/consolidated-dashboard`
- supprimer `src/pages/BankingReports.tsx` + route `/banking/reports`
Pré-requis : grep d'appels résiduels (Layout déjà nettoyé Lot 1, ne pointe plus sur eux). Build TS vert.
Mise à jour docs : STATUS_REGISTRY (4C.1 CLOSED) ; DEF-07 partiellement avancé.

### Lot 4C.2 — Décision BankingDashboard (à valider CTO)
Deux options :
- (a) Supprimer `BankingDashboard.tsx` + route + vérifier que `EvolutionAnalysis`, `IntelligenceMetier`, `RealtimeManager` deviennent orphelins → suppression cascade après preuve.
- (b) Conserver pour réactivation future ; ne rien toucher.
Audit préalable requis : refs `EvolutionAnalysis`, `IntelligenceMetier`, `RealtimeManager`, `bankingUniversalService` dans tout `src/`.

### Lot 4C.3 — Décision Reconciliation (à valider CTO)
Délicat car contient `IntelligentSyncManager` qui touche au sync Excel actif. Trois options :
- (a) Garder la page telle quelle (statu quo).
- (b) Réduire à un seul onglet "Synchronisation" et supprimer les 3 autres (`engine`, `collections`, `statistics`).
- (c) Déplacer `IntelligentSyncManager` vers une autre page (ex. `/upload` ou nouvelle `/sync`) puis supprimer `Reconciliation`.
Aucune action 4C.

### Lot 4C.4 — (différé) UX wording bandeaux mocks restants
Si 4C.1 + 4C.2 exécutés, ce lot devient sans objet (les pages bannérisées disparaissent).

## 6. Interdits respectés

- Aucun fichier `src/` modifié.
- Aucune route modifiée.
- Aucune suppression effectuée.
- `STATUS_REGISTRY.md`, `DEFERRED_BACKLOG.md`, `DB_TRUTH.md`, `LOT4A_PIPELINES_AUDIT.md`, `LOT4B0_ORPHAN_VERIFICATION.md` non modifiés.
- `fileProcessingService` / `enhancedFileProcessingService` non touchés.
- Lot 4D non ouvert.
- Aucune migration, aucun SQL, aucune RLS/auth/schéma.

## 7. Recommandation finale

Ouvrir **Lot 4C.1** en premier (faible risque, gain de clarté immédiat : 3 fichiers + 4 routes). Puis décision séparée sur 4C.2 et 4C.3 avant tout 4D.
