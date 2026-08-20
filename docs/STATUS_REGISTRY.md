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

## OPS-CORE-4 — Verrouillage du chemin d'écriture financier

**Statut : `CLOSED — PRODUCTION_VALIDATED` (2026-08-13)**

Une migration additive retire à `authenticated` toutes les policies et tous les
privilèges d'écriture directe sur les sept tables financières, tout en
préservant leur lecture et l'exécution des deux RPC atomiques OPS-CORE-2.
L'audit des consommateurs ne détecte aucun contournement sous `src/`. Les
contrats OPS-CORE-2/4 passent à 22/22 et le replay PostgreSQL 17 valide
l'idempotence de la migration, la conservation des données, le refus des
écritures directes et le fonctionnement des deux RPC.

La migration `20260813000000_ops_core_4_financial_write_path_lockdown.sql` a
ensuite été appliquée sur le staging `gbbsqcscryygqlmqncyv`, puis sur la
production canonique `leakcdbbawzysfqyqsnr`, sous leurs GO nominatifs. Dans les
deux environnements, les policies et privilèges d'écriture directe de
`authenticated` sont à zéro, les sept lectures sont conservées, la RLS reste
active et les deux RPC atomiques restent exécutables. Les privilèges
`service_role` sont inchangés.

Le préflight production a constaté 37 migrations, OPS-CORE-2 présente et
OPS-CORE-4 absente. L'application transactionnelle migration + ledger a produit
`OPS_CORE_4_PRODUCTION_APPLY_OK`, puis le post-contrôle a confirmé 38 migrations
et `20260813000000` comme dernière version. Les 268 lignes `bank_reports`, les
26 lignes `fund_position` et les empreintes des sept tables sont restées
strictement inchangées.

Les validations `authenticated` avec rollback ont réussi sur staging et
production. Elles prouvent le refus d'une écriture directe, la création des
deux graphes parent/enfants par les RPC, le rejeu idempotent avec le même
identifiant et l'alimentation transactionnelle du ledger. Après rollback :
zéro ligne et zéro commande synthétique résiduelle. Marqueurs production :
`OPS_CORE_4_PRODUCTION_AUTHENTICATED_E2E_ROLLBACK_OK` et
`OPS_CORE_4_PRODUCTION_AUTHENTICATED_E2E_FINAL_STATE_OK`.

DEF-16 est clos. Aucun déploiement frontend supplémentaire n'est requis : le
runtime OPS-CORE-2 utilisait déjà exclusivement ces RPC. Rapport :
`docs/OPS_CORE_4_FINANCIAL_WRITE_PATH_LOCKDOWN_REPORT.md`.

---

## OPS-CORE-3 — Hygiène des logs frontend de production

**Statut : `CLOSED — PRODUCTION_VALIDATED` (2026-08-13)**

Le build Vite de production retire désormais toutes les invocations
`console.*` et les instructions `debugger`, tandis que le développement conserve
ses diagnostics. Un contrat post-build inspecte le JavaScript réellement généré
et bloque la CI si une invocation console réapparaît. Aucun runtime métier,
accès Supabase, SQL, migration, Auth/RLS ou environnement n'est modifié.
Rapport : `docs/OPS_CORE_3_PRODUCTION_LOG_HYGIENE_REPORT.md`.

---

## OPS-CORE-2 — Persistance financière atomique

**Statut : `CLOSED — PRODUCTION_VALIDATED` (2026-08-12)**

`saveBankReport` et `saveFundPosition` utilisent désormais chacun une RPC
PostgreSQL unique. Les écritures parent/enfants et le registre privé
d'idempotence sont transactionnels ; une même clé rejouée avec le même payload
retourne le même identifiant, tandis qu'un payload différent est refusé.

La migration locale ferme les RPC à `PUBLIC`, `anon` et `service_role`, limite
l'exécution à `authenticated`, puis contrôle dans la fonction le rôle métier
`admin` ou `manager`. Le registre d'idempotence est sous RLS sans policy et sans
grant client. Aucun SQL n'a été exécuté sur Supabase live.

Validation locale : 20/20 tests synthétiques PASS ; le typecheck canonique
`tsc -p tsconfig.app.json --noEmit` conserve exactement les 20 erreurs de
`origin/main` dans le même environnement local, soit zéro erreur imputable au
lot. Build Vite PASS, nouveaux fichiers ESLint propres et ratchet global à 209 erreurs / 11
warnings (baseline CI : 212 / 11). Le replay PostgreSQL 17 jetable est PASS :
grants/RLS, rollback tardif des deux agrégats, rejeu idempotent, mismatch de
payload et deux appels concurrents convergeant sur un seul résultat. Le
conteneur a été supprimé après le test. La contre-review indépendante ciblée du
HEAD `c837468b` rend `PASS`, sans nouveau finding : F3, F4, F5 et F6' sont
confirmées `FIXED`. Elle reproduit 19 = 19 diagnostics TypeScript dans son
environnement, cohérent avec la mesure locale 20 = 20 : dans les deux cas, zéro
nouvelle erreur est imputable au lot. Les migrations, le runtime et les smokes
authentifiés ont ensuite été validés sur staging puis production avec leurs GO
dédiés. DEF-10 est clos ; la fermeture des écritures directes résiduelles est
traitée séparément dans OPS-CORE-4.

Rapport : `docs/OPS_CORE_2_ATOMIC_PERSISTENCE_REPORT.md`.

