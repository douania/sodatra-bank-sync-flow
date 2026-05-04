# STATUS REGISTRY — Bank Sync Flow

> Registre des lots de stabilisation. Mis à jour après chaque lot.

## Statuts possibles

| Statut | Signification |
|---|---|
| `CLOSED` | Terminé, validé |
| `CLOSED_WITH_RESERVE` | Terminé avec réserve documentée |
| `TO_DOCUMENT` | Fait mais pas encore documenté formellement |
| `PLANNED` | Planifié, non commencé |
| `IN_PROGRESS` | En cours |
| `DEFERRED` | Reporté volontairement |

---

## Lot 1 — Sécurité UI + Vérité produit

**Statut : CLOSED_WITH_RESERVE**

**Objectif** : Rendre l'interface plus honnête et supprimer l'accès sign-up public côté UI.

**Fichiers modifiés** :
- `src/pages/Auth.tsx` — Onglet Sign Up et `handleSignUp` supprimés
- `src/pages/ResetPassword.tsx` — Attend `authLoading` avant redirection + spinner
- `src/components/Layout.tsx` — 4 entrées nav retirées (Banking Dashboard, Rapports Bancaires, Vue Consolidée, Alertes)
- `src/pages/BankingDashboard.tsx` — Early return avec bandeau "données de démonstration"
- `src/pages/BankingReports.tsx` — Early return avec bandeau "données de démonstration"
- `src/pages/Alerts.tsx` — Réécrit avec bandeau uniquement
- `src/pages/ConsolidatedDashboard.tsx` — Réécrit avec bandeau uniquement

**Réserve** : `src/services/supabaseClientService.ts` modifié hors périmètre initial (voir TS-0).

**Hors scope** : Migrations, RLS, pipeline Excel, AuthContext.signUp, App.tsx.

---

## Lot 1B — Rapprochement retiré de la nav + bandeau

**Statut : CLOSED**

**Objectif** : Suite audit Manus, retirer aussi le module Rapprochement de la navigation et ajouter un bandeau.

**Fichiers modifiés** :
- `src/components/Layout.tsx` — Entrée "Rapprochement" retirée
- `src/pages/Reconciliation.tsx` — Bandeau d'avertissement ajouté

**Hors scope** : `BankReconciliationEngine.tsx` non modifié.

---

## TS-0 — Hotfix typage HeartbeatService

**Statut : TO_DOCUMENT**

**Fichier** : `src/services/supabaseClientService.ts`
**Nature** : `NodeJS.Timeout` → `ReturnType<typeof setInterval>` (correction TypeScript uniquement)
**Impact métier** : Nul. Corrige une erreur de compilation pré-existante.

---

## DOC-1 — Documentation CTO minimale

**Statut : CLOSED**

**Objectif** : Créer la documentation interne pour tracer l'état réel du projet.

**Fichiers créés** :
- `docs/MASTER_CONTEXT.md`
- `docs/STATUS_REGISTRY.md`
- `docs/SECURITY_BACKLOG.md`
- `docs/DEFERRED_BACKLOG.md`

---

## Lot 2B — Sécurité Supabase / RLS (migration additive)

**Statut : CLOSED** — clôturé le 2026-05-04.

**Objectif** : Durcir réellement l'accès aux données via RLS additives, sans casser l'existant.

**Migration versionnée** :
`supabase/migrations/20260430150428_04e86234-f4a5-447b-8638-8f85518fa4ef.sql`

Le repo GitHub est aligné avec l'état réel Supabase. Aucune ré-exécution n'est nécessaire.

**Contenu de la migration** (transaction `BEGIN/COMMIT`, idempotente) :
- Promotion admin **additive** pour `sodatrasn@gmail.com` (`9539d4f5-a600-4bf7-931f-315e597e4441`) via `INSERT ... ON CONFLICT DO NOTHING` — le rôle `user` est conservé.
- `REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC` + `GRANT ... TO authenticated, service_role`.
- `REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC` (aucun grant à `authenticated`).
- `DROP POLICY IF EXISTS` + `CREATE POLICY` pour 11 tables métier (`bank_reports`, `bank_facilities`, `bank_evolution_tracking`, `collection_report`, `client_reconciliation`, `deposits_not_cleared`, `fund_position`, `fund_position_detail`, `fund_position_hold`, `impayes`, `universal_bank_reports`).
- Modèle de droits :
  - **SELECT** : `admin`, `manager`, `auditor` ou `user`.
  - **INSERT / UPDATE** : `admin` ou `manager` (avec `WITH CHECK` explicite).
  - **DELETE** : `admin` uniquement.
- `universal_bank_reports` : les rapports orphelins (`user_id IS NULL`) restent visibles uniquement par `admin` et `manager`.

**Vérifications post-migration effectuées** :
- `sodatrasn@gmail.com` possède bien `user` + `admin`.
- 0 policy `USING(true)` ou `WITH CHECK(true)` restante en schéma `public`.
- Les fonctions `SECURITY DEFINER` ne sont plus exécutables par `anon` / `PUBLIC`.

