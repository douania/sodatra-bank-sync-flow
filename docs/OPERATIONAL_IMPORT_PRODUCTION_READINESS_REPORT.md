# Operational Import — Production Readiness

## Statut

`IMPLEMENTED_LOCAL — REVIEW_REQUIRED` — 2026-08-20.

Ce lot prépare une activation contrôlée ; il **n’active aucune mutation en
production**. La politique de cible conserve la production en lecture seule.
Aucun environnement Supabase/Lovable, aucune migration, aucun SQL, aucun
grant/RLS et aucune donnée bancaire réelle n’ont été utilisés.

## Résultat fonctionnel

- `/upload` devient l’unique pipeline d’import global ;
- `/upload-bulk` reste une URL de compatibilité et redirige vers `/upload` ;
- la page orpheline `FileUploadBulk.tsx` et le moteur redondant
  `enhancedFileProcessingService.ts` sont supprimés ;
- `Document Understanding` conserve sa détection via un service read-only
  isolé, sans dépendance au pipeline de mutation ;
- la page `/upload` affiche la disponibilité réelle de chaque famille et son
  niveau de preuve ;
- sur cible autorisée, l’interface d’import n’est accessible qu’aux rôles
  `admin` et `manager` ; attente, échec de lecture des rôles et rôle insuffisant
  ferment l’interface par défaut ;
- la sécurité réelle reste côté serveur (Auth, rôles, RLS, grants et RPC). Le
  contrôle de rôle frontend est une barrière UX supplémentaire, pas une
  autorisation de sécurité.

## Matrice de qualification

| Famille | Route / formats | Qualification | Décision |
|---|---|---|---|
| Collection Report | `/upload`, XLSX/XLS | `PRODUCTION_CANDIDATE` | Précontrôle, review humaine, promotion explicite et tests synthétiques |
| Internal Book | `/upload`, XLSX/XLS | `PRODUCTION_CANDIDATE` | Détection structurelle, sélection et orchestration synthétiques |
| Rapport BDK | `/upload`, PDF | `PRODUCTION_CANDIDATE` | Suite BDK PDF dédiée et persistance atomique déjà couverte |
| Rapports ATB/BICIS/ORA/SGBS/BIS | `/upload`, PDF/Excel | `STAGING_PILOT` | Interdits par le précontrôle si une future cible production ouvre `/upload`, tant qu’une preuve banque par banque manque |
| Fund Position | `/upload`, PDF/Excel | `STAGING_PILOT` | Extraction/persistance présentes, qualification fichier complète encore requise |
| Client Reconciliation | `/upload`, Excel | `BLOCKED` | Moteur d’import réel absent |
| Relevés structurés Daily v2 | `/daily-statements` | `PRODUCTION_CANDIDATE` | Voie séparée déjà couverte, production toujours read-only |

`PRODUCTION_CANDIDATE` signifie uniquement « éligible à une future validation
staging/production ». Ce statut n’accorde aucune capacité runtime.

## Contrats fail-closed

1. La cible doit être l’un des projets autorisés et cohérente URL/project ref.
2. La politique cible doit accorder explicitement la capacité de mutation.
3. La lecture des rôles doit réussir.
4. L’utilisateur doit avoir `admin` ou `manager`.
5. Le fichier doit passer le précontrôle format/type/cardinalité.
6. Sur une future cible production ouverte, le format doit être
   `PRODUCTION_CANDIDATE`; les pilotes staging sont bloqués.
7. Les contrôles serveur restent obligatoires et devront être revalidés avant
   toute activation production.

## Preuves automatisées

La gate CI `test:import-preflight` couvre désormais :

- précontrôle des formats et documents ;
- matrice de qualification staging/production ;
- résolution exacte de cible ;
- rôles `admin/manager` et états fail-closed ;
- détection documentaire synthétique sans Supabase ;
- Collection Report : parsing, review et promotion contrôlée ;
- Internal Book : détection et orchestration synthétiques.

La suite `test:bdk-pdf`, déjà bloquante en CI, porte la preuve BDK PDF. Les
suites Daily v2 restent séparées et bloquantes.

Validation locale du delta :

- gate Operational Import : **49/49** tests verts ;
- matrice CI applicative : **506 tests**, **504 pass**, **0 fail**, **2 skip**
  réservés au harness Node 20 de la CI ;
- TypeScript `--noEmit` : vert ;
- ESLint ciblé sur les nouveaux fichiers et `FileUpload` : zéro problème ;
- ratchet ESLint global : **207 erreurs + 11 warnings = 218**, sous les plafonds
  CI (212 erreurs, 223 total) ;
- build Vite production : vert, worker PDF émis ;
- hygiène du bundle production : **4/4** tests verts, aucun `console.*` ou
  `debugger` direct dans le JavaScript généré ;
- `git diff --check` : vert.

## Périmètre Git

- nouveau contrat : `operationalImportReadiness.ts` ;
- nouveau contrôle d’accès : `operationalImportAccess.ts` et
  `operationalImportRoleService.ts` ;
- détecteur read-only : `documentDetectionService.ts` ;
- consolidation UI : `FileUpload.tsx`, `DocumentUnderstanding.tsx` ;
- suppression : `FileUploadBulk.tsx`, `enhancedFileProcessingService.ts` ;
- tests et gate CI via `package.json` ;
- mise à jour des documents canoniques.

## Limites et prochaine autorisation

Ce lot s’arrête à la draft PR et à la contre-review indépendante. Après merge,
les phases restent séparées : préflight staging, synchronisation runtime,
publication staging, E2E authentifié avec fichiers exclusivement synthétiques,
puis seulement un préflight production en lecture seule. L’élargissement de la
politique production, s’il est décidé, exigera un GO explicite et une preuve
serveur Auth/RLS/grants adaptée.
