# MASTER CONTEXT — Bank Sync Flow (SODATRA)

> Source de vérité produit et technique courte.
> À lire avant tout chantier.
> Pour l'historique détaillé, voir `docs/STATUS_REGISTRY.md`.

## Objectif de l'application

Bank Sync Flow est une application interne SODATRA destinée à centraliser, importer, contrôler et exploiter les données bancaires issues d'imports manuels Excel/PDF.

Sources attendues :
- Collection Report
- Fund Position
- Client Reconciliation
- relevés bancaires BDK, BIS, SGS/SGBS, BICIS, ORA, ATB
- impayés
- effets
- chèques

Objectifs métier :
- fiabiliser les imports ;
- éviter les doublons ;
- contrôler la qualité des données ;
- suivre les positions et risques bancaires ;
- préparer un dashboard Direction fiable.

Il n'y a aucune connexion API directe aux banques. Toute donnée provient d'imports manuels Excel/PDF.

## Statut CTO actuel

Statut : prototype avancé / non encore production-ready.

Programme directeur (arbitrage CTO du 2026-09-06) : `SBSF-COMPLETE-OPERATIONAL-V1`,
sept packs dans l'ordre **Pack 0 → Pack 2 → Pack 1 → Pack 3 → Pack 4 → Pack 5 →
Pack 6**. Le catalogue contractuel V1 distingue le périmètre (`REQUIRED_V1`,
`OPTIONAL_POST_V1`, `EXPERIMENTAL`, `LEGACY_TO_RETIRE_OR_ISOLATE`) de la maturité
prouvée ; `REQUIRED_V1` ne prouve aucune disponibilité actuelle. Collections Core
devient la référence opérationnelle finale des Collections avec bascule contrôlée
(D-COL-1) ; le registre de comptes Daily v2 est l'identité canonique de compte
(D-COL-3) ; BRIDGE est `OPTIONAL_POST_V1`, Internal Book `OPTIONAL_POST_V1` sans
promesse de persistance, Daily PDF `EXPERIMENTAL`. Le Pack 0 (blocages critiques
et gouvernance) est **fusionné** (PR #146 → `main` = `a22ab60f`, 2026-09-07,
sous ruleset `protect-main` sans bypass, contre-review Codex favorable) et
**livré en production** le 2026-09-08 (`GO_PRODUCTION_PACK_0_PUBLISH`) : le
site publié sert un bundle dont la provenance embarquée est `known`, égale à
`a22ab60f`, CSS et chunks identiques au build local, un seul ref Supabase
`leakcdbbawzysfqyqsnr` ; verdict CTO `DELIVERED_WITH_PLATFORM_ATTESTATION`,
avec une réserve (génération du rapport Daily v2 non exercée au smoke). Les
contrôles DB read-only staging et production du 2026-09-07 avaient confirmé
les définitions des migrations `20260829000000`, `20260829120000` et
`20260901000000` et les verrous fermés ; le pilote Collection production
signalé et la dérive `collection_report.nj` sont maintenus au Pack 1. **Le
Pack 0 est clos** (`CLOSED — DELIVERED_WITH_PLATFORM_ATTESTATION —
FOLLOW_UPS_OPEN`, 2026-09-08) avec quatre suivis ouverts, chacun avec
responsable et critère de résolution dans le registre : mode de travail Lovable
par branche et PR (règle retenue, repli `lovable-sync` documenté mais non testé
sur ce projet, aucun tour agent production hors GO), visibilités (décision
reportée, aucun changement effectué), PR #118 (fermeture proposée, non
exécutée), smoke reporting Daily v2 `NOT_RUN` et 503 d'origine indéterminée.
Voir `docs/STATUS_REGISTRY.md` (entrée `PACK-0-CRITICAL-BLOCKERS-AND-GOVERNANCE`).

