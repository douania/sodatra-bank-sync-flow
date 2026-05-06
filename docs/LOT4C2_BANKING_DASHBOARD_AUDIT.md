# LOT-4C.2 — Audit ciblé BankingDashboard et dépendances

Statut : **REPORT_ONLY** — aucun patch, aucune suppression, aucune route modifiée, aucune migration, aucun SQL, aucun changement RLS/auth/schéma. `STATUS_REGISTRY.md`, `DEFERRED_BACKLOG.md`, `LOT4C_PAGES_ROUTES_AUDIT.md`, `DB_TRUTH.md`, `LOT4A_PIPELINES_AUDIT.md`, `LOT4B0_ORPHAN_VERIFICATION.md` non modifiés.

## 1. Réponses synthétiques aux questions CTO

1. **Route `/banking/dashboard` toujours dans `App.tsx` ?** Oui — `src/App.tsx:41` (`<Route path="/banking/dashboard" element={<ProtectedRoute><BankingDashboard /></ProtectedRoute>} />`).
2. **Exposée dans `Layout.tsx` ?** Non. La nav contient uniquement : Accueil, Dashboard, Import Fichiers, Contrôle Qualité, Analyse Documents.
3. **`BankingDashboard` utilise réellement `bankingUniversalService` ou seulement mock ?** Mock pur. `src/pages/BankingDashboard.tsx:37-47` retourne un bandeau d'avertissement **avant** tout le reste du composant ⇒ tout le code suivant (lignes 49-487, soit 439 lignes : `mockData`, `useEffect`, `loadDashboardData`, JSX dashboard, onglets) est **unreachable par construction**. L'unique appel `bankingUniversalService.generateConsolidatedReport(...)` est en commentaire (ligne 136). Aucun appel runtime au service.
4. **`EvolutionAnalysis`, `IntelligenceMetier`, `RealtimeManager` utilisés ailleurs ?** Non. `rg -t ts` confirme :
   - `EvolutionAnalysis` : importé uniquement par `src/pages/BankingDashboard.tsx:26` (et code unreachable).
   - `IntelligenceMetier` : importé uniquement par `src/pages/BankingDashboard.tsx:27` (idem).
   - `RealtimeManager` : importé uniquement par `src/pages/BankingDashboard.tsx:28` (idem).
   En interne, `EvolutionAnalysis` et `IntelligenceMetier` importent `bankingUniversalService` mais leurs appels réels sont également **commentés** (ex. `EvolutionAnalysis.tsx:160-161`).
5. **`bankingUniversalService` utilisé ailleurs que `BankingDashboard` ?** Oui — usage runtime réel dans `src/components/UniversalBankParser.tsx:225` (`bankingUniversalService.saveReport(...)`), atteint via la page `DocumentUnderstanding` (`src/pages/DocumentUnderstanding.tsx:14, 674`). Également importé par `src/components/ConsolidatedDashboard.tsx:23` (composant orphelin, voir Q9).
6. **Si `BankingDashboard` supprimé, qui devient orphelin ?**
   - `EvolutionAnalysis.tsx` ⇒ orphelin direct.
   - `IntelligenceMetier.tsx` ⇒ orphelin direct.
   - `RealtimeManager.tsx` ⇒ orphelin direct.
   - `bankingUniversalService.ts` ⇒ **non orphelin** (toujours utilisé par `UniversalBankParser`).
7. **À garder car utilisé ailleurs ?** `bankingUniversalService.ts` (vrai usage via `UniversalBankParser` → `DocumentUnderstanding`). `UniversalBankParser.tsx` : actif, `NE_PAS_TOUCHER`.
8. **`RealtimeManager` contient-il des liens vers routes supprimées ? Cliquables ?** Trois littéraux :
   - `src/components/RealtimeManager.tsx:144` → `currentPage: '/banking/dashboard'`
   - `src/components/RealtimeManager.tsx:198` → `currentPage: '/banking/dashboard'`
   - `src/components/RealtimeManager.tsx:205` → `currentPage: '/banking/reports'`
   Tous trois sont des **strings de display** dans des objets `UserPresence` mockés. Aucun `<Link>`, aucun `navigate()`, aucun `<a href>`. **Non cliquables, non bloquants.** Disparaissent avec le composant si supprimé.
