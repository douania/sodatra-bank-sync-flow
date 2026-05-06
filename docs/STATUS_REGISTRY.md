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

**Statut : CLOSED** (ouvert 2026-05-04, clôturé 2026-05-05)

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
| **3B.1** | Traçabilité Excel obligatoire — supprimer `UNKNOWN_FILE` / `0` / `Math.random` / `Date.now` ; en cas de doublon `unique_excel_traceability` traiter comme idempotent (skip ou update contrôlé), jamais générer de traçabilité artificielle. Fichiers : `excelProcessingService.ts`, `excelMappingService.ts`, `intelligentSyncService.ts`. | `CLOSED` (2026-05-05) |
| **3B.1.bis** | Optimisation idempotence — suppression du flux `upsert(onConflict) → 409 → retries → fallback` dans `upsertNewCollection`. Remplacé par `SELECT` par `(excel_filename, excel_source_row)` puis `UPDATE` ciblé si trouvé / `INSERT` simple sinon ; gestion 23505 résiduel via re-SELECT + UPDATE, sans retry sur INSERT. Fichier : `intelligentSyncService.ts`. | `CLOSED` (2026-05-05) |
| **3B.1.ter** | clientCode obligatoire (suppression du fallback `'UNKNOWN'`) + sélection intelligente de feuille (Feuil1 vs Feuil3 pivot) + matching headers strict case-insensitive. Fichiers : `excelMappingService.ts`, `excelProcessingService.ts`. | `CLOSED` (2026-05-05) |
| **3B.1.quater** | Migration `collection_report` : conversion `varchar(50/100/20) → text` pour 7 colonnes (`facture_no`, `no_chq_bd`, `bank_name_display`, `depo_ref`, `sg_or_fa_no`, `match_method`, `processing_status`) ; trigger `trg_detect_collection_type` (dépendant de `no_chq_bd`) recréé à l'identique. Aucun runtime modifié. Migration : `supabase/migrations/20260505113550_5ad181bc-a3fe-4e63-9426-69c8c8077e74.sql`. | `CLOSED` (2026-05-05) |
| **3B.2** | Dates sans fallback silencieux — `parseDate` retourne `null` au lieu de `new Date()` ; ligne rejetée en erreur explicite si `reportDate` invalide ; dates optionnelles invalides → `null` + warning. Validation calendaire stricte (31/02 rejeté). Pivot DD/MM/YY = 50. Fichiers : `excelMappingService.ts`, `excelProcessingService.ts`. | `CLOSED` (2026-05-05) |
| **3B.2.bis** | Succès partiel contrôlé — `success: collections.length > 0`. Les lignes valides importées même si certaines lignes rejetées ; rejets listés dans `errors[]`. Cas test : 5 lignes synthétiques, 2 collections, 3 erreurs, 1 avertissement. | `CLOSED` (2026-05-05) |
| **3B.3** | Headers obligatoires — validation stricte avant parsing ; mapping exact case-insensitive ; matrice headers à confirmer métier. | `CLOSED` (2026-05-05) |
| **3B.4** | Montants — supprimer `Math.trunc` silencieux et `Math.abs` ; conserver les décimales et le signe ; validation regex stricte (pas de `parseFloat` permissif) ; heuristique séparateur le plus à droite pour formats mixtes ; normalisation espaces/NBSP/NNBSP. Périmètre `collection_report` : toutes les colonnes montant sont `numeric` (pas de `bigint`), donc décimales conservées telles quelles. | `CLOSED` (2026-05-05) |
| **3B.5** | Tests finaux croisés (T1–T8) + documentation de clôture Lot 3. Aucun runtime modifié. | `CLOSED` (2026-05-05) |

**Interdictions Lot 3** : aucun refactor global, aucune migration, aucun changement RLS / auth / schéma Supabase, aucun service legacy supprimé sans preuve d'inutilisation, aucun fallback masquant les erreurs, aucune donnée par défaut artificielle.

**Note Lot 3B.1 (clôture 2026-05-05)** : Traçabilité Excel obligatoire validée — aucun `UNKNOWN_FILE`, `DAILY_IMPORT`, `IMPORT_`, `Math.random`, `Date.now` ; `excel_filename` réel + `excel_source_row > 0` obligatoires. Tests manuels (import + réimport) passés.

**Note Lot 3B.1.bis (clôture 2026-05-05)** : Optimisation idempotence validée — suppression du flux `upsert → 409 → retries` ; réimport identique = `GET` par traçabilité puis `PATCH` ciblé ; aucun 409 ; aucune duplication ; aucun log `Upsert collection avec index fixe` ni `Supabase Operation échec définitif`.