---

## OPERATIONAL-IMPORT-PRODUCTION-READINESS

**Statut : `IMPLEMENTED_LOCAL — REVIEW_REQUIRED` (2026-08-20)**

Le pipeline global d'import est consolidé sur `/upload` +
`fileProcessingService`. L'alias `/upload-bulk` redirige vers `/upload`; sa page
orpheline et `enhancedFileProcessingService` sont supprimés. La détection encore
utilisée par `Document Understanding` est isolée dans
`documentDetectionService`, sans service de persistance.

Une matrice versionnée distingue `PRODUCTION_CANDIDATE`, `STAGING_PILOT` et
`BLOCKED`. Sur une future cible production ouverte, le précontrôle refuse les
pilotes. L'UI d'import combine capacité de cible et rôles applicatifs : seuls
`admin`/`manager` passent, et attente/erreur de rôles ferment l'accès. Cela ne
remplace jamais Auth/RLS/grants serveur. La production reste explicitement en
lecture seule ; aucun environnement live, SQL, migration ou changement RLS n'a
été réalisé.

La gate `test:import-preflight` inclut désormais les preuves synthétiques
readiness, détection documentaire, Collection Report et Internal Book. La
preuve BDK PDF reste portée par `test:bdk-pdf`. Rapport :
`docs/OPERATIONAL_IMPORT_PRODUCTION_READINESS_REPORT.md`.

DEF-05 passe à `RESOLVED_IN_REVIEW`; fermeture définitive après contre-review
indépendante et merge.

---

## OPS-CORE-1 — Précontrôle opérationnel des imports

**Statut : `CLOSED — PRODUCTION_VALIDATED` (2026-08-13)**

Le parcours `/upload` dispose désormais d'un précontrôle fail-closed avant
tout traitement : formats non supportés, fichiers vides, doublons probables,
documents non identifiés et conflits Fund Position/Client Reconciliation sont
visibles et bloquent le lot. Le service aval partage la même classification
normalisée que l'UI et ne transforme plus silencieusement un document inconnu
en rapport bancaire. Couverture synthétique et gate CI :
`test:import-preflight`. Rapport : `docs/OPS_CORE_1_OPERATIONAL_IMPORT_REPORT.md`.

La PR #128 est fusionnée dans `main` au commit `dadbbf650`. Le staging Lovable
`8c508b94-d03f-4165-ab2b-7a3cd52d2d2b`, ciblant exclusivement
`gbbsqcscryygqlmqncyv`, a validé les refus BRIDGE, Client Reconciliation,
format incompatible, document inconnu, doublon et conflit Fund Position, ainsi
que l'état prêt d'un Collection Report XLSX. Aucun traitement ni aucune mutation
métier n'a été déclenché.

Le runtime a ensuite été publié sur le projet Lovable production exact
`e52d9fce-f1b4-46f8-900c-c559a6eb2115`, déploiement
`ee3a7c51-32c4-419d-80cd-baf32339cb10`, bundle `index-B95fw9H2.js`. Les smokes
anonyme et authentifié confirment la cible `leakcdbbawzysfqyqsnr`, l'absence de
mutation et le maintien du garde `Production en lecture seule` : aucun
sélecteur de fichier ni bouton de traitement n'est exposé en production.

OPS-CORE-1 est clos sans migration, SQL, changement Auth/RLS ni donnée bancaire
réelle. La validation fonctionnelle d'import reste portée par staging, car la
production interdit volontairement toute sélection et tout traitement de
fichier.

---

## SEC-05 — GraphQL et grants anon fail-closed

**Statut : CLOSED — PRODUCTION_VALIDATED (2026-07-31)**

L'audit production read-only a confirmé `pg_graphql` actif, 13 tables métier
historiques exposées dans le schéma GraphQL anonyme par leurs grants, et
`clean_client_name(text,text)` générée comme mutation. Aucun consommateur
GraphQL n'existe dans le frontend ou les services versionnés ; le runtime
applicatif utilise Supabase JS/PostgREST.

La migration
`20260731120000_sec_05_graphql_and_anon_grants.sql` supprime l'extension sans
`CASCADE`, retire tous les privilèges `PUBLIC`/`anon` sur les 13 tables et sur
la fonction historique, puis ferme les default privileges `public` futurs pour
`anon`. Les grants `authenticated`/`service_role` et la RLS ne sont pas
modifiés. Le replay full-chain contrôle aussi leur préservation et crée des
objets synthétiques temporaires pour tester les default privileges.

La révocation du défaut natif `EXECUTE` de `PUBLIC` sur les futures fonctions
créées par `postgres` est nécessairement globale à tous les schémas : une
révocation limitée à `public` n'annule pas ce privilège global. Les expositions
futures doivent donc recevoir un `GRANT` explicite.

**Impact confirmé en production** : `/graphql/v1` est indisponible pour tous les rôles ;
les appels REST/RPC anonymes vers ce périmètre sont refusés au niveau grants,
avant la RLS. Les grants `authenticated`/`service_role` existants restent
inchangés ; leur préservation est validée sur des parcours staging et production
authentifiés.

**Rollback borné** : sous GO d'environnement séparé, réinstaller uniquement
`pg_graphql` dans son schéma `graphql` si un consommateur GraphQL non inventorié
est découvert. Ne pas rétablir les grants `anon` historiques sans décision CTO
et matrice d'accès dédiée. Ne pas restaurer le défaut global `EXECUTE TO PUBLIC`
sans décision sécurité séparée : le rollback GraphQL n'en dépend pas.