**Note importante** : la "distribution uniforme 4 policies × 13 tables" n'est **pas** un objectif. `user_roles`, `bank_audit_log` et `universal_bank_reports` ont volontairement des policies spécifiques à leur usage (admin-only, append-only audit, scoping par `user_id`).

**Clôture validée le 2026-05-04** :
- Tests fonctionnels OK : login `sodatrasn@gmail.com`, dashboard, lecture `collection_report`, import simple.
- Console navigateur : 0 erreur `42501` / RLS.
- Logs Postgres : 0 `permission denied for table`.
- Sign-up Supabase désactivé visuellement : Authentication → Sign In / Providers → *Allow new users to sign up* = OFF.

---

## Lot 3 — Import Excel fiable

**Statut : IN_PROGRESS** (ouvert 2026-05-04)

**Objectif** : fiabiliser l'import Excel bancaire pour empêcher la création de données fausses, non traçables, non idempotentes ou silencieusement corrompues.

### Lot 3A — Audit & plan

**Statut : CLOSED** (2026-05-04)

Diagnostic du pipeline d'import Excel réellement actif et plan de découpage en micro-patches. Aucun runtime modifié.

**Pipeline actif confirmé** :
- `pages/FileUpload.tsx` → `fileProcessingService` → `excelProcessingService` → `excelMappingService` → `intelligentSyncService` → `collection_report`.
- `pages/FileUploadBulk.tsx` → `enhancedFileProcessingService` (même chaîne aval).
- `databaseService.saveBankReport` / `saveFundPosition` : insertions multi-tables séquentielles non transactionnelles.
- Services PDF/BDK (`extractionService*`, `bdkExtractionService*`, `positionalExtractionService`, `advancedExtractionService`) **hors scope** Lot 3.

**P0 confirmés (preuves dans le code, voir SECURITY_BACKLOG)** :
1. **Traçabilité Excel falsifiée** par `UNKNOWN_FILE`, `0`, `Math.random()`, `Date.now()` (`excelMappingService` L. 104-105 ; `intelligentSyncService` L. 415-416, 543-545).
2. **Dates invalides remplacées par la date du jour** (`excelMappingService.parseDate` L. 90, 192, 198, 204).
3. **Montants tronqués silencieusement** par `Math.trunc` / `Math.floor(Math.abs(...))` (`excelMappingService` L. 216, 224 ; `databaseService.safeValue` L. 640).
4. **Headers Excel non validés** (`excelProcessingService` L. 42-43 ; mapping `includes` partiel L. 204).
5. **Mode "tolérant"** transformant les erreurs en warnings, succès si ≥ 1 ligne traitée (`excelProcessingService` L. 83-103).

**P2 noté pour DEFERRED** : sauvegardes multi-tables non transactionnelles dans `databaseService` ; doublon de pipelines `fileProcessingService` / `enhancedFileProcessingService`.

### Lot 3B — Exécution par micro-patches

Aucun patch à exécuter en bloc. Chaque micro-lot est indépendant, réversible, testable isolément.

| Micro-lot | Périmètre | Statut |
|---|---|---|
| **3B.0** | Documentation de lancement (ce patch). | `CLOSED` (2026-05-04) |
| **3B.1** | Traçabilité Excel obligatoire — supprimer `UNKNOWN_FILE` / `0` / `Math.random` / `Date.now` ; en cas de doublon `unique_excel_traceability` traiter comme idempotent (skip ou update contrôlé), jamais générer de traçabilité artificielle. Fichiers : `excelProcessingService.ts`, `excelMappingService.ts`, `intelligentSyncService.ts`. | `PLANNED` |
| **3B.2** | Dates sans fallback silencieux — `parseDate` retourne `null` au lieu de `new Date()` ; ligne rejetée en erreur explicite si `reportDate` invalide. | `PLANNED` |
| **3B.3** | Headers obligatoires — validation stricte avant parsing ; mapping exact case-insensitive ; matrice headers à confirmer métier. | `PLANNED` |
| **3B.4** | Montants — supprimer `Math.trunc` silencieux ; règle différenciée : décimales nulles (`100000.00`) acceptées, décimales significatives (`100000.50`) rejetées pour `bigint`, conservées pour `numeric` (`taux`, `interet`, `commission`, `tob`, etc.). | `PLANNED` |
| **3B.5** | Tests manuels finaux + documentation de clôture Lot 3. | `PLANNED` |

**Interdictions Lot 3** : aucun refactor global, aucune migration, aucun changement RLS / auth / schéma Supabase, aucun service legacy supprimé sans preuve d'inutilisation, aucun fallback masquant les erreurs, aucune donnée par défaut artificielle.

---

## Lot 4 — Nettoyage code mock / code mort

**Statut : DEFERRED**

**Périmètre prévu** :
- Supprimer le code mock des pages bannérisées ou les convertir en modules réels
- Supprimer les fichiers orphelins (`ProcessingResultsDetailed copy.tsx`, `extractionService_PRODUCTION.ts`)
- Nettoyer les imports inutilisés
- Supprimer les migrations historiques discardées