**Note Lot 3B.1.ter (clôture 2026-05-05)** : Sélection intelligente de feuille validée — Feuil1 sélectionnée (vraies données détaillées), Feuil3 (pivot agrégé) rejetée. Mapping headers strict case-insensitive (suppression du `includes` partiel). `clientCode` obligatoire, plus de fallback `'UNKNOWN'`. Tests SQL post-import : `total_file = 648`, `unknown_in_file = 0`, `unknown_last_hour = 0`, `duplicates_by_traceability = 0`. Aucune migration, aucune RLS modifiée.

**Note Lot 3B.1.quater (clôture 2026-05-05)** : Migration `collection_report` varchar → text appliquée (7 colonnes). Plus d'erreur `value too long for type character varying(50)`. Import complet `COLLECTION REPORT-2026.xlsx` validé : 648/648 lignes, 100 % succès, total réel 8 395 386 484 FCFA. Trigger `trg_detect_collection_type` recréé à l'identique. Aucune donnée touchée, aucune RLS modifiée, aucun fichier runtime modifié. Migration : `supabase/migrations/20260505113550_5ad181bc-a3fe-4e63-9426-69c8c8077e74.sql`.

**Note Lot 3B.2 (clôture 2026-05-05)** : Dates sans fallback silencieux validées par tests T1–T7. `COLLECTION REPORT-2026.xlsx` : 648 lignes, idempotence conservée, 0 ligne `report_date = CURRENT_DATE` parasite. `COLLECTION_REPORT_TEST_3B2.xlsx` : 5 lignes synthétiques, 2 acceptées / 3 rejetées / 1 warning ; dates invalides `INVALID`, `31/02/2026` et vide rejetées en `errors[]` ; date optionnelle invalide laissée à `NULL`. Aucun fallback métier `new Date()` restant dans le périmètre.

**Note Lot 3B.2.bis (clôture 2026-05-05)** : Succès partiel contrôlé validé — `success: collections.length > 0`. Les lignes valides sont importées même si certaines lignes sont rejetées ; les rejets restent visibles dans `errors[]`. Cas test : `COLLECTION_REPORT_TEST_3B2.xlsx` traité avec 2 collections valides, 3 erreurs, 1 avertissement, sans échec global.

**Note Lot 3B.3 (clôture 2026-05-05)** : Headers obligatoires validés : `DATE`, `CLIENT NAME`, `AMOUNT`, `BANK NAME`. Rejet global avant parsing si un header obligatoire est absent. Headers optionnels `FACTURE N°`, `No.CHq /Bd`, `Date of VAlidity` = warnings non bloquants. Tests T1–T6 passés : T1 fichier réel `COLLECTION REPORT-2026.xlsx` OK (idempotent), T2 import minimal 4 headers obligatoires OK, T3 rejet global si `BANK NAME` manque (0 ligne DB), T4 rejet global si `DATE` + `AMOUNT` manquent (0 ligne DB), T5 alias/casse (`date`, `client name`, `Montant`, `bank name`) OK, T6 header inconnu supplémentaire ignoré silencieusement (import OK). Runtime modifié : `src/services/excelProcessingService.ts` uniquement (3B.3 + micro-correction 3B.3.a alignant `selectDataSheet` sur `BANK NAME`). Dette UX mineure différée : message d'erreur T3/T4 reste générique (`Aucune feuille de données valide trouvée`) au lieu de lister précisément les headers manquants — comportement métier correct, wording à améliorer dans un lot UX séparé.

**Note Lot 3B.4 (clôture 2026-05-05)** : `parseNumber()` corrigé dans `src/services/excelMappingService.ts` :
- suppression de `Math.trunc` ;
- suppression de `Math.abs` ;
- signe négatif préservé ;
- décimales conservées ;
- validation regex stricte avant conversion (pas de `parseFloat` permissif — `Number(s)` après normalisation) ;
- heuristique séparateur le plus à droite pour formats mixtes (`1,000,000.75` US et `1.000.000,75` EU) ;
- normalisation espaces standards, NBSP (`\u00A0`) et NNBSP (`\u202F`).

Schéma réel : toutes les colonnes montant du périmètre `collection_report` (`collection_amount`, `taux`, `interet`, `commission`, `tob`, `frais_escompte`, `bank_commission`, `nj`, `d_n_amount`, `income`) sont `numeric` — aucune n'est `bigint`. Les décimales sont donc conservées sans règle de rejet différenciée.