**Validation locale** : replay full-chain PostgreSQL 15 jetable vert, 36/36
migrations au ledger, RLS/policies historiques vertes, assertions SEC-05 vertes
et teardown confirmé (`ALL_FULL_CHAIN_PASS`). La suite prouve l'absence de
privilèges anon hérités de `PUBLIC`, la préservation des grants CRUD
`authenticated` historiques et la fermeture des futures tables, séquences et
fonctions `public`.

**Apply staging** — projet exact `gbbsqcscryygqlmqncyv` :

- préflight ledger : 35 migrations, dernière version `20260730180000`, seule
  SEC-05 absente ;
- préflight ACL : 13/13 tables avec CRUD anon, `clean_client_name(text,text)`
  exécutable par anon, grants `authenticated`/`service_role` présents, RLS
  activée sur 13/13 tables ;
- `pg_graphql` était déjà absent avant l'apply staging ;
- apply atomique migration + ledger : `SEC05_STAGING_APPLY_OK` ;
- post-check ledger : 36/36, dernière version `20260731120000` ;
- zéro privilège table restant pour anon, fonction non exécutable par anon,
  grants CRUD `authenticated`/`service_role` préservés sur 13/13 tables ;
- zéro fuite `PUBLIC`/anon dans les default ACL SEC-05 concernées, RLS activée
  sur 13/13 tables ;
- HTTP anon read-only : REST `401` / code PostgreSQL `42501` ; GraphQL HTTP
  200 sans `data.__schema`, erreur `pg_graphql extension is not enabled` ;
- aucune requête métier de mutation exécutée.

**Validation runtime `authenticated` staging** — frontend local ciblant
exclusivement `gbbsqcscryygqlmqncyv` :

- le preview Lovable disponible ciblait en réalité la production
  `leakcdbbawzysfqyqsnr` ; il a été exclu dès la détection, après des lectures
  `GET` uniquement et sans mutation production ;
- session utilisateur staging réelle reconnue avec les rôles `user` et `admin`,
  sans inspection des identifiants ni du jeton ;
- lectures applicatives Dashboard et Daily v2 via Supabase JS/PostgREST vertes ;
- requêtes `HEAD` authentifiées sur les 13 tables exactes SEC-05 : 13/13 HTTP
  200, sans téléchargement de lignes ;
- RPC pure `clean_client_name(text,text)` : HTTP 200 sur entrée synthétique ;
- Daily v2 affiche `Verrou serveur : lecture seule` et refuse les capacités de
  mutation dans l'interface ;
- zéro requête du frontend local vers la production et zéro requête métier de
  mutation. Les seuls
  `POST` observés appelaient les RPC read-only `daily_stmt_mutations_enabled()`
  et `clean_client_name(text,text)`.

**Apply production** — projet exact `leakcdbbawzysfqyqsnr` :

- base canonique verrouillée sur le merge PR #109
  `c13afbf818edcd840c5fcdc0b62e3dc9a562892b` ;
- préflight : 35 migrations, dernière version `20260730180000`, SEC-05 absente,
  13/13 tables avec RLS et privilèges anon, grants CRUD
  `authenticated`/`service_role` présents sur 13/13 tables ;
- `pg_graphql 1.5.11` était réellement actif et détenu par `supabase_admin`.
  Le rôle d'exécution `postgres` ne pouvait pas supprimer l'extension ; elle a
  donc été désactivée au préalable via le contrôle privilégié Extensions du
  Dashboard Supabase, après vérification de zéro dépendant externe ;
- apply atomique des sept instructions SEC-05 et du ledger :
  `SEC05_PRODUCTION_APPLY_OK` ; post-check 36/36 migrations, dernière version
  `20260731120000` ;
- zéro privilège effectif restant pour anon sur les 13 tables et sur
  `clean_client_name(text,text)` ; grants `authenticated`/`service_role`
  préservés, RLS activée sur 13/13 tables ;
- default privileges futurs du schéma `public` fermés à anon et défaut global
  `EXECUTE TO PUBLIC` fermé. Les defaults du schéma `storage`, hors périmètre,
  sont restés inchangés ;
- HTTP anon read-only : 13/13 routes REST refusées en `401`, RPC
  `clean_client_name` refusée en `401/42501`, GraphQL HTTP 200 sans schéma avec
  `pg_graphql extension is not enabled` ;
- intégrité `collection_report` strictement identique avant/après : 1 661 lignes,
  1 661 couples `(excel_filename, excel_source_row)` distincts et 748 valeurs
  legacy `unique_excel_traceability` nulles ;
- aucune mutation métier, policy RLS, table, index ou contrainte modifiée.

**Validation runtime `authenticated` production** — preview Lovable canonique
sur `c13afbf818edcd840c5fcdc0b62e3dc9a562892b`, ciblant exclusivement
`leakcdbbawzysfqyqsnr` :

- session production reconnue avec les rôles `user` et `admin`, sans inspection
  des identifiants, cookies ou jetons ;
- Dashboard chargé puis actualisé sans erreur d'autorisation ;
- Daily v2 chargé avec `Production en lecture seule` et
  `Verrou serveur : lecture seule imposée` ; vues Staging, Canonical, Audit et
  Reporting chargées sans erreur console, `401`, `403` ou `42501` ;
