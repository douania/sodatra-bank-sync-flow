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
| Dashboard principal | `/dashboard` | Actif, dépend de la qualité des imports et RLS |
| Import opérationnel | `/upload` | Pipeline global unique ; Collection Report/Internal Book candidats production ; rapports bancaires et Fund Position pilotes staging fail-closed ; production toujours désactivée |
| Alias upload bulk | `/upload-bulk` | Compatibilité : redirection vers `/upload`, aucun pipeline distinct |
| Document Understanding | `/document-understanding` | Analyse locale strictement read-only ; aucune sauvegarde ; les banques non qualifiées sont refusées explicitement |
| Quality Control | `/quality-control` | Actif |
| Reconciliation | `/reconciliation` | Hybride allégé : sync/collections actifs, moteur fictif supprimé |
| Daily v2 | `/daily-statements` | Actif : CSV structuré BDK/ORA et Excel ONLINE profilé ATB/BICIS/BIS/BRIDGE, dépôt daily ou backfill BIS admin sous grant, staging, promotion/supersede, canonical, audit et reporting ; accès par rôles ; cible verrouillée staging |

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

Le flux `/daily-statements` est séparé de ces deux pipelines :
- seuls les relevés ONLINE correspondant à un profil structurel exact sont acceptés ;
- les journaux mensuels Internal Book ne sont pas des relevés bancaires Daily v2 ;
- Excel structuré est la voie principale multi-banques, CSV BDK/ORA reste conservé et PDF reste un fallback séparé ;
- les fichiers BIS dépassant 45 jours utilisent exclusivement le mode backfill admin déjà borné par le contrat Daily v2.

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
- DEF-05 : `CLOSED`, pipeline global consolidé par la PR #130 ;
- Operational Import multi-bank : `IMPLEMENTED_LOCAL — INDEPENDENT_REVIEW_PASS_WITH_RESERVES`, contrats fail-closed et gate CI ajoutés sans promotion de banque ;
- OPS-CORE-1 : `CLOSED`, précontrôle d'import validé staging et publié en production le 2026-08-13 ;
- DEF-10 : `CLOSED`, OPS-CORE-2 validé en production le 2026-08-12 ;
- DEF-16 : `CLOSED`, OPS-CORE-4 validé en production le 2026-08-13 ;
- DEF-14 : 125 lignes historiques `client_code = 'UNKNOWN'` ;
- DEF-UX-COUNTERS-01 : compteur T3 enrichissements répété au réimport ;
- tests automatisés ;
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