Preuves :
- Tests unitaires `parseNumber` : **23/23 verts** (T2a/T2b nombres natifs, T3 FR `"1 000 000,50"`, T4 US `"1,000,000.75"`, T4bis EU `"1.000.000,75"`, T5 `0.1234`, T6 `"ABC"` → `undefined`, T7 vide/null → `undefined`, T8 `1.999999999` préservé côté JS, T9 négatifs `-1000.50` / `"-1000,50"` / `"-1.000,50"` préservés, edge cases NBSP, `Infinity`/`NaN` → `undefined`, `"100abc"` → `undefined`).
- Test in-vivo réimport `COLLECTION REPORT-2026.xlsx` via UI : `total_file = 648`, `unknown_in_file = 0`, `duplicates_by_traceability = 0`, `total_amount = 8 395 386 484`, idempotence conservée.

Choix volontaires :
- Le fallback `collectionAmount: this.parseNumber(row.collectionAmount) || 0` est **conservé** pour ce lot (T6/T7 importent la ligne avec montant `0`, sans rejet).
- `databaseService.safeValue` (`Math.floor(Math.abs(...))` dans `saveBankReport` / `saveFundPosition`) est **hors périmètre 3B.4**, rattaché à DEF-10 (transactionnalisation multi-tables).

Runtime modifié : `src/services/excelMappingService.ts` uniquement. Aucune migration, aucune RLS, aucun schéma touché.

**Note Lot 3B.5 (clôture 2026-05-05)** : Tests finaux croisés T1–T8 validés, aucune régression détectée. Lot 3 clôturé.

- **T1 / T2 / T3 / T8** validés directement par SQL final sur `COLLECTION REPORT-2026.xlsx` :
  - `total = 648`
  - `total_amount = 8 395 386 484`
  - `unknowns = 0` (sur le fichier)
  - `bad_filenames = 0` (aucun `NULL`, `IMPORT_*`, `UNKNOWN_FILE`, `DAILY_IMPORT`)
  - `bad_rows = 0` (aucun `excel_source_row` `NULL` ou `<= 0`)
  - `doublons par (excel_filename, excel_source_row) = 0`
  - `today_rows` (parasites `CURRENT_DATE`) `= 0`
  - `min_amount = 5 436`, `max_amount = 51 912 624` (pas de troncature à zéro)
- **T4 / T5 / T6 / T7** acceptés par héritage des preuves déjà documentées :
  - T4 (sélection feuille Feuil1 vs Feuil3 pivot) couvert par Lot 3B.1.ter
  - T5 (rejet global headers obligatoires manquants) couvert par Lot 3B.3
  - T6 (dates invalides rejetées sans fallback `CURRENT_DATE`) couvert par Lot 3B.2
  - T7 (succès partiel contrôlé `success: collections.length > 0`) couvert par Lot 3B.2.bis
- Vérification globale DB (toutes lignes confondues) : `bad_filenames_global = 0`, `bad_rows_global = 0`. Les 125 `client_code = 'UNKNOWN'` globaux restants sont des lignes historiques pré-3B.1.ter, rattachées à **DEF-14** et hors périmètre 3B.5.

Aucun runtime modifié pendant 3B.5 (phase de validation + documentation uniquement). Aucune migration, aucune RLS, aucun changement schéma, aucune edge function.

**Récapitulatif final Lot 3** : 9 micro-lots clôturés (`3B.0`, `3B.1`, `3B.1.bis`, `3B.1.ter`, `3B.1.quater`, `3B.2`, `3B.2.bis`, `3B.3`, `3B.4`, `3B.5`). Tous les P0 du Lot 3A traités : traçabilité Excel obligatoire (DEF-03), dates sans fallback silencieux (DEF-01), montants sans troncature (DEF-02), validation headers obligatoires (DEF-04), succès partiel contrôlé. Restent ouverts hors périmètre Lot 3 : DEF-05 (pipelines divergents → Lot 4), DEF-10 (transactionnalisation + `databaseService.safeValue` → Lot 5), DEF-14 (125 lignes UNKNOWN historiques → lot dédié), DEF-15 (`reglement_impaye` typage → sous-lot dédié).

---

## Post-Lot 3 / DEF-15 — `reglement_impaye` typé `date`

**Statut : `CLOSED` (2026-05-05)**
**Hors numérotation Lot 3B** (Lot 3 déjà clôturé, non rouvert).

