# LOT-4C.3 — Audit ciblé Reconciliation

Statut : **REPORT_ONLY** — aucun src/ modifié, aucune suppression, aucune route touchée, aucune migration, aucun SQL, aucun changement RLS/auth/schéma. `STATUS_REGISTRY.md`, `DEFERRED_BACKLOG.md`, `LOT4C_PAGES_ROUTES_AUDIT.md`, `LOT4C2_BANKING_DASHBOARD_AUDIT.md`, `DB_TRUTH.md`, `LOT4A_PIPELINES_AUDIT.md`, `LOT4B0_ORPHAN_VERIFICATION.md` non modifiés.

## 1. Réponses aux questions CTO

1. **Route `/reconciliation` toujours dans `App.tsx` ?** Oui — `src/App.tsx:38` (`<Route path="/reconciliation" element={<ProtectedRoute><Reconciliation /></ProtectedRoute>} />`).
2. **Exposée dans `Layout.tsx` ?** Non. Nav = Accueil, Dashboard, Import Fichiers, Contrôle Qualité, Analyse Documents. **Mais** `src/pages/Index.tsx:166` contient un `<Link to="/reconciliation">` cliquable depuis la page d'accueil ⇒ route **atteignable runtime** (pas fantôme totale).
3. **Onglets `Reconciliation.tsx`** :
   - `sync` → `IntelligentSyncManager` ⇒ **ACTIF_REEL** (appelle `intelligentSyncService.analyzeExcelFile` + `processIntelligentSync` + `excelProcessingService.processCollectionReportExcel`).
   - `engine` → `BankReconciliationEngine` ⇒ **HYBRIDE** (lit `collection_report` Supabase mais logique de matching local, requête L.77 syntaxiquement douteuse `eq(...!== 'all' ? 'bank_name' : 'id', ...)`).
   - `collections` → `CollectionsManager` ⇒ **ACTIF_REEL** (`databaseService.getCollectionReports()`, `updateCollectionDateOfValidity`, `DuplicateAnalyzer`).
   - `statistics` → cartes **MOCK pur** : 85% / 425M / 80% / barres 65/25/10 hardcodées dans le JSX (Reconciliation.tsx:64-122).
   - Page elle-même affiche un bandeau d'avertissement "module non connecté à des transactions bancaires réelles" (L.30-35).
4. **`IntelligentSyncManager` utilisé ailleurs ?** Non. Seul importeur = `src/pages/Reconciliation.tsx:9`. **MAIS** le service sous-jacent `intelligentSyncService` est lui-même utilisé par `fileProcessingService` (L.4, 129, 149, 151) et `enhancedFileProcessingService` (L.4, 371, 375) ⇒ le **service** est critique pour le pipeline `/upload`. Le **composant UI** est exclusif à Reconciliation.
5. **`BankReconciliationEngine` réel ou fictif ?** Hybride avec biais mock. Lit réellement `collection_report` via Supabase (L.74-79) mais (a) la requête `.eq()` est mal formée, (b) le matching `bank_transactions ↔ collections` repose sur une table `bank_transactions` non confirmée par `DB_TRUTH.md`, (c) seul importeur = `Reconciliation.tsx:7`. Aucun runtime extérieur.
6. **`CollectionsManager` réel ?** **ACTIF_REEL**. Utilise `databaseService.getCollectionReports()` (vraie table `collection_report`) et `updateCollectionDateOfValidity` (vraie mutation). Importe `DuplicateAnalyzer`. Seul importeur = `Reconciliation.tsx:8` mais logique 100% branchée DB.
7. **Statistiques hardcodées ?** Oui. 85%, 425M, 80%, 65/25/10 = chiffres en dur dans le JSX. Aucune source DB. Pur affichage marketing.
8. **Si `Reconciliation` supprimée, que casse-t-on ?**
   - `<Link to="/reconciliation">` dans `Index.tsx:166` ⇒ lien mort à corriger (cf. précédent Lot 4C.1.bis).
   - `IntelligentSyncManager.tsx`, `BankReconciliationEngine.tsx`, `CollectionsManager.tsx` deviennent orphelins UI.
   - **`intelligentSyncService.ts` reste utilisé** par `fileProcessingService` + `enhancedFileProcessingService` ⇒ **ne pas supprimer le service**.
   - `databaseService.getCollectionReports` / `updateCollectionDateOfValidity` peuvent rester (utilisés par `CollectionsManager`, à reloger si on garde la fonctionnalité).
   - Aucun pipeline Excel `/upload` cassé : le sync intelligent passe par le **service**, pas par le composant.
9. **Faut-il déplacer `IntelligentSyncManager` ailleurs ?** Optionnel. Le pipeline `/upload` (`FileUpload`, `FileUploadBulk`) utilise déjà `enhancedFileProcessingService.processFile` qui invoque `intelligentSyncService` automatiquement. Le composant UI `IntelligentSyncManager` est une **interface manuelle** (analyse + sync étape par étape) qui peut servir d'outil opérateur séparé. Si on veut conserver cet outil, l'option propre = en faire un onglet de `/upload-bulk` ou une page `/sync-tools` dédiée. Si on considère que `/upload` couvre le besoin, le composant peut être supprimé sans perte fonctionnelle.
10. **Recommandation CTO** : voir §3.

## 2. Tableau de classification

