# SECURITY BACKLOG — Bank Sync Flow

> Suivi des sujets sécurité ouverts. Ne contient aucune correction runtime.

## Résumé

Le linter Supabase détecte **60 warnings** :
- 27 policies RLS avec `USING(true)` / `WITH CHECK(true)`
- 13 tables exposées via GraphQL à anon
- 13 tables exposées via GraphQL à authenticated
- 2 fonctions SECURITY DEFINER appelables par anon
- 2 fonctions SECURITY DEFINER appelables par authenticated
- OTP expiry trop long
- Leaked password protection désactivée
- Postgres avec patches sécurité disponibles

---

## P0 — Critique

### P0-01 / SEC-ENV-1 : URL Supabase et clé anon hardcodées dans le client

**État** : `CLOSED — PRODUCTION_LEGACY_HS256_REVOKED_RUNTIME_VALIDATED` (2026-08-01)

**Contexte** : `src/integrations/supabase/client.ts` contenait jusqu'au 2026-05-05 l'URL Supabase et la clé anon en dur. La clé JWT `anon` est publique côté frontend, mais elle reste couplée au secret JWT historique et n'est plus le format recommandé pour un nouveau déploiement.

**Action runtime appliquée (lot SEC-ENV-1)** :
- `src/integrations/supabase/client.ts` lit désormais `import.meta.env.VITE_SUPABASE_URL` et `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`, avec `throw` explicite si l'une des deux est absente au démarrage.
- `src/vite-env.d.ts` typé pour `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
- `.env.example` créé à la racine, sans valeur réelle.
- `.gitignore` non modifié (volontaire) : `.env` est le canal public versionné
  requis par Lovable ; `.env.local` et `.env.*.local` restent ignorés.

**Migration appliquée** :
- `.env` remplace le JWT `anon`, puis la clé moderne `web` refusée par la
  passerelle, par la clé API publishable `default` active de production ; aucune
  clé backend n'est ajoutée ;
- le test de bundle exige désormais `sb_publishable_*` et refuse le retour
  d'un JWT historique ;
- les exemples documentaires utilisent uniquement
  `VITE_SUPABASE_PUBLISHABLE_KEY` et `VITE_SUPABASE_PROJECT_ID`.

**Validation locale candidate (2026-07-31)** : matrice CI complète PASS, dont
99/99 tests Daily v2 ; build PASS ; bundle confirmé avec la clé publishable et
sans ancienne clé JWT ni marqueur backend ; dette ESLint (209 erreurs,
11 warnings) et TypeScript (19 erreurs) strictement identique à `origin/main`.

**Validation staging authenticated (2026-07-31)** : PASS sur le runtime corrigé
ciblant explicitement `gbbsqcscryygqlmqncyv`. Auth reconnaît la clé publishable
moderne ; le login manuel, le maintien de session après reload et les lectures
`/dashboard` puis `/daily-statements` passent sans erreur Auth/réseau/console.
L'UI confirme que dépôt, promotion, supersede et administration sont désactivés.
Aucune mutation métier n'a été tentée et aucun bouton de mutation n'a été
utilisé. Un premier harness mal ciblé production a été refusé avec
`Invalid API key`, diagnostiqué puis arrêté avant le test concluant.

**Cleanup local (2026-07-31)** : la surcharge `.env.local` staging préexistante
a été supprimée sous GO explicite ; aucun `.env.local` ne subsiste dans les
worktrees contrôlés.

**Préflight production (2026-07-31)** : GitHub et Lovable étaient alignés sur le
merge PR #112 `3440111af887ddad2b1d206fa9ed822f18a7fc13`. Les clés publishable
`web` embarquée et `mobile` listée répondaient toutes deux `401` sur Auth et
PostgREST, tandis que la clé JWT legacy production restait valide (`200`).

**Initialisation additive des clés modernes** : le Dashboard Supabase exigeait
la création couplée d'une paire `default`. La publishable `default` est reconnue
par Auth (`200`) et atteint PostgREST avant le refus de grant attendu sur
`collection_report` (`401` / `42501`). La clé secret `default` n'a jamais été
révélée, copiée, utilisée ou versionnée. Les clés JWT legacy restent actives et
aucune révocation n'a été effectuée.

**Correction Git fusionnée** : la PR #113 a placé sur `main` la publishable
`default`, au merge `777adc47cd91833566a5058f238dd0865688a2ca`. La PR #114 a
consigné la validation runtime initiale ; son merge
`5ada2680dcc69572a36c64f8cc88c8901103c4fc` est aligné entre GitHub et le
preview Lovable canonique.

**Validation runtime `authenticated` production (2026-07-31)** : PASS. La
session production reste reconnue après rechargement complet. `/upload` affiche
le garde `Production en lecture seule` et maintient import, traitement et
promotion désactivés. Le Dashboard se charge puis s'actualise avec quatre appels
Supabase `GET`, tous `200`, et la clé réellement envoyée correspond à la
publishable `default` attendue sans révélation de sa valeur. Aucune erreur
`Invalid API key`, variable Vite manquante ou `AuthProvider` n'est observée.
Aucun import, export, téléchargement de fichier ou appel métier de mutation n'a
été exécuté.

**Désactivation legacy production et correction de cible (2026-08-01)** :
- cartographie canonique confirmée par `.env`, les contrats runtime et le trafic
  observé : staging `gbbsqcscryygqlmqncyv`, production
  `leakcdbbawzysfqyqsnr` ; le libellé Supabase `main — Production` désigne la
  branche principale d'un projet et ne prouve pas l'environnement SODATRA ;
- une première désactivation a visé staging après interprétation erronée de ce
  libellé. Le trafic Lovable a révélé l'écart avant toute validation concluante ;
  staging a été réactivé immédiatement et son état initial restauré ;
- la production exacte, affichée `sodatra-accounting`, a ensuite été verrouillée
  par son `project_ref`. Les clés modernes `default` étaient présentes, puis les
  clés legacy `anon` et `service_role` ont été désactivées ensemble comme clés
  d'API. Le contrôle de réactivation est disponible.

**Validation post-désactivation `authenticated` production (2026-08-01)** :
PASS. Après rechargements complets, la session reste reconnue. Le Dashboard émet
5 lectures Supabase (`collection_report`, `user_roles`, `bank_reports`,
`collection_report`, `fund_position`), `/upload` émet 1 lecture `user_roles` et
Daily v2 émet 6 lectures (`user_roles`, `daily_statement_units_staging`,
`daily_statement_units_canonical`, `daily_statement_import_events`,
`daily_statement_account_events`, `daily_statement_account_registry`). Les 12
appels sont des `GET` en `200`, avec une publishable moderne dans `apikey` et le
JWT utilisateur dans `Authorization`. Aucun appel n'utilise une clé legacy ou
secrète ; aucune mutation métier ni erreur console/réseau n'est observée.
`/upload` et Daily v2 conservent le garde `Production en lecture seule`. Aucune
valeur de clé n'a été révélée ou copiée.

**Migration additive des clés de signature Auth (2026-08-01)** : le préflight
production a confirmé des access tokens de 3 600 secondes, l'absence de limite
maximale ou d'inactivité de session, la protection contre le rejeu des refresh
tokens et l'absence de consommateur versionné dépendant du secret JWT legacy.
La seule Edge Function inventoriée, `mcp`, n'utilise pas la vérification JWT par
secret legacy. La migration additive a conservé Legacy HS256 comme clé courante
et créé une clé ECC P-256 / ES256 en standby, sans révocation.

**Rotation production vers ES256 (2026-08-01)** : PASS. La rotation a été
déclenchée à `2026-08-01T10:44:22.586Z` sur le projet exact
`leakcdbbawzysfqyqsnr`, puis l'état final ES256 a été confirmé quelques secondes
plus tard. ECC P-256 / ES256 est désormais courante ; Legacy HS256 est une clé
précédente encore acceptée pour les jetons non expirés. Aucune clé n'a été
révoquée ou supprimée. Les clés API legacy restent désactivées et le JWKS public
expose une clé `EC` / `ES256` / `sig` avec `kid`.

**Validation runtime post-rotation (2026-08-01)** : PASS. La session existante
a continué à charger le Dashboard, `/upload` et Daily v2. Après déconnexion puis
reconnexion manuelle, une nouvelle session a été créée avec succès sous la clé
courante ES256, sans lecture ni décodage du jeton. Le Dashboard a chargé ses
données, `/upload` est resté en `Production en lecture seule` et Daily v2 a
confirmé `Verrou serveur : lecture seule imposée`. Aucune mutation métier,
modification Git, Lovable ou Supabase n'a été effectuée pendant la validation.

**Révocation production Legacy HS256 (2026-08-01)** : PASS. L'éligibilité a été
recontrôlée à `2026-08-01T12:13:40Z`, après la borne conservatrice
`2026-08-01T12:00:00Z`, sur le projet exact `leakcdbbawzysfqyqsnr`. Les access
tokens restaient configurés à 3 600 secondes, les clés API legacy étaient
toujours désactivées et l'Edge Function `mcp` n'utilisait toujours pas la
vérification par secret legacy. Sous GO production nominatif, Legacy HS256 est
passée de clé précédente à clé révoquée ; ECC P-256 / ES256 est restée courante
et aucune clé n'a été supprimée. À `2026-08-01T12:18:45Z`, le JWKS public
n'exposait qu'une clé `EC` / `ES256` / `sig` avec `kid`, et les clés API legacy
restaient désactivées. Le Dashboard authentifié a continué à charger sans erreur
JWT, `Invalid API key` ni erreur d'autorisation. Aucune mutation métier n'a été
effectuée.

**État cryptographique final** : `anon` et `service_role` restent refusées comme
clés dans l'en-tête `apikey` ; Legacy HS256 n'est plus acceptée comme clé de
signature en production et ES256 reste courante. Les clés legacy staging restent
actives après le rollback de correction de cible et sont hors périmètre de cette
révocation.

**Rollback fail-closed** : ne pas revenir à la publishable `web` invalide et ne
pas réintroduire de JWT legacy dans le build. La réactivation production des
clés legacy reste techniquement disponible dans le Dashboard, mais n'est
autorisée qu'en réponse à un client hors inventaire effectivement cassé et sous
GO CTO explicite. Corriger ensuite en avant vers une publishable ou une secret
moderne. Le rollback de signature reste borné : déplacer la clé HS256 révoquée
vers standby, puis effectuer une rotation contrôlée sous GO production distinct.
La clé n'a pas été supprimée et aucune restauration DB n'est nécessaire.

**Liens** :
- https://supabase.com/dashboard/project/leakcdbbawzysfqyqsnr/settings/api-keys
- https://supabase.com/dashboard/project/leakcdbbawzysfqyqsnr/settings/jwt

**Voir aussi** : `docs/STATUS_REGISTRY.md` → `SEC-ENV-1`.

---

### SEC-01 : Sign-up public toujours actif côté Supabase

**État** : `CLOSED` — Vérification visuelle 2026-05-04 — toggle *Allow new users to sign up* = OFF dans Authentication → Sign In / Providers.
**Risque** : N'importe qui peut créer un compte et accéder à toutes les données bancaires (combiné avec RLS permissives).
**Action** : Désactiver "Enable sign ups" dans Authentication → Providers → Email dans le dashboard Supabase.
**Lien** : https://supabase.com/dashboard/project/leakcdbbawzysfqyqsnr/auth/providers

### SEC-02 : RLS permissives sur 10 tables

**État** : `CLOSED` — corrigé par la migration Lot 2B (`supabase/migrations/20260430150428_04e86234-f4a5-447b-8638-8f85518fa4ef.sql`). Vérification post-migration : 0 policy `USING(true)` / `WITH CHECK(true)` restante en schéma `public`. Tests fonctionnels validés 2026-05-04 : login `sodatrasn@gmail.com`, dashboard, lecture `collection_report`, import simple, console sans `42501`/RLS, logs Postgres sans `permission denied`.
**Risque** : Tout utilisateur authentifié peut lire, écrire, modifier et supprimer toutes les données de toutes les tables (sauf `user_roles`, `bank_audit_log`, `universal_bank_reports` qui ont des policies correctes).

**Tables concernées** :
| Table | Policies `true` | Operations exposées |
|---|---|---|
| `bank_reports` | 7 | SELECT, INSERT, UPDATE, ALL |
| `bank_facilities` | 5 | SELECT, INSERT, ALL |
| `deposits_not_cleared` | 5 | SELECT, INSERT, ALL |
| `fund_position` | 5 | SELECT, INSERT, ALL |
| `fund_position_detail` | 5 | SELECT, INSERT, ALL |
| `fund_position_hold` | 5 | SELECT, INSERT, ALL |
| `impayes` | 5 | SELECT, INSERT, ALL |
| `client_reconciliation` | 3 | SELECT, INSERT, ALL |
| `bank_evolution_tracking` | 2 | ALL |
| `collection_report` | 1 | INSERT |

**Problème additionnel** : la plupart des tables ont des policies dupliquées (2-3 policies pour la même opération). À nettoyer.

### SEC-03 : Décision mono-société vs multi-tenant

**État** : `CLOSED` — modèle mono-société SODATRA invite-only acté et appliqué par les policies de la migration Lot 2B (vérification de rôle valide parmi `admin`, `manager`, `auditor`, `user`).
**Contexte** : Aucune table (sauf `universal_bank_reports`) n'a de `user_id`. L'architecture actuelle est de facto mono-société.
**Décision préliminaire CTO** : mono-société / invite-only.
**Impact** : Si mono-société, les policies doivent vérifier un rôle valide parmi admin, manager, auditor ou user. Ne pas supposer qu'un admin possède aussi le rôle user. Si multi-tenant, il faut ajouter `organization_id` partout.

### SEC-04 : Auditer les utilisateurs existants

**État** : `CLOSED` — `auth.users` ne contient qu'un seul utilisateur, `sodatrasn@gmail.com`, portant les rôles `user` + `admin` (vérifié 2026-05-04). Aucun compte non autorisé à supprimer.
**Action** : Vérifier quels comptes existent dans `auth.users`, supprimer les comptes non autorisés, s'assurer que les rôles sont correctement assignés.
**Lien** : https://supabase.com/dashboard/project/leakcdbbawzysfqyqsnr/auth/users

---

## P1 — Important / Lot 2 ou 2B

### SEC-05 : GraphQL schema exposé à anon

**État** : `CLOSED` — migration
`20260731120000_sec_05_graphql_and_anon_grants.sql` appliquée au staging
`gbbsqcscryygqlmqncyv`, puis en production `leakcdbbawzysfqyqsnr` le
2026-07-31. Validation authenticated production : `PASS`.
**Constat initial vérifié le 2026-07-31** : `pg_graphql` était actif en production
et exposait à `anon` les opérations GraphQL générées par les grants de 13 tables
historiques, ainsi que `clean_client_name(text,text)`. La RLS empêchait la
lecture de lignes lors des contrôles anonymes, mais les grants CRUD conservaient
une surface inutile et transformeraient une future régression RLS en accès réel.
Le frontend et les services versionnés n'utilisent pas GraphQL.
**Correction fail-closed appliquée** : désactiver `pg_graphql` sans `CASCADE`,
révoquer tous les privilèges `PUBLIC`/`anon` sur les 13 tables, révoquer
`EXECUTE` sur `clean_client_name` pour `PUBLIC`/`anon`, puis fermer les default
privileges futurs `public` (tables, séquences et fonctions). Les grants
`authenticated`/`service_role` et les policies RLS restent inchangés.
**Validation locale** : replay full-chain PostgreSQL 15 jetable vert, 36/36
migrations au ledger, assertions SEC-05 vertes et teardown confirmé
(`ALL_FULL_CHAIN_PASS`). Limite : l'image `postgres:15-alpine` ne contient pas
`pg_graphql`; elle valide la syntaxe et l'état final absent, pas le retrait
d'une extension réellement installée.
**Review IA indépendante** : `PASS`, aucun finding P0/P1/P2 restant.
**Validation staging** : préflight 35 migrations, 13/13 tables avec CRUD anon,
`clean_client_name` exécutable par anon et `pg_graphql` déjà absent. Apply
atomique vert (`SEC05_STAGING_APPLY_OK`). Post-check : ledger 36/36, zéro table
SEC-05 privilégiée pour anon, 13/13 grants CRUD préservés pour `authenticated`
et `service_role`, fonction fermée à anon, zéro fuite `PUBLIC`/anon dans les
default ACL SEC-05 concernées, RLS activée sur 13/13 tables.
HTTP anon read-only : REST `401/42501`; GraphQL HTTP 200 sans schéma et erreur
`pg_graphql extension is not enabled`. Aucune mutation de test.
**Validation runtime `authenticated` staging** : frontend local configuré
exclusivement pour `gbbsqcscryygqlmqncyv`, session réelle `user` + `admin`,
lectures Dashboard/Daily v2 vertes, verrou serveur read-only affiché et 13/13
tables exactes SEC-05 accessibles en `HEAD` HTTP 200 sans téléchargement de
lignes. `clean_client_name(text,text)` reste exécutable par `authenticated`
(HTTP 200, entrée synthétique). Zéro trafic du frontend local vers la production
et zéro mutation métier ; les seuls `POST` observés étaient les RPC read-only de
lecture du verrou et de nettoyage de chaîne.
Le preview Lovable disponible ciblait la production `leakcdbbawzysfqyqsnr` ;
il a été exclu dès la détection, après des lectures `GET` uniquement et sans
mutation production.
**Apply production** : base canonique PR #109
`c13afbf818edcd840c5fcdc0b62e3dc9a562892b`. Le préflight a confirmé
`pg_graphql 1.5.11` actif mais détenu par `supabase_admin`, non supprimable par
le rôle `postgres`. Après vérification de zéro dépendant externe, l'extension a
été désactivée via le contrôle privilégié Extensions du Dashboard Supabase. La
migration et son entrée de ledger ont ensuite été appliquées atomiquement
(`SEC05_PRODUCTION_APPLY_OK`) : ledger 36/36, dernière version
`20260731120000`, zéro privilège anon sur les 13 tables et la fonction, grants
CRUD `authenticated`/`service_role` préservés sur 13/13 tables, RLS inchangée.
Les default privileges du schéma `public` sont fermés à anon et le défaut global
`EXECUTE TO PUBLIC` est retiré ; les defaults `storage`, hors périmètre, sont
inchangés. HTTP anon read-only : 13/13 routes REST `401`, RPC
`clean_client_name` `401/42501`, GraphQL désactivé. L'intégrité agrégée de
`collection_report` est strictement identique avant/après et aucune mutation
métier n'a été exécutée.
**Validation runtime `authenticated` production** : preview Lovable canonique
sur `c13afbf818edcd840c5fcdc0b62e3dc9a562892b`, session `user` + `admin` sans
inspection d'identifiant ni de jeton, Dashboard chargé et actualisé, Daily v2
chargé en lecture seule avec les vues Staging, Canonical, Audit et Reporting.
Aucune erreur console, `401`, `403` ou `42501`, et aucune capacité de mutation
utilisée. La matrice SQL exhaustive couvre 13/13 tables ; les tables sans
consommateur UI n'ont pas été appelées individuellement depuis le navigateur,
limite non bloquante.
**Clôture** : le retrait de l'extension réellement active a été exercé avec
succès en production. Toute réactivation de GraphQL ou réouverture de grants
anon exige un GO sécurité séparé.

### SEC-06 : Fonctions SECURITY DEFINER callable par anon

**État** : `CLOSED` — corrigé par la migration Lot 2B : `REVOKE EXECUTE ... FROM PUBLIC` sur `has_role` et `handle_new_user`, `GRANT EXECUTE` sur `has_role` à `authenticated` et `service_role` uniquement.
**Fonctions** : `has_role`, `handle_new_user`
**Action** : `REVOKE EXECUTE ON FUNCTION has_role FROM anon;` et idem pour `handle_new_user`.

### SEC-07 : Policies insert collection_report trop ouvertes

**État** : `CLOSED` — policies `collection_report` refaites en Lot 2B avec `WITH CHECK` basé sur `has_role` (admin/manager pour INSERT/UPDATE, admin pour DELETE).
**Détail** : `authenticated_insert_collections` a `WITH CHECK (true)` alors que les autres policies de `collection_report` utilisent `has_role`. Incohérence.

---

## P2 — Souhaitable / Différé

### SEC-08 : Supabase URL et anon key hardcodées

**État** : Différé
**Fichier** : `src/integrations/supabase/client.ts`
**Contexte** : L'anon key est une clé publique, acceptable côté frontend. Le vrai risque vient de la combinaison avec les RLS permissives (P0). Passer en `import.meta.env` serait plus propre mais non urgent.

### SEC-09 : OTP expiry trop long

**État** : Différé
**Action** : Réduire dans Supabase Dashboard → Authentication → Settings.

### SEC-10 : Leaked password protection désactivée

**État** : Différé
**Action** : Activer dans Supabase Dashboard → Authentication → Settings.

### SEC-11 : Postgres version avec patches sécurité

**État** : Différé
**Action** : Upgrader Postgres via Supabase Dashboard.

---

## Tables correctement protégées (référence)

| Table | Protection |
|---|---|
| `user_roles` | Admin-only INSERT/UPDATE/DELETE, user voit ses propres rôles |
| `bank_audit_log` | Admin-only SELECT, no UPDATE/DELETE, INSERT scoped à user_id |
| `universal_bank_reports` | Policies basées sur user_id et has_role |