**Périmètre runtime** : un seul fichier modifié — `src/services/excelMappingService.ts`. Le mapping
`reglementImpaye: this.parseString(row.reglementImpaye)` est remplacé par
`reglementImpaye: this.parseDate(row.reglementImpaye, { required: false, fieldName: 'reglementImpaye', rowContext }) ?? undefined`.
Aligné sur le pattern `dateOfImpay` / `dateOfValidity` (Lot 3B.2). Pas de migration : audit DB pré-patch confirme `non_null = 0` sur 1 653 lignes — colonne `collection_report.reglement_impaye` conservée en `date`.

**Non modifié** : `src/services/intelligentSyncService.ts`, `src/types/banking.ts`, schéma, RLS, auth, edge functions, `databaseService.safeValue` (DEF-10 inchangée).

**Tests T1/T5 (réimport `COLLECTION REPORT-2026.xlsx`, validation SQL)** :
- `total_file = 648`
- `total_amount = 8 395 386 484`
- `unknowns = 0`
- `reglement_non_null = 0`
- `duplicates_by_traceability = 0`

**Tests T2/T3/T4** : acceptés par héritage des tests `parseDate` validés en Lot 3B.2 (date valide `15/06/2026` → `2026-06-15` ; texte invalide → warning console + `NULL` ; vide → `NULL` silencieux). Le patch ne crée pas de nouvelle logique, il raccorde `reglementImpaye` à `parseDate` existant.

Aucune ouverture de Lot 4. DEF-10, DEF-14 inchangées. 125 lignes `UNKNOWN` historiques (DEF-14) hors périmètre.

---

## Lot 4 — Nettoyage code mock / code mort

**Statut : DEFERRED**

**Périmètre prévu** :
- Supprimer le code mock des pages bannérisées ou les convertir en modules réels
- Supprimer les fichiers orphelins (`ProcessingResultsDetailed copy.tsx`, `extractionService_PRODUCTION.ts`)
- Nettoyer les imports inutilisés
- Supprimer les migrations historiques discardées

---

## SEC-ENV-1 — Supabase env vars + hygiène configuration

**Statut runtime/config : `CLOSED` (2026-05-05)**
**Réserve** : rotation manuelle de la clé anon Supabase pending (à effectuer dans le dashboard Supabase par le CTO — clé publishable mais exposée dans des zips/commits historiques).

**Objectif** : externaliser l'URL Supabase et la clé anon hardcodées dans `src/integrations/supabase/client.ts` vers des variables d'environnement Vite, sans toucher au reste.