Le premier pilote réel ORABANK Daily v2 est toutefois validé avec réserves en production
(dépôt, promotion et reporting), puis reverrouillé. Cette réussite bornée ne
qualifie pas encore l'application entière ni le dashboard Direction.

Le pack `DAILY-V2-CANONICAL-OPERATIONAL-DASHBOARD`, fusionné via PR #139, est
publié en production et validé read-only avec réserves sur le pilote ORABANK
(clôture au 2026-08-31 Europe/Paris). Le dashboard affiche par défaut les seules
journées canonical actives : derniers soldes par identité/devise, flux, dates
des relevés et couverture explicite, sans total de soldes par devise. Les
sources historiques restent séparées. Les quatre verrous d'écriture restent
fermés. La matrice multi-rôles/refetch/concurrence et la qualification au-delà
du pilote restent à traiter sous GO distincts. Voir
`docs/DAILY_V2_CANONICAL_OPERATIONAL_DASHBOARD_REPORT.md`.

Le pack `DAILY-V2-SESSION-AND-ACCESS-UX-HARDENING`, fusionné via PR #141, est
publié en production et validé read-only avec réserves. Le badge distingue la
session, la cible, les rôles vérifiés et le verrou serveur ; les caches,
formulaires et réponses tardives sont bornés par la durée d'accès. Le smoke
authentifié production confirme le passage fail-closed par la vérification des
droits, puis la session `user + admin` et le verrou lecture seule, sans mutation.
Aucune modification Auth/RLS ou permission serveur. La matrice réelle
manager/auditor/user seul, la révocation, l'expiration et la concurrence restent
à qualifier sous GO distinct. Voir
`docs/DAILY_V2_SESSION_AND_ACCESS_UX_HARDENING_REPORT.md`.

Priorité actuelle :
1. sécurité Supabase / RLS ;
2. intégrité et idempotence des imports ;
3. réduction des mocks et code mort ;
4. stabilisation des pipelines ;
5. dashboard Direction fiable ;
6. fonctionnalités avancées.

Règle CTO permanente : aucune nouvelle fonctionnalité métier majeure avant stabilisation des P0/P1 documentés.

## Architecture actuelle

| Couche | Technologie |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| Backend | Supabase Auth + PostgreSQL + RLS |
| Hébergement / runtime | Lovable |
| État applicatif | React Query + état local |
| Imports | Parsing client-side TypeScript |

Pas de serveur backend custom.
Pas d'API bancaire directe.

## Documents canoniques

| Sujet | Document |
|---|---|
| Contexte maître | `docs/MASTER_CONTEXT.md` |
| État des lots | `docs/STATUS_REGISTRY.md` |
| Contrat sécurité | `docs/SECURITY_CONTRACT.md` |
| Backlog différé | `docs/DEFERRED_BACKLOG.md` |
| Vérité DB actuelle | `docs/DB_TRUTH.md` |
| Pipelines import | `docs/LOT4A_PIPELINES_AUDIT.md`, `docs/LOT4D0_PIPELINE_CONSOLIDATION_AUDIT.md` |
| Règles permanentes agents | `CLAUDE.md` (entrée : `AGENTS.md`) |
| Workflow des lots et GO | `docs/ops/OPS-WORKFLOW-V2-BANK-SYNC.md` |
| Baselines lint/typecheck/tests | `docs/BASELINES.md` (seuil ESLint exécutable : `.github/workflows/ci.yml`) |

## Modules actifs