9. **`src/components/ConsolidatedDashboard.tsx` existe-t-il encore ?** Oui — confirmé par `ls`. À distinguer de `src/pages/ConsolidatedDashboard.tsx` (supprimé en Lot 4C.1). Ce composant est orphelin depuis la suppression de la page (DEF-07 partiellement avancé). Hors scope 4C.2.

## 2. Tableau de classification

| Élément | Classification | Justification |
|---|---|---|
| `src/pages/BankingDashboard.tsx` + route `/banking/dashboard` | **SUPPRIMABLE** | mock pur, return précoce ligne 37-47, hors nav, appel service commenté |
| `src/components/EvolutionAnalysis.tsx` | **SUPPRIMABLE (cascade)** | seul importeur = `BankingDashboard` ; appels service commentés |
| `src/components/IntelligenceMetier.tsx` | **SUPPRIMABLE (cascade)** | seul importeur = `BankingDashboard` |
| `src/components/RealtimeManager.tsx` | **SUPPRIMABLE (cascade)** | seul importeur = `BankingDashboard` ; littéraux `/banking/*` = display mock non cliquables |
| `src/services/bankingUniversalService.ts` | **A_CONSERVER** | usage runtime réel via `UniversalBankParser.saveReport` (`DocumentUnderstanding`) |
| `src/components/UniversalBankParser.tsx` | **NE_PAS_TOUCHER** | actif via `DocumentUnderstanding` |
| `src/components/ConsolidatedDashboard.tsx` (composant) | **A_VERIFIER** | fichier confirmé présent (≠ page supprimée 4C.1) ; orphelin probable depuis 4C.1, déjà tracé DEF-07 ; hors scope 4C.2 |

## 3. Recommandation CTO

- **Option (a) — Suppression chirurgicale (recommandée)** : `BankingDashboard.tsx` + route `/banking/dashboard` + 3 composants exclusifs (`EvolutionAnalysis`, `IntelligenceMetier`, `RealtimeManager`). `bankingUniversalService` conservé. À exécuter dans un **futur Lot 4C.2.bis** si validé. Gain : 4 fichiers + 1 route + ~1700 lignes de code mort retirés ; clarté immédiate.
- **Option (b) — Conservation pour futur module** : laisser en l'état avec bandeau. Aucun gain de clarté, dette persistante.
- **Option (c) — Transformation en vrai module bancaire** : Lot dédié, hors scope nettoyage 4C, à arbitrer après stabilisation pipeline `/upload` (Lot 4D futur).

**Préférence : option (a).** Périmètre net, 0 référence runtime hors-cercle, dépendances exclusives confirmées.

## 4. Pré-requis avant exécution éventuelle (Lot 4C.2.bis)

- `rg -n "EvolutionAnalysis|IntelligenceMetier|RealtimeManager" src/` → confirmer 0 importeur résiduel hors `BankingDashboard`.
- `rg -n "/banking/dashboard" src/` → confirmer aucun `<Link>` ni `navigate()` cliquable dans `Index.tsx` ou autres pages (les littéraux dans `RealtimeManager` disparaîtront avec le composant).
- Build TypeScript vert (`tsc --noEmit` → 0 erreur) obligatoire en post-suppression.

## 5. Interdits respectés

- Aucun fichier `src/` modifié.
- Aucune suppression effectuée.
- Aucune route modifiée.
- Aucune migration, aucun SQL, aucun changement RLS/auth/schéma.
- `STATUS_REGISTRY.md`, `DEFERRED_BACKLOG.md`, `LOT4C_PAGES_ROUTES_AUDIT.md`, `DB_TRUTH.md`, `LOT4A_PIPELINES_AUDIT.md`, `LOT4B0_ORPHAN_VERIFICATION.md` non modifiés.
- `Reconciliation`, `QualityControl`, `fileProcessingService`, `enhancedFileProcessingService` non touchés.
- Lot 4D non ouvert.

## 6. Statut

- **LOT-4C.2 = CLOSED / REPORT_ONLY**
- **LOT-4C.2.bis = proposé, non ouvert**
- **LOT-4D = non ouvert**
- **DEF-05 = inchangé**
- **DEF-07 = inchangé**