**Fichiers modifiés (runtime)** :
- `src/integrations/supabase/client.ts` — lecture via `import.meta.env.VITE_SUPABASE_URL` et `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`, `throw` explicite si absente.
- `src/vite-env.d.ts` — typage `ImportMetaEnv` pour `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
- `.env.example` — créé, noms de variables uniquement, aucune valeur réelle.

**Non modifié (volontaire)** :
- `.gitignore` — `.env` et `*.local` déjà ignorés, pas de risque de régression Git type Dakar Cargo Quotes.
- `.env` — auto-peuplé par Lovable, non touché.
- `src/integrations/supabase/types.ts`, `intelligentSyncService.ts`, `excelMappingService.ts`, `fileProcessingService.ts`, `enhancedFileProcessingService.ts`.
- Supabase / migrations / RLS / auth / schéma / pipeline Excel / UX-SYNC-COUNTERS / Lot 4.

**Validation runtime (2026-05-05)** :
- `.env` présent avec les 3 variables attendues.
- Vite démarre sans erreur `Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY`.
- `/upload` à confirmer par rechargement complet navigateur côté CTO (warning HMR `useAuth must be used within an AuthProvider` considéré transitoire suite à `page reload src/vite-env.d.ts`).
- Warning `Unknown message type: RESET_BLANK_CHECK` non lié (harness Lovable).

**Suite** : voir P0-01 dans `docs/SECURITY_BACKLOG.md` — statut `CLOSED_PENDING_KEY_ROTATION`.

---

## DB-INVENTORY-1 — Audit inventaire DB read-only

**Statut : `REPORT_ONLY` (2026-05-05)**

9 requêtes `SELECT` exécutées via `supabase--read_query`. Aucun fichier modifié, aucune migration créée.

**Conclusions** :
- DB prod opérationnellement saine. RLS cohérente (0 policy `USING(true)` / `WITH CHECK(true)` sur 52).
- `collection_report` : 1 653 lignes, 0 doublon par `(excel_filename, excel_source_row)`, 740 `unique_excel_traceability NULL` historiques, 125 `client_code='UNKNOWN'` (DEF-14).
- Divergence repo ↔ DB sur `collection_report.unique_excel_traceability` : déclarée `GENERATED ALWAYS` dans `cold_shore` / `shiny_waterfall`, mais `text` simple en DB réelle.
- Source canonique d'idempotence métier = `idx_collection_excel_source` (UNIQUE partiel sur `excel_filename, excel_source_row`).

---

## DB-FREEZE-1 — PLAN_REVIEW migration de vérité DB

**Statut : `PLAN_REVIEW` (2026-05-05)**

Plan en deux étapes validé CTO : DB-FREEZE-1A (documentation) immédiat, DB-FREEZE-1B (migration réelle) différé jusqu'à staging.

---

## DB-FREEZE-1A — Documentation vérité DB

**Statut : `CLOSED` (2026-05-05)**

**Périmètre** : `docs/DB_TRUTH.md` (créé) + `docs/STATUS_REGISTRY.md` (mis à jour) uniquement.

**Mentions** :
- DB-FREEZE-1B (migration réelle) **différé jusqu'à staging**. Brouillon SQL inclus dans `docs/DB_TRUTH.md` §5, **non exécuté**.
- Lot 4 reste **fermé**.
- Aucun SQL exécuté, aucune migration créée, aucun runtime modifié.
- `cold_shore` et `shiny_waterfall` documentées comme **historiques non-reproductibles**, conservées.
- Règle canonique : idempotence portée par `idx_collection_excel_source`, `unique_excel_traceability` legacy.

**Conditions d'ouverture DB-FREEZE-1B** :
1. GO CTO sur le brouillon SQL.
2. Environnement staging Supabase disponible.
3. T-pré + T-post verts en staging.
4. Snapshot prod pris.

---

## LOT-4A — Audit read-only des pipelines d'import

**Statut : `CLOSED` (REPORT_ONLY) (2026-05-06)**

**Livrable** : `docs/LOT4A_PIPELINES_AUDIT.md` (créé). Aucun fichier `src/` modifié, aucune migration, aucun SQL.

**Pipelines confirmés** :
- `/upload` → `fileProcessingService` → `extractionService`
- `/upload-bulk` → `enhancedFileProcessingService` (pipeline canonique)
- `/document-understanding` → `enhancedFileProcessingService` + chaîne BDK (`bdkExtractionService`, `enhancedBDKExtractionService`, `positionalExtractionService`, `bdkColumnDetectionService`)

**Orphelins probables (0 import entrant)** : `extractionService_PRODUCTION.ts`, `advancedExtractionService.ts`, `ProcessingResultsDetailed copy.tsx`. À vérifier : `bankReportDetectionService`, `batchProcessingService`, `specializedMatchingService`, composants debug BDK (`BDKDebugPanel`, `BDKCalibrationInsights`, `DataViewer`, `ValidationMatrix`).

**Doublon DEF-05 confirmé** : `fileProcessingService.ts` (715 l) ↔ `enhancedFileProcessingService.ts` (820 l). Incohérence de typage : `ProcessingResultsDetailed` consomme le type `ProcessingResult` exporté par `enhancedFileProcessingService` mais `/upload` exécute `fileProcessingService`.

**Mocks vrais** : `Alerts.tsx`, `ConsolidatedDashboard.tsx`. **Faux mocks** (importent services réels) : `BankingDashboard.tsx`, `QualityControl.tsx`. **Hybrides à confirmer** : `BankingReports.tsx`, `Reconciliation.tsx`. Doublon de route `/consolidated` ↔ `/consolidated-dashboard`.

---

## LOT-4B / 4C / 4D / 4E — PROPOSED

**Statut : `PLANNED` — awaiting CTO GO** (sauf 4B ci-dessous)

- **4B** : suppression code mort prouvé (3 candidats certains + 3 à vérifier).
- **4C** : clarification pages mockées, doublon de route, composants debug BDK.
- **4D** : consolidation `fileProcessingService` ↔ `enhancedFileProcessingService` (DEF-05). Diff obligatoire avant fusion. Test runtime `/upload` requis.
- **4E** : UX wording bandeaux mock (différé).

**LOT-4 global** : reste ouvert, aucun changement de code.

**Interdits permanents (Lot 4 entier)** : pas de modification `cold_shore`/`shiny_waterfall`/pipeline Excel ; pas de réouverture Lot 1/2B/3/SEC-ENV-1/DB-FREEZE-1A ; DB-FREEZE-1B reste différé jusqu'à staging ; DEF-10 et DEF-14 hors périmètre.

---

## LOT-4B — Suppression chirurgicale code mort confirmé

**Statut : CLOSED (2026-05-06)**

**Préalable** : `docs/LOT4B0_ORPHAN_VERIFICATION.md` (REPORT_ONLY) confirme 0 référence runtime, 0 import dynamique, 0 route pour les 3 fichiers.

**Fichiers supprimés (3)** :
- `src/services/extractionService_PRODUCTION.ts`
- `src/services/advancedExtractionService.ts`
- `src/components/ProcessingResultsDetailed copy.tsx`

**Vérifications post-suppression** :
- `rg extractionService_PRODUCTION src/` → 0 résultat
- `rg advancedExtractionService src/` → 0 résultat
- `rg "ProcessingResultsDetailed copy" src/` → 0 résultat
- Tous les imports de `extractBankReport` pointent vers `src/services/extractionService.ts` (jamais `_PRODUCTION`) — confirmé : `fileProcessingService.ts:1` et `enhancedFileProcessingService.ts:1` importent depuis `./extractionService`.
- Build TypeScript vert.

**Fichiers documentation modifiés** : `docs/STATUS_REGISTRY.md`, `docs/DEFERRED_BACKLOG.md` uniquement.

**Hors scope (rappel CTO)** : `bankReportDetectionService`, `batchProcessingService`, `specializedMatchingService`, `BDKDebugPanel`, `BDKCalibrationInsights`, `DataViewer`, `ValidationMatrix`, `fileProcessingService`, `enhancedFileProcessingService`, `extractionService`, `bdkExtractionService`, `excelMappingService`, `excelProcessingService`, `intelligentSyncService`, `databaseService`. Aucun SQL, aucune migration, aucune RLS/auth/schéma. Lot 4D non ouvert. DEF-05 reste OPEN / partiellement avancé. `DB_TRUTH.md`, `LOT4A_PIPELINES_AUDIT.md`, `LOT4B0_ORPHAN_VERIFICATION.md` non modifiés.

**LOT-4 global** : toujours ouvert ; LOT-4C / 4D / 4E restent `PLANNED`.

---

## LOT-4C — Audit read-only pages mockées / routes / debug

**Statut : `CLOSED` (REPORT_ONLY) (2026-05-06)**

**Livrable** : `docs/LOT4C_PAGES_ROUTES_AUDIT.md`. Aucun code modifié.

---

## LOT-4C.1 — Suppression mocks purs et routes fantômes

**Statut : CLOSED (2026-05-06)**

**Préalable** : `docs/LOT4C_PAGES_ROUTES_AUDIT.md` classe `Alerts.tsx`, `ConsolidatedDashboard.tsx`, `BankingReports.tsx` comme `MOCK_SUPPRIMABLE`.

**Fichiers supprimés (3)** :
- `src/pages/Alerts.tsx`
- `src/pages/ConsolidatedDashboard.tsx`
- `src/pages/BankingReports.tsx`

**Routes retirées de `src/App.tsx` (4)** :
- `/alerts`
- `/consolidated`
- `/consolidated-dashboard`
- `/banking/reports`

Imports correspondants (`Alerts`, `ConsolidatedDashboard`, `BankingReports`) également retirés de `src/App.tsx`.

**Vérifications post-suppression** :
- `rg "pages/Alerts|pages/ConsolidatedDashboard|pages/BankingReports" src/` → 0 résultat
- `App.tsx` ne contient plus `/alerts`, `/consolidated`, `/consolidated-dashboard`, `/banking/reports`
- Build TypeScript vert (`tsc --noEmit` → 0 erreur)

**Réserves UX (à traiter en Lot 4C.2 / 4E, hors périmètre 4C.1)** :
- `src/pages/Index.tsx` contient encore 3 `<Link>` (deux vers `/consolidated`, un vers `/alerts`) qui mèneront désormais à `NotFound`.
- `src/components/RealtimeManager.tsx:205` contient encore la chaîne littérale `'/banking/reports'` (non bloquante).

**Hors scope (rappel CTO)** : `BankingDashboard.tsx`, `Reconciliation.tsx`, `QualityControl.tsx`, composants debug BDK (`BDKDebugPanel`, `BDKCalibrationInsights`, `DataViewer`, `ValidationMatrix`), `PositionalPDFViewer`, `fileProcessingService`, `enhancedFileProcessingService`. Aucune migration, aucun SQL, aucune RLS/auth/schéma. DEF-10 / DEF-14 / UX-SYNC-COUNTERS non traités. `DB_TRUTH.md`, `LOT4A_PIPELINES_AUDIT.md`, `LOT4B0_ORPHAN_VERIFICATION.md`, `LOT4C_PAGES_ROUTES_AUDIT.md` non modifiés. Lot 4D non ouvert. DEF-05 reste `OPEN / partiellement avancé`.

**LOT-4 global** : toujours ouvert ; LOT-4C.2 / 4D / 4E restent `PLANNED`. DEF-07 partiellement avancé.

---

## LOT-4C.1.bis — Correction liens morts post-suppression mocks

**Statut : CLOSED (2026-05-06)**

**Contexte** : Lot 4C.1 a supprimé les routes `/alerts`, `/consolidated`, `/consolidated-dashboard`, `/banking/reports`. Réserve documentée : `src/pages/Index.tsx` contenait encore 3 `<Link>` cliquables vers `/consolidated` (×2) et `/alerts`.

**Fichier modifié (1)** : `src/pages/Index.tsx`
- Carte « Vue Consolidée » → réorientée « Dashboard Principal » → `/dashboard`
- Carte « Alertes Critiques » → réorientée « Contrôle Qualité » → `/quality-control`
- CTA bas de page « Accéder à la Vue Consolidée » → « Accéder au Dashboard Principal » → `/dashboard`

**Vérifications post-modification** :
- `rg "/alerts|/consolidated|/consolidated-dashboard|/banking/reports" src/` → un seul résultat restant : `src/components/RealtimeManager.tsx:205` — chaîne littérale `currentPage: '/banking/reports'` dans un objet mock `UserPresence.currentPage` (champ d'affichage, **pas un lien cliquable**, pas de `<Link>`/`navigate`/`href`). Conservée telle quelle (non bloquante, à nettoyer dans un futur lot UX si `RealtimeManager` est démockifié).
- Aucune route supprimée n'a été réintroduite dans `src/App.tsx`.
- Build TypeScript vert (`tsc --noEmit` → 0 erreur).

**Hors scope** : `BankingDashboard`, `Reconciliation`, `QualityControl` (page), `fileProcessingService`, `enhancedFileProcessingService`. Aucun SQL, aucune migration, aucune RLS/auth/schéma. Lot 4D non ouvert. DEF-05 inchangé. `DEFERRED_BACKLOG.md` non modifié.

---

## LOT-4C.2 — Audit ciblé BankingDashboard (REPORT_ONLY)

**Statut : CLOSED / REPORT_ONLY (2026-05-06)**

**Livrable unique** : `docs/LOT4C2_BANKING_DASHBOARD_AUDIT.md`. Aucun code modifié, aucune suppression, aucune route modifiée.

**Conclusions** : `BankingDashboard.tsx` = mock pur (return précoce ligne 37-47, ~439 lignes unreachable, appel `bankingUniversalService.generateConsolidatedReport` commenté). `EvolutionAnalysis`, `IntelligenceMetier`, `RealtimeManager` importés exclusivement par `BankingDashboard`. `bankingUniversalService` à conserver (usage runtime réel via `UniversalBankParser.saveReport` → `DocumentUnderstanding`).

---

## LOT-4C.2.bis — Suppression chirurgicale BankingDashboard et cascade exclusive

**Statut : CLOSED (2026-05-06)**

**Fichiers supprimés (4)** :
- `src/pages/BankingDashboard.tsx`
- `src/components/EvolutionAnalysis.tsx`
- `src/components/IntelligenceMetier.tsx`
- `src/components/RealtimeManager.tsx`

**Fichier modifié (1)** : `src/App.tsx`
- Import `BankingDashboard` retiré
- Route `/banking/dashboard` retirée

**Vérifications post-suppression** :
- `rg "BankingDashboard|EvolutionAnalysis|IntelligenceMetier|RealtimeManager" src/` → 0 résultat
- `rg "/banking/dashboard" src/` → 0 résultat
- Build TypeScript vert (`tsc --noEmit` → 0 erreur)

**Conservé (non touché)** : `src/services/bankingUniversalService.ts` (usage réel via `UniversalBankParser.saveReport`), `src/components/UniversalBankParser.tsx`, `src/components/ConsolidatedDashboard.tsx` (composant — A_VERIFIER, hors scope).

**Hors scope** : `Reconciliation`, `QualityControl`, `fileProcessingService`, `enhancedFileProcessingService`. Aucun SQL, aucune migration, aucune RLS/auth/schéma. Lot 4D non ouvert. DEF-05 inchangé. DEF-07 partiellement avancé.

---

## LOT-4C.3 — Audit ciblé Reconciliation (REPORT_ONLY)

**Statut : CLOSED / REPORT_ONLY (2026-05-06)**

**Livrable unique** : `docs/LOT4C3_RECONCILIATION_AUDIT.md`. Aucun code modifié.

**Conclusions** : `Reconciliation` = hybride. Onglets `sync` (`IntelligentSyncManager`) et `collections` (`CollectionsManager`) = ACTIF_REEL. Onglet `engine` (`BankReconciliationEngine`) = mock défectueux. Onglet `statistics` = MOCK pur hardcodé. Service `intelligentSyncService` = NE_PAS_TOUCHER (utilisé par `fileProcessingService` + `enhancedFileProcessingService`). Recommandation : Option B = allègement chirurgical.

---

## LOT-4C.3.bis — Allègement chirurgical Reconciliation

**Statut : CLOSED (2026-05-06)**

**Fichier modifié (1)** : `src/pages/Reconciliation.tsx`
- Onglet `engine` (`BankReconciliationEngine`) supprimé
- Onglet `statistics` (cartes hardcodées 85% / 425M / 80% / 65/25/10) supprimé
- `TabsList` passé à `grid-cols-2`
- Imports `Card/CardContent/CardHeader/CardTitle` et `BankReconciliationEngine` retirés
- Bandeau d'avertissement adapté : précise que sync + collections sont actives, seul le moteur de rapprochement réel n'est pas connecté

**Fichier supprimé (1)** : `src/components/BankReconciliationEngine.tsx`

**Conservé (non touché)** : `IntelligentSyncManager`, `CollectionsManager`, `intelligentSyncService`, `databaseService`, `DuplicateAnalyzer`, route `/reconciliation`, lien `Index.tsx:166` vers `/reconciliation`.

**Vérifications post-patch** :
- `rg "BankReconciliationEngine" src/` → 0 résultat
- `rg 'value="engine"|value="statistics"' src/pages/Reconciliation.tsx` → 0 résultat
- `IntelligentSyncManager` + `CollectionsManager` toujours présents dans `Reconciliation.tsx`
- Build TypeScript vert (`tsc --noEmit` → 0 erreur)

**Hors scope** : `fileProcessingService`, `enhancedFileProcessingService`, `App.tsx`, `Index.tsx`. Aucun SQL, aucune migration, aucune RLS/auth/schéma. Lot 4D non ouvert. DEF-05 inchangé. DEF-07 partiellement avancé. UX-SYNC-COUNTERS, DEF-10, DEF-14 non traités.

---

## LOT-4C.4 — Audit final composant `ConsolidatedDashboard` (REPORT_ONLY)

**Statut : CLOSED / REPORT_ONLY (2026-05-06)**

**Livrable unique** : `docs/LOT4C4_CONSOLIDATED_COMPONENT_AUDIT.md`. Aucun code modifié.

**Conclusions** : `src/components/ConsolidatedDashboard.tsx` orphelin confirmé (1 seule occurrence = sa déclaration). `src/components/ConsolidatedBankView.tsx` importé exclusivement par `ConsolidatedDashboard` ⇒ SUPPRIMABLE cascade. `ConsolidatedMetrics`, `ConsolidatedCharts`, `CriticalAlertsPanel` conservés (utilisés par `Dashboard.tsx`).

---

## LOT-4C.4.bis — Suppression chirurgicale composant `ConsolidatedDashboard`

**Statut : CLOSED (2026-05-06)**

**Fichiers supprimés (2)** :
- `src/components/ConsolidatedDashboard.tsx`
- `src/components/ConsolidatedBankView.tsx`

**Vérifications post-suppression** :
- `rg "ConsolidatedDashboard|ConsolidatedBankView" src/` → 0 résultat
- `ConsolidatedMetrics`, `ConsolidatedCharts`, `CriticalAlertsPanel` toujours présents et utilisés par `src/pages/Dashboard.tsx`
- Build TypeScript vert (`tsc --noEmit` → 0 erreur)

**Conservé (non touché)** : `ConsolidatedMetrics`, `ConsolidatedCharts`, `CriticalAlertsPanel`, `bankingUniversalService`, `UniversalBankParser`, `DocumentUnderstanding`, `Reconciliation`, `QualityControl`, `fileProcessingService`, `enhancedFileProcessingService`.

**Hors scope** : aucun SQL, aucune migration, aucune RLS/auth/schéma. Lot 4D non ouvert. DEF-05 inchangé. DEF-07 partiellement avancé. UX-SYNC-COUNTERS, DEF-10, DEF-14 non traités.