| Module | Route | Statut |
|---|---|---|
| Dashboard principal | `/dashboard` | Daily v2 canonical par défaut en production ; smoke authentifié ORABANK validé avec réserves ; vue historique séparée, aucun total de soldes par devise ni ouverture d'écriture |
| Import opérationnel | `/upload` | Pipeline global unique ; contrat d'activation contrôlée Collection Report fusionné (PR #143/#144, CI verte), migration `20260901000000` observée **appliquée sur staging et en production** aux contrôles read-only du 2026-09-07 (scope de promotion fermé des deux côtés, `enabled_until` NULL, insertions directes dans `collection_report` refusées par trigger, chemin DELETE legacy et grants DML conservés) ; en production, la raison du verrou signale un pilote de deux lignes promu puis reverrouillé le 2026-09-02, sans GO tracé, consigné sans autorisation rétroactive ; Internal Book `BLOCKED` pour l'import opérationnel (parsing diagnostique local seulement, aucune persistance — Pack 0) ; rapports bancaires et Fund Position pilotes staging fail-closed ; production toujours désactivée |
| Alias upload bulk | `/upload-bulk` | Compatibilité : redirection vers `/upload`, aucun pipeline distinct |
| Document Understanding | `/document-understanding` | Analyse locale strictement read-only ; aucune sauvegarde ; les banques non qualifiées sont refusées explicitement |
| Quality Control | `/quality-control` | `LEGACY_TO_RETIRE_OR_ISOLATE` — **consultatif** depuis Pack 0 : aucune correction validée ni persistée ; seuls les crédits bancaires explicites servent de preuve ; sans preuve exploitable, « contrôle non évaluable ». La capacité de contrôle qualité V1 reste due dans les parcours métier |
| Reconciliation | `/reconciliation` | `LEGACY_TO_RETIRE_OR_ISOLATE` — **consultation seule** depuis Pack 0 : synchronisation Excel directe, marquage manuel effet/chèque et suppression de doublons neutralisés sur toutes les cibles (barrière d'interface, accès serveur non révoqués) |
| Daily v2 | `/daily-statements` | Runtime et scopes serveur publiés/appliqués ; verrous staging et production observés fermés le 2026-09-07 (maître et scopes `daily`/`admin`/`backfill` à `false` ; `GO_READ_STAGING_PACK_0_DB`, `GO_PRODUCTION_PACK_0_READ_ONLY_PREFLIGHT`) ; premier pilote réel ORABANK validé avec réserves jusqu'au reporting, puis reverrouillé ; profils CSV BDK/ORA et Excel ONLINE ATB/BICIS/BIS/BRIDGE éligibles, sans qualification production générale de ces profils |

## Modules supprimés / retirés

Les modules mockés purs ou routes fantômes ont été progressivement retirés dans Lot 4 :
- `/alerts`
- `/consolidated`
- `/consolidated-dashboard`
- `/banking/reports`
- `/banking/dashboard`

Les composants ou fichiers orphelins confirmés ont également été supprimés selon le registre de statut.

## Pipelines d'import

Le pipeline global est unique : `/upload` utilise `FileUpload.tsx` et
`fileProcessingService`. `/upload-bulk` redirige vers ce parcours. L'ancien
`FileUploadBulk.tsx` et `enhancedFileProcessingService` ont été retirés dans le
lot Operational Import Production Readiness ; **DEF-05 est clos depuis le merge
de la PR #130**. `Document Understanding` utilise le détecteur read-only
`documentDetectionService` et sa défense en profondeur refuse explicitement
`saveReport` avant tout accès Supabase.

Les rapports `/upload` BDK, ATB, BICIS, ORA, SGBS et BIS utilisent une identité
bancaire canonique corroborée entre nom et contenu. Leur extraction exige une
structure de lignes, une date calendaire et au moins un solde explicite valide.
Fund Position exige une date extraite, un grand total explicite (zéro autorisé)
et au moins un détail bancaire exploitable. Ces familles restent
`STAGING_PILOT` jusqu'à qualification sur fichiers réels anonymisés ; aucune
preuve synthétique ne vaut promotion production.

Le pack `COLLECTION-REPORT-CONTROLLED-PRODUCTION-ACTIVATION` (fusionné via PR #143,
hotfix CI PR #144, CI de `main` verte) prépare une
promotion atomique sous scope serveur privé, fermé par défaut et expirant, avec
validation stricte, idempotence acteur/commande SHA-256, rejeu conservateur,
fonction de détection effet/chèque conservatrice, audit avant/après capturé
sous verrou de ligne et refus de toute divergence d'identité sous verrou de
scope transactionnel. Il ne constitue pas une activation : la
migration candidate `20260901000000_collection_report_controlled_production_activation.sql`
n'était appliquée à aucun environnement à la fusion. Les contrôles read-only
du 2026-09-07 l'ont observée appliquée sur staging (ledger 44, application
2026-09-01 18:10 UTC) et en production (ledger 41), avec des définitions
effectives conformes au fichier et le scope de promotion fermé des deux côtés.
En production, la raison du verrou signale un pilote « two-row promotion »
complété puis reverrouillé le 2026-09-02 16:31 UTC ; aucun GO d'application
ni d'activation n'est tracé, le fait est consigné sans autorisation
rétroactive. Dérive de schéma constatée : `collection_report.nj` `numeric` en
production, `integer` en staging et dans la baseline. L'historique d'import
antérieur à ces lectures n'est pas établi par elles.
Voir `docs/COLLECTION_REPORT_CONTROLLED_PRODUCTION_ACTIVATION_REPORT.md`.

Le flux `/daily-statements` est séparé de ces deux pipelines :
- seuls les relevés ONLINE correspondant à un profil structurel exact sont acceptés ;
- les journaux mensuels Internal Book ne sont pas des relevés bancaires Daily v2 ;
- Excel structuré est la voie principale multi-banques, CSV BDK/ORA reste conservé et PDF reste un fallback séparé ;
- les fichiers BIS dépassant 45 jours utilisent exclusivement le mode backfill admin déjà borné par le contrat Daily v2.

Le pack `DAILY-V2-CONTROLLED-PRODUCTION-ACTIVATION-PILOT`, fusionné via PR #137,
est `CLOSED_WITH_RESERVE — ORA_FIRST_IMPORT_AND_REPORTING_VALIDATED — PILOT_RELOCKED`
au 2026-08-30. La migration
`20260829120000_daily_v2_controlled_production_pilot_server_scope.sql` et le
runtime ont été appliqués/publiés en staging puis production sous GO distincts.
Un export ORABANK a fourni trois journées et quatre lignes contrôlées, promues
et retrouvées dans le reporting Daily v2. Les interruptions de promotion ont
déclenché des fermetures de sécurité et des reprises bornées ; aucune donnée
validée n'a été supprimée pour simuler un rollback. Les quatre verrous — maître,
`daily`, `admin`, `backfill` — sont finalement `false` ; administration et backfill
n'ont jamais été ouverts pendant ce pilote production. Ce résultat ne promeut
ni les autres banques, ni `/upload`, ni Collection Report. Au terme de ce pilote,
le dashboard principal restait historique ; son raccordement canonical a ensuite
été publié et contrôlé dans le pack PR #139 décrit ci-dessus.
Voir `docs/DAILY_V2_CONTROLLED_PRODUCTION_ACTIVATION_PILOT_REPORT.md`.

## Vérité DB / idempotence

Pour `collection_report`, la source canonique d'idempotence métier est :
`(excel_filename, excel_source_row)`

La colonne `unique_excel_traceability` est legacy / auxiliaire.
Les migrations historiques divergentes ne doivent pas être réécrites.
Lire `docs/DB_TRUTH.md` avant tout chantier DB ou migration.

## Sécurité

Modèle actuel : mono-société SODATRA, invite-only.

Règles :
- sign-up public désactivé ;
- RLS durcies par Lot 2B ;
- pas de policy `USING(true)` ou `WITH CHECK(true)` ;
- pas de modification sécurité sans validation CTO ;
- `SECURITY_CONTRACT.md` est la référence stable.

## FROZEN / interdits permanents

Ne pas modifier sans justification CTO explicite :
- migrations historiques liées à `unique_excel_traceability` ;
- logique d'idempotence `(excel_filename, excel_source_row)` ;
- RLS/Auth Supabase ;
- pipeline Excel stabilisé Lot 3 ;
- extraction BDK critique ;
- DB-FREEZE-1B sans staging.

## Backlog prioritaire

Ouverts / suivis :
- Daily v2 production pilot : `CLOSED_WITH_RESERVE — ORA_FIRST_IMPORT_AND_REPORTING_VALIDATED — PILOT_RELOCKED` ;
- Dashboard opérationnel Daily v2 canonical : `CLOSED_WITH_RESERVE — PRODUCTION_DASHBOARD_READ_ONLY_VALIDATED — ORA_PILOT_SCOPE` ; le badge et les frontières de session sont publiés, tandis que la matrice réelle multi-rôles/révocation/refetch/concurrence reste ouverte ;
- DEF-05 : `CLOSED`, pipeline global consolidé par la PR #130 ;
- Operational Import multi-bank : `CLOSED — PRODUCTION_RUNTIME_VALIDATED_READ_ONLY`, contrat fail-closed publié et smokes production verts sans promotion de banque ;
- Qualification réelle multi-bank : `PREPARED_LOCAL — REAL_FILES_NOT_PROVIDED — STAGING_NOT_EXECUTED`, harness local sans persistance prêt avant campagne staging ;
- OPS-CORE-1 : `CLOSED`, précontrôle d'import validé staging et publié en production le 2026-08-13 ;
- DEF-10 : `CLOSED`, OPS-CORE-2 validé en production le 2026-08-12 ;
- DEF-16 : `CLOSED`, OPS-CORE-4 validé en production le 2026-08-13 ;
- DEF-14 : 125 lignes historiques `client_code = 'UNKNOWN'` ;
- DEF-UX-COUNTERS-01 : compteur T3 enrichissements répété au réimport ;
- PACK-0-CRITICAL-BLOCKERS-AND-GOVERNANCE : `CLOSED — DELIVERED_WITH_PLATFORM_ATTESTATION — FOLLOW_UPS_OPEN` (2026-09-08 ; production sur `a22ab60f`, provenance embarquée `known` ; contrôle qualité consultatif, isolation des écritures legacy, `xlsx@0.20.3`, ratchet ESLint resserré, Internal Book bloqué ; ruleset `protect-main` actif) ; suivis ouverts avec responsable et critère dans le registre : mode de travail Lovable par branche et PR (règle retenue, repli `lovable-sync` non testé), visibilités (décision reportée), PR #118 (fermeture proposée, non exécutée), smoke reporting `NOT_RUN` et 503 d'origine indéterminée ; maintenus au Pack 1 : pilote Collection production signalé, dérive `collection_report.nj` ;
- fermeture serveur des chemins d'écriture Collection legacy (Auth/rôles/RLS/grants) avant activation du nouveau contrat Collections — la neutralisation Pack 0 est une barrière d'interface uniquement ; sur staging (observation du 2026-09-07), le trigger `collection_report_atomic_write_guard_v1` bloque déjà INSERT direct et UPDATE d'identité stable, mais la policy legacy `Only admins can delete collections` et les grants DML `authenticated`/`service_role` sur `collection_report` restent en place : le chemin DELETE legacy est explicitement conservé ;
- tests automatisés (couverture mesurée, E2E réels) ;
- documentation utilisateur.

## Règle de travail

Tout chantier doit commencer par :
1. lire ce Master ;
2. lire `STATUS_REGISTRY.md` ;
3. lire `SECURITY_CONTRACT.md` si sécurité/RLS/Auth ;
4. lire `DB_TRUTH.md` si DB/migration/import ;
5. vérifier le repo avant toute conclusion ;
6. proposer un plan ;
7. attendre GO CTO avant patch.