| Élément | Classification | Justification |
|---|---|---|
| `src/pages/Reconciliation.tsx` | **HYBRIDE_A_DECIDER** | bandeau mock, route hors nav mais lien `Index.tsx`, mix réel/mock/hardcodé, 1 onglet 100% mock |
| Route `/reconciliation` (`App.tsx:38`) | **HYBRIDE_A_DECIDER** | atteignable via `Index.tsx:166`, à supprimer si page supprimée |
| `<Link to="/reconciliation">` (`Index.tsx:166`) | **A_VERIFIER** | dépend du sort de la page ; à réorienter ou retirer en cas de suppression |
| Onglet `sync` (UI) | **A_DEPLACER** | utile comme outil manuel, pourrait migrer vers `/upload-bulk` ou page dédiée |
| Onglet `engine` (`BankReconciliationEngine`) | **HYBRIDE_A_DECIDER** | requête `.eq()` mal formée, dépend de tables non confirmées DB_TRUTH ; SUPPRIMABLE en l'état |
| Onglet `collections` (`CollectionsManager`) | **ACTIF_REEL** | seule UI consommant `getCollectionReports` ; à conserver ou reloger |
| Onglet `statistics` (cartes hardcodées) | **MOCK_SUPPRIMABLE** | chiffres en dur, aucune source |
| `src/components/IntelligentSyncManager.tsx` | **A_DEPLACER** ou **SUPPRIMABLE_APRES_DEPLACEMENT** | composant UI exclusif Reconciliation ; redondant avec pipeline `/upload` automatique |
| `src/components/BankReconciliationEngine.tsx` | **MOCK_SUPPRIMABLE** | exclusif Reconciliation, requête défectueuse, pas d'usage runtime fiable |
| `src/components/CollectionsManager.tsx` | **A_DEPLACER** ou **A_CONSERVER** | seul importeur Reconciliation mais logique réelle DB |
| `src/services/intelligentSyncService.ts` | **NE_PAS_TOUCHER** | utilisé par `fileProcessingService` + `enhancedFileProcessingService` (pipeline `/upload`) |
| `src/services/databaseService.ts` (méthodes collections) | **NE_PAS_TOUCHER** | utilisé largement |
| `src/components/DuplicateAnalyzer.tsx` | **A_VERIFIER** | importé par `CollectionsManager`, à auditer si suppression cascade |

## 3. Recommandation CTO — 4 options

### Option (a) — Conservation status quo
Garder `Reconciliation` telle quelle avec son bandeau. **Coût** : dette UI persistante, lien `Index.tsx` vers page semi-mock. **Gain** : zéro risque.

### Option (b) — Allègement (recommandée court terme)
Réduire `Reconciliation.tsx` à 2 onglets :
- `sync` (`IntelligentSyncManager`) — outil opérateur conservé.
- `collections` (`CollectionsManager`) — vraie consultation DB.
Supprimer onglets `engine` (mock défectueux) et `statistics` (hardcodé). Supprimer `BankReconciliationEngine.tsx` (orphelin après suppression onglet). Garder route `/reconciliation` + lien `Index.tsx`. **Coût** : 1 lot chirurgical (~3 fichiers). **Gain** : page assainie, fonctionnalités réelles préservées.

### Option (c) — Déplacement et suppression
Déplacer `IntelligentSyncManager` vers `/upload-bulk` (nouvel onglet) et `CollectionsManager` vers une page `/collections` dédiée (ou onglet Dashboard). Puis supprimer `Reconciliation.tsx`, route `/reconciliation`, lien `Index.tsx:166`, et `BankReconciliationEngine.tsx`. **Coût** : 2 lots (4C.3.bis déplacement + 4C.3.ter suppression). **Gain** : architecture plus claire. **Risque** : refactor UI, à coordonner avec Lot 4D.

### Option (d) — Suppression sèche
Supprimer `Reconciliation.tsx` + route + 3 composants UI exclusifs + lien `Index.tsx`. **Coût minimal**. **Risque** : perte de l'interface manuelle de sync intelligent et de la consultation `collection_report` (le service reste utilisé par `/upload`, mais l'opérateur perd l'outil pas-à-pas).

**Préférence : option (b)** — allègement chirurgical sans déplacement. Préserve fonctionnalités réelles (`sync` manuel + `collections`), retire mocks (`engine` + `statistics`), évite refactor UI risqué avant Lot 4D. Option (c) à envisager **après** Lot 4D si une refonte `/upload` est faite.

## 4. Pré-requis pour exécution éventuelle (Lot 4C.3.bis option b)

- Patch `src/pages/Reconciliation.tsx` : retirer onglets `engine` + `statistics`, passer `TabsList` à `grid-cols-2`, retirer imports `BankReconciliationEngine` et `Card`/`CardContent`/`CardHeader`/`CardTitle` si plus utilisés.
- Supprimer `src/components/BankReconciliationEngine.tsx`.
- Vérifier `rg "BankReconciliationEngine" src/` → 0 résultat.
- Build TypeScript vert obligatoire.
- `IntelligentSyncManager`, `CollectionsManager`, `intelligentSyncService`, `databaseService` **non touchés**.

## 5. Interdits respectés

- Aucun fichier `src/` modifié.
- Aucune suppression effectuée.
- Aucune route modifiée.
- Aucune migration, SQL, RLS/auth/schéma.
- `STATUS_REGISTRY.md`, `DEFERRED_BACKLOG.md`, `LOT4C_PAGES_ROUTES_AUDIT.md`, `LOT4C2_BANKING_DASHBOARD_AUDIT.md`, `DB_TRUTH.md`, `LOT4A_PIPELINES_AUDIT.md`, `LOT4B0_ORPHAN_VERIFICATION.md` non modifiés.
- `fileProcessingService`, `enhancedFileProcessingService` non touchés.
- UX-SYNC-COUNTERS non traité.
- Lot 4D non ouvert.

## 6. Statut

- **LOT-4C.3 = CLOSED / REPORT_ONLY**
- **LOT-4C.3.bis (option b) = proposé, non ouvert**
- **LOT-4D = non ouvert**
- **DEF-05 = inchangé / OPEN**
- **DEF-07 = inchangé**