- la matrice SQL exhaustive confirme les grants CRUD `authenticated` et
  `service_role` sur 13/13 tables ainsi que l'exécution de
  `clean_client_name(text,text)` pour ces rôles. Les tables sans consommateur UI
  n'ont pas été appelées individuellement depuis le navigateur ; cette limite
  non bloquante est couverte par la matrice SQL ;
- aucune importation, promotion, supersede, administration ou mutation métier.

**Limite historique levée** : le staging ne contenait pas `pg_graphql`, mais le
chemin de désactivation de l'extension réellement active a été exercé avec
succès en production avant l'apply de la migration.

**Review IA indépendante** : `PASS`, aucun finding P0/P1/P2 restant.

**Clôture CTO** : apply production `PASS`, validation authenticated production
`PASS`, aucun finding bloquant restant. SEC-05 est fermé ; toute réactivation de
GraphQL ou réouverture de grants anon exige un GO sécurité séparé.

---

## DAILY-V2-0U — Account fingerprint et visibilité review

**Statut : IN_REVIEW — DRAFT_PR_96_0U4 (2026-07-16)**

**Base canonique 0U4** : `3fd2380fdf8aa0a14fac37bf4674a0d625376f43`
(merge PR #95).

Le lot remplace la saisie libre du fingerprint par un registre de comptes
pré-provisionnés, remplace le pseudo-grant backfill texte par un grant serveur
one-use, et persiste des motifs de revue à code fermé jusque dans staging et
canonical. Migration additive candidate :
`20260715000000_daily_v2_account_registry_review_visibility.sql`.

Le préflight staging read-only 0U2 a observé un contexte historique cohérent :
un fingerprint opaque pour trois canonical actifs, trois tentatives portant un
masque unique, et un conflit de la même identité sans chevauchement R3. Le
sous-lot 0U3 ajoute donc un pont admin fail-closed qui conserve ce fingerprint
et rattache atomiquement attempts, staging et canonical sans modifier les
identités de jour ni les statuts. Migration candidate locale :
`20260715010000_daily_v2_historical_identity_adoption_bridge.sql`.

0U et 0U3 ont ensuite été appliqués au staging
`gbbsqcscryygqlmqncyv`. La première adoption contrôlée a été refusée avant
toute écriture : le fingerprint historique unique est un jeton opaque sûr de
31 caractères, non un SHA-256 hex64. Le post-échec a confirmé 0 registre,
0 événement et 0 rattachement, avec les 3 attempts, 9 staging, 3 canonical et
leurs statuts strictement inchangés.

0U4 ajoute donc, dans une migration forward-only séparée, un schéma
`legacy_opaque_v1` fermé et réservé au pont historique. Le provisionnement
normal reste exclusivement `sha256_hex_v1`; le token historique est repris
exactement afin de ne scinder aucun `day_unit_id` ou préimage d'idempotence.
Imports staging suspendus jusqu'au GO d'environnement 0U4, à l'adoption
contrôlée validée et à une reprise explicitement autorisée.

Validation 0U4 complète obtenue : 381/381 tests applicatifs verts, build vert,
baseline TypeScript 19/19 et ESLint 222/222 strictement identiques. Le replay
PostgreSQL 15 jetable a produit `ALL_LOCAL_E2E_0R_PASS`, avec teardown complet
du conteneur, nettoyage des fichiers temporaires et delta de volumes nul. La
PR #96 est ouverte en draft ; aucun apply 0U4 Supabase live n'a été effectué.

Validation locale historique 0U3 : 380 tests applicatifs verts, build vert, 8 payloads
synthétiques générés, puis migrations historique + additives 0U/0U3, pont
d'adoption, matrice SQL/RLS/RPC, canonical et reporting 0O validés dans
PostgreSQL 15 Docker jetable (`ALL_E2E_0U3_HISTORICAL_ADOPTION_PASS`,
`ALL_LOCAL_E2E_0R_PASS`). Aucun Supabase distant, commit, push ou PR effectué.
Architecture, stop conditions et rollback :
`docs/ACCOUNT_FINGERPRINT_REVIEW_VISIBILITY_0U.md`.

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

**Statut : `CLOSED — PRODUCTION_LEGACY_HS256_REVOKED_RUNTIME_VALIDATED` (2026-08-01)**
**État final** : les clés legacy d'API production sont désactivées ; la clé de
signature courante est ECC P-256 / ES256 et la clé Legacy HS256 précédente est
révoquée, sans suppression définitive. Staging a été restauré après correction
de cible et n'est pas concerné par cette rotation production.

**Objectif historique** : externaliser l'URL Supabase et la clé anon hardcodées
dans `src/integrations/supabase/client.ts` vers des variables d'environnement
Vite, sans toucher au reste.

**Migration appliquée 2026-07-31** : remplacer dans le seul canal Lovable
versionné `.env` le JWT `anon` historique, puis la clé moderne `web` refusée par
la passerelle, par la clé API publishable `default` active du projet production.
Le client Supabase et la logique applicative restent inchangés. Le test de bundle
refuse tout JWT historique et toute clé backend, tandis que l'URL et le project
ID continuent de verrouiller la cible.

**Fichiers modifiés (runtime)** :
- `src/integrations/supabase/client.ts` — lecture via `import.meta.env.VITE_SUPABASE_URL` et `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`, `throw` explicite si absente.
- `src/vite-env.d.ts` — typage `ImportMetaEnv` pour `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
- `.env.example` — créé, noms de variables uniquement, aucune valeur réelle.
- `.env` — migration appliquée vers `sb_publishable_*`, valeur publique
  frontend autorisée par `docs/SECURITY_CONTRACT.md` §6.
- `src/features/daily-v2/dailyV2BundleSafety.synthetic.test.ts` — contrat
  statique modernisé et retour au JWT legacy interdit.

**Non modifié par le patch Git (volontaire)** :
- `.gitignore` — `.env` reste volontairement versionné ; `.env.local` et
  `.env.*.local` restent ignorés.
- `src/integrations/supabase/types.ts`, `intelligentSyncService.ts`, `excelMappingService.ts`, `fileProcessingService.ts`, `enhancedFileProcessingService.ts`.
- migrations / RLS / Auth / schéma / pipeline Excel / UX-SYNC-COUNTERS / Lot 4.

**Validation locale candidate (2026-07-31)** :
- matrice CI complète PASS, dont 99/99 tests Daily v2 ; build PASS ;
- bundle produit avec la clé publishable, sans ancienne clé JWT ni marqueur
  backend ; cible production conservée ;
- dette ESLint strictement identique à `origin/main` (209 erreurs,
  11 warnings) et dette TypeScript strictement identique (19 erreurs).

**Validation staging authenticated (2026-07-31)** — PASS runtime :
- `origin/main` et Lovable synchronisés sur le merge PR #111
  `a50273924f88cafe8aceb059e44dfb76e1deb86c` ;
- la clé publishable staging moderne est reconnue par Auth (`200`, contre `401`
  pour une clé invalide) et les clés JWT legacy staging restent actives pour le
  rollback ;
- un premier harness local a chargé par erreur la configuration production :
  le login staging a été refusé avec `Invalid API key` ; aucune mutation métier
  n'a été tentée, puis ce harness a été arrêté ;
- le harness corrigé a été vérifié avant connexion : URL, project ID et vraie
  clé publishable staging injectés uniquement dans le processus, URL production
  absente ;
- connexion manuelle réussie, session maintenue après rechargement de
  `/dashboard`, puis lecture de `/daily-statements` sans erreur Auth, réseau ou
  console ;
- l'UI a confirmé le mode lecture seule : dépôt, promotion, supersede et
  administration désactivés ; aucun bouton de mutation n'a été utilisé ;
- cleanup du harness validé : onglet fermé, ports locaux libérés, clé effacée de
  la mémoire du processus, worktree de validation propre et sans `.env.local`.

**Cleanup local** : la surcharge `.env.local` staging préexistante a été
supprimée sous GO explicite. Aucun `.env.local` ne subsiste dans les worktrees
contrôlés.

**Préflight production (2026-07-31)** :
- GitHub `main` et Lovable alignés sur le merge PR #112
  `3440111af887ddad2b1d206fa9ed822f18a7fc13` ;
- la publishable `web` embarquée et la publishable `mobile` listée dans le
  Dashboard répondaient toutes deux `401` sur Auth et PostgREST ;
- la clé JWT legacy production restait reconnue par Auth (`200`), mais
  `docs/SECURITY_CONTRACT.md` interdit sa réintroduction dans un build après la
  migration ; sa disponibilité technique ne constitue donc pas un rollback
  autorisé ;
- aucune donnée métier téléchargée et aucune mutation métier exécutée.

**Initialisation additive du système de clés modernes** : le Dashboard exigeait
la création couplée d'une paire `default`. La publishable `default` est reconnue
par Auth (`200`). Sur PostgREST, elle atteint le contrôle de grants puis reçoit le
refus fail-closed attendu sur `collection_report` (`401`, code `42501`). La clé
secret `default` est restée masquée : jamais révélée, copiée, utilisée ou
versionnée. Les clés JWT legacy restent actives ; aucune révocation n'a eu lieu.

**Correction Git fusionnée** : la PR #113 a placé sur `main` la publishable
`default` active, au merge `777adc47cd91833566a5058f238dd0865688a2ca`.
La PR #114 a consigné la validation runtime initiale ; son merge
`5ada2680dcc69572a36c64f8cc88c8901103c4fc` est aligné entre GitHub et le
preview Lovable canonique, qui est `ready`.

**Rollback fail-closed** : ne pas revenir à la publishable `web` invalide et ne
pas réintroduire de JWT legacy dans le build. La réactivation production des
clés legacy reste disponible dans le Dashboard, mais exige un client hors
inventaire effectivement cassé et un GO CTO explicite. Corriger ensuite en avant
vers une clé moderne. Aucune restauration DB n'est nécessaire.

**Validation runtime `authenticated` production (2026-07-31)** — PASS :
- la session production reste reconnue après rechargement complet et le
  Dashboard authentifié demeure accessible ;
- `/upload` passe le rechargement complet exigé et affiche le garde `Production
  en lecture seule` ; import, traitement et promotion restent désactivés ;
- le Dashboard se charge puis s'actualise avec quatre appels Supabase `GET`
  (`collection_report`, `bank_reports`, `collection_report`, `fund_position`),
  tous `200` et aucun verbe de mutation ;
- la clé réellement envoyée par le runtime correspond, par empreinte non
  révélatrice, à la publishable `default` attendue ; elle n'est ni un JWT legacy
  ni une clé backend ;
- aucune erreur console ou réseau `Invalid API key`, variable Vite manquante ou
  `useAuth must be used within an AuthProvider` ;
- aucun import, export, téléchargement de fichier ou appel métier de mutation ;
  aucune modification Git, Lovable ou Supabase pendant la validation.

**Désactivation legacy et correction de cible (2026-08-01)** :
- cible canonique confirmée par `.env`, les contrats runtime et le trafic :
  staging `gbbsqcscryygqlmqncyv`, production `leakcdbbawzysfqyqsnr` ; le
  libellé Supabase `main — Production` décrit la branche principale d'un projet
  et ne constitue pas une preuve suffisante de l'environnement SODATRA ;
- une première désactivation a atteint staging après interprétation erronée de
  ce libellé. L'écart a été détecté lorsque le trafic du preview Lovable a ciblé
  `leakcdbbawzysfqyqsnr`. Staging a été réactivé immédiatement et son état
  initial restauré ;
- la production exacte, affichée `sodatra-accounting`, a ensuite été verrouillée
  par son `project_ref`. Les clés modernes `default` ont été confirmées avant la
  désactivation commune de `anon` et `service_role` comme clés d'API ; le
  contrôle de réactivation reste disponible.

**Validation runtime post-désactivation production (2026-08-01)** — PASS :
- session authentifiée maintenue après rechargements complets ;
- Dashboard : 5 `GET` Supabase en `200` (`collection_report`, `user_roles`,
  `bank_reports`, `collection_report`, `fund_position`) ;
- `/upload` : garde `Production en lecture seule`, 1 `GET user_roles` en `200`,
  aucune capacité d'import ou traitement déclenchée ;
- Daily v2 : garde `Production en lecture seule` et `Flux contrôlé`, 6 `GET` en
  `200` (`user_roles`, `daily_statement_units_staging`,
  `daily_statement_units_canonical`, `daily_statement_import_events`,
  `daily_statement_account_events`, `daily_statement_account_registry`) ;
- les 12 appels utilisent la publishable moderne dans `apikey` et le JWT
  utilisateur dans `Authorization` ; 0 clé legacy, 0 clé secrète frontend,
  0 réponse non-`200`, 0 mutation métier et 0 erreur console ;
- aucune valeur de clé révélée ou copiée.

**Préflight de migration des clés de signature Auth (2026-08-01)** :
- production exacte verrouillée sur `leakcdbbawzysfqyqsnr` ; clés API legacy
  déjà désactivées et publishable `default` active ;
- durée de vie des access tokens : 3 600 secondes ; limites de durée maximale
  et d'inactivité des sessions désactivées ; protection contre le rejeu des
  refresh tokens active avec intervalle de 10 secondes ;
- seule Edge Function inventoriée : `mcp`, avec vérification JWT par secret
  legacy désactivée ; aucun validateur JWT custom, consommateur Realtime,
  Storage signed URL ou backend custom versionné n'a été trouvé ;
- migration additive réalisée sans rotation immédiate : Legacy HS256 courante,
  ECC P-256 / ES256 en standby, JWKS public exposant la clé EC/ES256 avec `kid`.

**Rotation production vers ES256 (2026-08-01)** — PASS :
- rotation déclenchée à `2026-08-01T10:44:22.586Z` sur le projet exact ; état
  final ES256 confirmé quelques secondes plus tard ;
- ECC P-256 / ES256 est devenue la clé courante ; Legacy HS256 est passée dans
  `Previously used keys` et reste disponible pour vérifier les jetons non
  expirés ; aucune révocation ni suppression n'a été déclenchée ;
- les clés API legacy `anon` / `service_role` restent désactivées ;
- le JWKS public contient une clé `EC` / `ES256` / `sig` avec `kid` ; aucune
  valeur de clé ou de jeton n'a été consignée.

**Validation runtime post-rotation production (2026-08-01)** — PASS :
- la session existante a continué à charger le Dashboard, `/upload` et Daily v2,
  comportement compatible avec le maintien attendu des jetons non expirés
  antérieurs à la rotation ;
- après déconnexion puis reconnexion manuelle, une nouvelle session a été émise
  avec succès alors qu'ES256 était la clé courante et l'unique clé publiée par
  le JWKS ; le jeton n'a été ni lu, ni décodé, ni journalisé ;
- le Dashboard authentifié a chargé les données ; `/upload` a conservé le garde
  `Production en lecture seule` ; Daily v2 a chargé avec
  `Verrou serveur : lecture seule imposée` ;
- aucune importation, promotion, supersede, administration ou mutation métier ;
  aucune modification Git, Lovable ou Supabase pendant la validation.

**Révocation production Legacy HS256 (2026-08-01)** — PASS :
- éligibilité recontrôlée en lecture seule à `2026-08-01T12:13:40Z`, après la
  borne conservatrice `2026-08-01T12:00:00Z` ; access tokens toujours configurés
  à 3 600 secondes, clés API legacy toujours désactivées et vérification par
  secret legacy de l'Edge Function `mcp` toujours désactivée ;
- cible exacte `leakcdbbawzysfqyqsnr` confirmée avant l'action ; ECC P-256 /
  ES256 était courante et Legacy HS256 était l'unique clé précédente ;
- sous GO production nominatif, Legacy HS256 a été révoquée puis confirmée dans
  `Revoked keys`. ECC P-256 / ES256 est restée courante ; aucune clé n'a été
  supprimée et aucune autre configuration Auth n'a été modifiée ;
- post-contrôle à `2026-08-01T12:18:45Z` : JWKS public limité à une clé `EC` /
  `ES256` / `sig` avec `kid`, clés API legacy toujours désactivées ;
- le Dashboard authentifié a continué à charger sans redirection, erreur JWT,
  `Invalid API key` ni erreur d'autorisation ; aucune mutation métier ;
- le chemin de récupération `Move to standby key` reste disponible sur la clé
  révoquée. Toute remise en standby puis rotation exige un GO production séparé.

**Portée résiduelle** : production n'accepte plus Legacy HS256 comme clé de
signature et conserve ES256 comme clé courante. Les clés legacy staging restent
actives après le rollback de correction de cible et sont hors périmètre de cette
révocation.

**Suite** : review/merge de ce record, puis clôture du lot SEC-ENV-1. Aucun autre
changement de clé production n'est requis par ce lot.

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

---

## LOT-4D.1 — CLOSED (2026-05-06) — Extraction type partagé `ProcessingResult` / `FileDetectionResult`

**Type** : micro-patch typage, aucun changement runtime.

**Contexte** : Lot 4D.0 (REPORT_ONLY) a confirmé que les interfaces `ProcessingResult` exportées par `fileProcessingService` et `enhancedFileProcessingService` étaient strictement identiques, et que `ProcessingResultsDetailed` importait le type depuis `enhancedFileProcessingService` alors qu'il pouvait recevoir un résultat issu de `fileProcessingService` (couplage fragile).

**Travail effectué** :
- Créé `src/types/processing.ts` exportant `ProcessingResult` et `FileDetectionResult` (copie exacte des champs existants, aucun renommage, aucun ajout, aucun retrait).
- `src/services/fileProcessingService.ts` : interface locale `ProcessingResult` supprimée → import + re-export type depuis `@/types/processing`.
- `src/services/enhancedFileProcessingService.ts` : interfaces locales `ProcessingResult` et `FileDetectionResult` supprimées → import + re-export type depuis `@/types/processing`.
- `src/components/ProcessingResultsDetailed.tsx` : import `ProcessingResult` désormais depuis `@/types/processing`.

**Vérifications** :
- `rg "interface ProcessingResult" src/` → uniquement `src/types/processing.ts` (et `ProcessingResultsDetailedProps`, qui est une interface de props distincte).
- `rg "interface FileDetectionResult" src/` → uniquement `src/types/processing.ts`.
- Build TypeScript vert (`tsc --noEmit` → 0 erreur).
- Aucun changement runtime, aucune logique modifiée dans `processFiles` / `processFilesArray`.
- Re-exports type conservés sur les deux services pour préserver la compatibilité des imports existants (ex. `FileUploadBulk.tsx` importe `ProcessingResult` depuis `enhancedFileProcessingService`).

**Hors scope** : `HeartbeatService`, `BatchProcessingService`, `intelligentSyncService`, `excelProcessingService`, `excelMappingService`, `FileUpload.tsx`, `FileUploadBulk.tsx`. Aucun SQL, aucune migration, aucune RLS/auth/schéma. Lot 4D.2 / 4D.3 / 4D.4 non ouverts. DEF-05 reste **OPEN** (préparé, non résolu). DEF-07 partiellement avancé. UX-SYNC-COUNTERS, DEF-10, DEF-14 non traités.

---

## LOT-4D.1.bis — CLOSED (2026-05-06) — Nettoyage wording `ProcessingResultsDetailed`

**Type** : micro-patch UX wording, aucun changement logique.

**Travail effectué** dans `src/components/ProcessingResultsDetailed.tsx` :
- "Résumé du Traitement (Corrigé)" → "Résumé du traitement"
- Description : "Résultats de l'importation et de la synchronisation des données"
- Bloc "Corrections Automatiques Appliquées" → "Traitement contrôlé" avec puces neutres (traçabilité Excel, idempotence, montants valides)
- "Données extraites avec corrections automatiques" → "Données extraites et synchronisées"
- Actions recommandées : suppression mentions AMOUNT/N/A/tableau de bord consolidé, remplacées par avertissements / lignes rejetées / dashboard principal ou Collections.

**Vérifications** :
- Build TypeScript vert.
- `rg "N/A|Vue Consolidée|tableau de bord consolidé|Corrections Automatiques|Corrigé"` → seul résultat = commentaire interne ligne 59 (`exclure les éléments synthétiques comme "N/A"`), justifié (logique de filtrage existante, hors périmètre wording UI).

**Hors scope** : aucun changement de calcul, JSX structurel ou compteur. Aucune modification de `ProcessingResult`, services, SQL, migrations, RLS. DEF-05 inchangé. Lot 4D.2 non ouvert.

---

## UX-SYNC-COUNTERS — PASS DÉFINITIF batch-safety legacy (2026-05-06)

**Statut** : `CLOSED` — compteurs UX de synchronisation Excel validés sur le pipeline `/upload` legacy (`fileProcessingService` → `BatchProcessingService` → `intelligentSyncService`).

**Contexte** : conditions de déblocage posées par `docs/LOT4D20_BATCH_SAFETY_AUDIT.md` (LOT-4D.2.0, REPORT_ONLY) — validation T2/T3 sur fichier Excel réel + contrôle SQL 0 doublon par traçabilité.

**Preuves**

- T1 (`new_collections`) : déjà vert avant ce lot.
- Fichier du jour `COLLECTION REPORT-2026.xlsx` traité sur `/upload` legacy :
  - **Pass 1** : 656 lignes, T1=8, T2=601, T3=47, T4=0, somme = 656.
  - **Pass 2** (réimport identique) : 656 lignes, T1=0, T2=609, T3=47, T4=0, somme = 656.
- Contrôle SQL doublons (read-only) :
  - `SELECT excel_filename, excel_source_row, COUNT(*) ... WHERE excel_filename ILIKE '%COLLECTION REPORT%' HAVING COUNT(*) > 1` → **0 ligne**.
  - `SELECT COUNT(*) FROM (... GROUP BY excel_filename, excel_source_row HAVING COUNT(*) > 1) d` (global) → `duplicates_by_traceability = 0`.
  - Vérif par fichier : `rows == distinct_rows` sur tous les fichiers (`COLLECTION REPORT-2026.xlsx` 656/656, `COLLECTION REPORT-2025.xlsx` 913/913, etc.).

**Conclusion**

- Compteur **T1 `new_collections`** : fiable (0 sur réimport, conservation totale).
- Compteur **T2 `idempotent_updates`** : fiable, monte de 601 à 609 entre les deux passes (cohérent avec les 8 nouvelles lignes de la pass 1 qui basculent en idempotent à la pass 2).
- Compteur **T3 `enriched_collections`** : valeur **stable** (47 → 47) mais **non strictement idempotent** au réimport — voir `DEF-UX-COUNTERS-01` dans `DEFERRED_BACKLOG.md`. Donnée saine (T1=0 + 0 doublon SQL le prouvent), seule l'étiquette du compteur est sous-optimale.
- Conservation Σ = 656/656 sur les deux passes.
- Idempotence `(excel_filename, excel_source_row)` confirmée côté DB.

**Effets sur le backlog**

- **LOT-4D.2.b.0 PLAN_REVIEW** : **DÉBLOQUÉ** (extraction `aggregateBatchResults` → `src/services/syncResultAggregator.ts`, READ_ONLY prévu).
- **LOT-4D.2.b runtime** : toujours **non ouvert**.
- **LOT-4D.3** (bascule `/upload` vers `enhanced`) : **interdit**.
- **DEF-05** : reste **OPEN** (la divergence des pipelines n'est pas résolue par cette validation).
- **DEF-UX-COUNTERS-01** (nouveau, mineur) : créé dans `DEFERRED_BACKLOG.md`.

**Hors scope** : aucun fichier `src/` modifié, aucun SQL correctif, aucune migration, aucune RLS/auth/schéma, aucun patch runtime, `LOT4D20_BATCH_SAFETY_AUDIT.md` non modifié.

---

## Lot 0M-E — Reproductibilité full-chain (baseline pré-chaîne, Plan B)

**Statut : CLOSED** (patch local + tests Docker uniquement — aucun Supabase live)

**Objectif** : rendre la chaîne `supabase/migrations/` rejouable from-scratch
(constat 0M-B-RETRY : échec sur staging clean, 7 tables bootstrap absentes),
sans modifier aucune migration historique.

**Fichiers** :
- `supabase/migrations/20250625000000_baseline_prechain.sql` — nouveau (baseline 7 tables bootstrap)
- `supabase/migrations/20250626101100_bridge_neutralize_unique_excel_upsert.sql` — nouveau (bridge Plan B)
- `supabase/migrations/20260707000000_db_freeze_1b_collection_report_truth.sql` — nouveau (DB-FREEZE-1B v2)
- `supabase/db-archive/replay-dead-not-in-prod-ledger/` — quarantine `git mv` de `emerald_summit` + `cold_shore` (absents ledger prod, vérif opérateur 2026-07-09) + README
- `supabase/tests/full_chain_replay/` — shim plateforme minimal + runner + README
- `docs/DB_TRUTH.md` — §5 note 1B matérialisé, nouveau §8 reproductibilité

**Tests** : rejeu full-chain complet via `supabase db push --db-url` sur Postgres
Docker jetable → 29/29 versions au ledger local, RLS partout, zéro policy
permissive, `unique_excel_traceability` = text/NEVER, contrainte UNIQUE +
`idx_collection_excel_source` + CHECK présents, RPC v2 verrouillées, baseline
rollback + idempotence 2x, 1B idempotente. Suite v2 (rollback + 10→15 +
concurrence) re-PASS sur conteneur séparé. Build PASS (artefact MCP intact).
Lint : **211 erreurs préexistantes sur main @ fa85803**, étrangères au lot
(scope ESLint = `**/*.{ts,tsx}` ; diff du lot = sql/md/sh uniquement) et non
corrigeables ici (`src/**` interdit) — lot de nettoyage lint dédié à arbitrer.

**Réserve staging (0M-F)** : l'étape 0 de `20260430150428` (historique, prod)
exige que l'utilisateur `9539d4f5-…` existe dans `auth.users` — à provisionner
sur staging avant tout push (le shim de test le seed localement).

**Hors scope** : aucun `src/**`, aucun typegen, aucun Supabase live, aucun
commit/PR (verdict CTO attendu).
