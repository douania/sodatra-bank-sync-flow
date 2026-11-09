# DAILY-V2-BDK-ORABANK-OPERATIONAL-READINESS — rapport du pack

GO : `GO_IMPLEMENT_DAILY_V2_BDK_ORABANK_OPERATIONAL_READINESS`.
Base : `main` `ac2284098464d8338bb6d8cf8cb7e661e93a6d45`.
Branche : `codex/daily-v2-bdk-orabank-operational-readiness`, dans un worktree isolé.
Les checkouts existants (Collections, Pack 2 et autres) sont intacts : aucun stash, aucun nettoyage.

Contexte : la recette réelle D1 BDK/ORABANK `rd1-dceebe` est close en `PASS_WITH_RESERVES`. Ce pack corrige trois
difficultés d'exploitation qu'elle a relevées, sans toucher au serveur :

- A : la date d'export disparaît en silence ;
- B : le compte n'est pas identifiable dans la revue ;
- C : le cas `ora_211026_orab`.

Il prépare aussi la future qualification staging.

Hors périmètre, sans exception : aucune migration, aucun SQL, aucune fonction D1 modifiée, aucun changement Auth/RLS,
aucune dépendance, aucun accès staging ou production.

## 1. Diagnostic

### A — Date d'export

- Le choix d'un fichier (`onDrop`) et le changement de banque vidaient la date de référence sans aucun avis.
- Le provisionnement d'un nouveau compte changeait le compte sélectionné sans invalider la préparation déjà faite.
  Ce défaut, préexistant, a été relevé par la revue indépendante.
- Le pipeline applique une règle existante, inchangée par ce pack :
  - avec une date, toute journée à partir de cette date est demandée `provisional` ;
  - sans date, seule la dernière journée ORABANK l'est ;
  - pour BDK et les profils Excel sans date, aucune journée n'est provisoire.
- Le risque d'exploitation est double :
  - une date restée d'un autre fichier clôt à tort la journée d'export, si elle est postérieure ;
  - ou elle rouvre comme provisoires des journées closes, si elle est antérieure.
- Un fichier BDK déposé sans date clôt même le jour d'export.
- La recette a dû rattraper un tel cas avant dépôt.

### B — Revue staging

- La table « Staging » est paginée côté serveur, par 20 lignes avec décompte exact. Elle n'est pas limitée aux
  20 lignes les plus récentes.
- Elle n'affichait ni le compte ni la tentative : deux comptes d'une même banque, le même jour, donnaient deux lignes
  indiscernables.
- Les seuls filtres étaient le statut et la revue.

### C — `ora_211026_orab`

Le cas a été rejoué sur `ac22840`, avec le fichier original fourni (diagnostic local autorisé), dans le pipeline
navigateur réellement utilisé.

- La sortie a été limitée à des drapeaux, statuts et compteurs.
- L'outil lisait l'original en place : aucune copie, aucun extrait ni journal de données n'a été créé, et l'original
  est inchangé (empreinte identique avant et après).
- Rien de ce diagnostic n'entre dans Git ni dans les fixtures.

| Contexte | Résultat |
|---|---|
| Nom réel, banque ORABANK | accepté (`valid`, `structured-csv-0b`) |
| Même contenu sous un nom `ORA` | accepté, payload identique |
| Nom réel, banque BDK | refusé (incohérence de banque) |
| Nom ambigu `ORAB` + `BDK` | refusé |

Conclusion : le cas n'est **pas reproductible** sur `main`.

- La reconnaissance du jeton `ORAB` existe depuis `e3eb8a2` (R6, Lot 1 opérationnel, PR #156).
- L'inventaire de la recette, le 08/11, l'avait d'ailleurs déjà classé valide.
- La mention « BLOCKED : nom ORAB non reconnu (constat A2) » de la recette `rd1-dceebe` reprenait à tort le constat A2
  du 03/11, antérieur à R6. Ce fichier n'a donc pas été déposé au staging ; la future qualification doit l'inclure.

Aucune correction de reconnaissance n'est nécessaire dans le pipeline Daily v2. Le pack ajoute des tests de
non-régression au niveau du pipeline et rend la règle visible à l'opérateur.

Alias pris en charge par la règle du parseur, vérifiés par tests :

- **ORABANK** : jetons `ORA` et `ORAB` ; sous-chaîne `ORABANK` ; `ORA BANK`.
- **BDK** : jeton `BDK` ; `BANQUE DE DAKAR`.
- Les séparateurs sont des espaces, `_`, `-` ou `.`.
- Toujours refusés :
  - un nom désignant les deux banques ;
  - un jeton partiel (`BORAB`, `ORABX`) ;
  - une banque déclarée différente de celle du nom.
- Observation hors périmètre : `src/services/bankIdentity.ts`, utilisé par les rapports multi-banques historiques et
  non par Daily v2, ne reconnaît pas `ORAB`. Non modifié.

## 2. Modifications

| Fichier | Changement |
|---|---|
| `src/pages/DailyStatementV2.tsx` | A : avis de date effacée avec sa cause, date lue dans le nom (bouton explicite), date transmise affichée, effet de la date sur la préparation, confirmation obligatoire liée à cette préparation et nommant le compte, dépôt refusé si la date contredit le fichier ou si le compte a changé, invalidation au provisionnement, formulaire conservé s'il change pendant un dépôt. B : filtre de compte, colonne Compte, identité de l'unité dans la décision, gardes de décision périmée, d'actualisation, d'échec de relecture et de compte non identifiable. C : banque reconnue par le nom affichée avant préparation |
| `src/features/daily-v2/DailyV2Tables.tsx` | Colonne « Compte » (alias, numéro masqué du registre, état inactif ou registre indisponible, tentative et unité courtes) ; repère `data-staging-unit` |
| `src/features/daily-v2/dailyV2Types.ts` | Type du filtre ; aides pures : libellé et identification du compte, contexte et contrôle de décision, messages de péremption |
| `src/features/daily-v2/dailyV2SupabaseService.ts` | `listDailyV2StagingUnits` : filtre `account` (tous, sans compte du registre, ou identifiant exact) appliqué côté serveur avant la pagination ; filtre mal formé refusé avant toute requête (`STAGING_ACCOUNT_FILTER_INVALID`) |
| `src/features/daily-v2/dailyV2BrowserPipeline.ts` | Aides pures `readDailyV2FileNameExportDate` et `assessDailyV2ExportReferenceDate` ; `prepareDailyV2BrowserDeposit` inchangé |
| `src/services/structuredBankStatementCsvParser.ts` | Export `detectStructuredBankStatementCsvBankHint` : la règle existante, à l'identique, pour l'affichage préalable |
| Tests | Voir §4. Dans `dailyV2ApplicationContract.synthetic.test.ts` : trois assertions de contrat de source étendues, et deux tests des aides de revue ajoutés |

## 3. Comportement livré

### A — Date d'export

- Un nouveau fichier ou une autre banque n'hérite **jamais** de la date précédente.
  - Elle est effacée, et un avis en donne la cause : fichier précédent, date saisie avant le premier fichier, ou
    changement de banque.
  - Toute modification pertinente invalide la préparation précédente : fichier, banque, devise, compte sélectionné ou
    provisionné, date, mode ou autorisation.
- Avant préparation, la page affiche :
  - le fichier courant ;
  - la date lue dans le nom (`JJMMAA` en tête), avec un bouton « Utiliser cette date » qui n'agit jamais seul ;
  - la date qui sera transmise, ou « aucune » avec son effet (dernière journée ORABANK provisoire, ou toutes les
    journées closes).
- Après préparation, la page affiche :
  - le fichier et le compte du dépôt ;
  - la date de référence réellement inscrite au payload ;
  - les journées provisoires, le nombre de journées closes et la dernière journée du fichier ;
  - les points à vérifier.
- Points à vérifier :

| Code | Signification | Effet |
|---|---|---|
| `ORA_WITHOUT_REFERENCE_DATE` | ORABANK sans date | confirmation |
| `FILE_NAME_DATE_NOT_USED` | date du nom (cohérente avec le contenu) non transmise | confirmation |
| `FILE_NAME_DATE_BEFORE_CONTENT` | date du nom antérieure à la dernière journée : le nom ne décrit pas le contenu et n'est plus utilisé pour juger la date | confirmation |
| `REFERENCE_AFTER_LATEST_DAY` | date postérieure à la dernière journée : toutes les journées closes | confirmation |
| `REFERENCE_DIFFERS_FROM_FILE_NAME` | date antérieure à celle du nom (sens prudent) | confirmation |
| `REFERENCE_BEFORE_LATEST_DAY` | date antérieure à la dernière journée du fichier | **dépôt bloqué** |
| `REFERENCE_AFTER_FILE_NAME_DATE` | date postérieure à la date d'export du nom, quand le nom décrit le contenu : la journée d'export serait close à tort | **dépôt bloqué** |

- Le blocage d'une date postérieure au nom (`REFERENCE_AFTER_FILE_NAME_DATE`) est un **choix prudent de ce pack, soumis
  à ratification CTO**.
  - Il reste un simple signalement sans date dans le nom, ou quand la date égale celle du nom sans opération ce jour-là.
- Le dépôt exige de cocher la confirmation « Je confirme que la date d'export … correspond au fichier …, pour le compte
  … », ou « … sans date de référence export, pour le compte … ».
  - Elle est liée à *cette* préparation : toute nouvelle préparation l'annule.
  - L'action de dépôt elle-même revérifie la confirmation, la cohérence de la date et le compte sélectionné, même si le
    bouton est contourné.
- Pendant un dépôt, la préparation est indisponible. Un fichier ou une date saisis pendant ce temps sont conservés : le
  formulaire n'est vidé que s'il n'a pas changé.

### B — Revue staging

- Une colonne Compte affiche, pour chaque ligne :
  - l'alias et le numéro déjà masqué du registre, avec « (inactif) » le cas échéant ;
  - la tentative et l'unité, en identifiants courts.
- États particuliers :
  - « Registre des comptes indisponible » tant que le registre n'est pas lu ;
  - « Compte non visible avec vos droits » pour un compte absent du registre lu ;
  - « Sans compte du registre » pour une unité historique.
- L'empreinte du compte n'est jamais rendue, ni en texte ni en attribut.
- Droits de lecture inchangés : la liste vient de `listDailyV2Accounts`.
  - Pour un admin, elle comprend les comptes inactifs ; pour un manager, les comptes actifs, borné aussi par la RLS
    existante.
  - Un auditor ne lit pas le staging, comme avant.
- Le filtre « Filtrer par compte » propose : tous les comptes, chaque compte du registre lisible, et « Sans compte du
  registre ».
  - Il est appliqué par le serveur (`account_registry_id = …` ou `IS NULL`), avec la même requête paginée et le même
    décompte exact. Les pages et l'effectif portent donc sur l'ensemble filtré.
  - Tout changement de filtre revient à la première page.
- Décisions ciblées :
  - le dialogue montre le compte, la journée, la tentative et l'unité ;
  - la promotion et le supersede partent de l'identifiant exact de l'unité relue.
- Décision périmée :
  - Le contexte est figé à l'ouverture : vue (compte, statut, revue, page), unité, tentative, compte, journée,
    contenu et statut.
  - Tout changement de compte, de filtre ou de page ferme les décisions ouvertes, ainsi que les dialogues Versions et
    approbation groupée.
  - À la confirmation, la vue et le dialogue relus sont ceux du dernier rendu validé, synchronisés par
    `useLayoutEffect`. Cela vaut même pour un gestionnaire capturé plus tôt.
  - La décision est refusée sans appel serveur, avec fermeture, si :
    - la vue a changé ;
    - l'unité n'y figure plus ;
    - l'unité a changé.
  - Elle est seulement suspendue, sans fermeture et sans perte de la raison saisie, si :
    - la liste est en cours d'actualisation ;
    - la dernière relecture a échoué (TanStack conserve alors les anciennes lignes).
  - Elle est refusée si le compte de l'unité n'est pas identifiable (registre indisponible, ou compte absent du
    registre lu).

### C — ORAB

- Pour un fichier CSV, la banque reconnue d'après le nom est affichée avant préparation, par la règle exacte du
  parseur. Une non-reconnaissance ou une banque différente de celle choisie y est annoncée.
- Le pipeline reste seul juge du dépôt.

Toutes ces gardes sont des gardes d'interface. Auth, rôles, RLS, verrous et RPC restent les frontières serveur,
inchangées.

## 4. Vérifications

Environnement : Node 22.23.1, npm 10.9.8, TypeScript 5.6.3, ESLint 9.13.0, avec les dépendances du lockfile
(`npm ci`).

| Contrôle | Baseline `ac22840` | Branche |
|---|---|---|
| `npx tsc -p tsconfig.app.json --noEmit` | 16 erreurs | 16 ; diff exact vide (0 nouvelle, 0 disparue) |
| `npx tsc -p tsconfig.node.json --noEmit` | 0 | 0 |
| `npx eslint .`, comparé item par item | 178 erreurs / 11 warnings | 178 / 11 ; 0 nouvel item, 0 disparu |
| `npm run build` | — | réussi ; artefact MCP `supabase/functions/mcp/index.ts` inchangé |
| `git diff --check` | — | propre |

| Suite | Résultat |
|---|---|
| `test:structured-csv-all` | 135 / 135 |
| `test:structured-csv-e2b` | 49 / 49 |
| `test:structured-excel` | 21 / 21 |
| `test:daily-v2-application` | 115 / 115 |
| `test:daily-v2-reporting` | 70 / 70 |
| Commandes CI dashboard, session, décisions opérationnelles | 34 / 34, 11 / 11, 49 / 49 |
| `test:build-provenance` | 12 / 12 |
| Nouveaux fichiers de tests du pack, hors CI (page 19, service 4) | 23 / 23 |

Couverture des tests ajoutés :

- **Pipeline** (`dailyV2BrowserPipeline.synthetic.test.ts`, exécuté par la CI) :
  - ORAB accepté, avec des payloads identiques au nom ORA et des versions inchangées ;
  - refus en cas de banque différente, de nom ambigu ou de jeton partiel ;
  - lecture de la date du nom ;
  - effet de la date sur une préparation réelle : date exacte, antérieure, postérieure au contenu ou au nom, jour
    d'export sans opération, date du nom antérieure au contenu, ORABANK et BDK sans date, mensuel.
- **Parseur** (`structuredBankStatementCsvParser.synthetic.test.ts`, exécuté par la CI) : parité de la règle exportée
  avec `bankHint`. C'est une garde de non-régression.
- **Aides de revue** (dans `dailyV2ApplicationContract.synthetic.test.ts`, exécuté par la CI) :
  - libellé et identification du compte, dont le registre indisponible ;
  - chaque motif de péremption, champ par champ.
- **Page** (`src/pages/DailyStatementV2.synthetic.test.tsx`, 19 tests) : interactions réelles avec la page et le vrai
  pipeline.
  - Changement de fichier et de date, avis et causes, invalidation.
  - Confirmation obligatoire, renouvelée à chaque préparation et nommant le compte.
  - Dates incohérentes bloquées, même après contournement du bouton et de la case.
  - Dépôt sans date en connaissance de cause.
  - Provisionnement d'un compte qui invalide la préparation.
  - Course entre un dépôt et une nouvelle saisie.
  - Règle de banque affichée.
  - Deux comptes d'une même banque, même journée, sans empreinte rendue même dialogue ouvert.
  - Manager limité aux comptes actifs.
  - Filtre serveur, pagination et effectif.
  - Décisions ciblées et fermées au changement de compte ou de page.
  - Décisions refusées ou suspendues : unité changée ou sortie de la vue, actualisation, relecture en échec, compte
    non identifiable, gestionnaire capturé avant un changement de compte.
  - Dépôt puis redépôt identiques.
  - Le harnais reproduit TanStack v5 : une relecture conserve les données, avec `isFetching` vrai.
- **Service** (`dailyV2StagingAccountFilter.synthetic.test.ts`, 4 tests) : sur la requête HTTP réellement émise par le
  vrai client supabase-js (seul le réseau est doublé), les tests prouvent :
  - le filtre `account_registry_id` et le filtre `IS NULL` ;
  - la pagination (`offset`/`limit`) et `count=exact` ;
  - le refus avant toute requête d'un filtre mal formé ou injecté.

Preuves complémentaires :

- **Mutation** : rejoués sur le code de `ac22840` dans un worktree temporaire, ensuite supprimé :
  - les 19 tests de page échouent ;
  - 3 des 4 tests de service échouent ; le quatrième, « tous les comptes », vérifie le comportement inchangé ;
  - les fichiers parseur, pipeline et contrat ne chargent pas, faute des nouveaux exports ;
  - les deux tests ORAB, isolés, passent sur `ac22840`, ce qui confirme le diagnostic C.
- **Node 20** : les tests du pack (pipeline, page, service) passent sans la globale `navigator`, absente en CI. Les
  crochets de chargement `module.register` qu'ils utilisent sont déjà employés par un test exécuté en CI
  (`DailyV2DecisionDialogsSuspension`).

Contrats de source étendus dans `dailyV2ApplicationContract.synthetic.test.ts` (trois assertions qui figeaient la
forme exacte) :

- les gardes du bouton de dépôt : les deux gardes d'origine, puis `depositBlocked`, dont la composition est figée ;
- la signature de `StagingTable`, qui reçoit `accountsById` ;
- son appel depuis la page.

Revue indépendante (seconde IA, en lecture seule), deux passes :

- Première passe : 1 P1 (provisionnement), 3 P2 et 7 P3.
- Seconde passe, sur les correctifs : P1 corrigé, sans nouveau P0 ni P1. Le resserrement de la règle « date du nom
  antérieure au contenu » (P3-A) et la relecture en échec (P3-B) ont ensuite été traités.
- Restent les points du §6 et du §8.

## 5. Discipline de version du parseur

- Le parseur CSV garde la version `structured-csv-0b`, et le runtime navigateur `daily-v2-browser-0q`.
  - Le document analysé n'est pas modifié.
  - `prepareDailyV2BrowserDeposit` produit, pour un fichier accepté, le même payload qu'avant (prouvé par les tests ORA
    contre ORAB, et par le contrat d'application).
  - Le nouvel export n'expose que la règle existante.
- Le registre de formats de la Trésorerie n'est pas touché : (BDK|ORA, `structured_bank_statement_csv`,
  `structured-csv-0b`), non qualifié.
- Impact documenté : l'alias `ORAB` a été introduit par R6 sous la même version `structured-csv-0b`.
  - Une qualification de cette version doit donc couvrir explicitement les fichiers nommés `ORAB`.
  - La version déclarée n'authentifie ni le logiciel ni le fichier (réserve 4).

## 6. Hors périmètre identifié (non appliqué)

1. **CI** : la page (19 tests) et le service (4 tests) ne sont pas encore exécutés par la CI, qui liste ses fichiers
   explicitement. Il faudrait les ajouter à la commande « LOCAL-E2E » de `.github/workflows/ci.yml`, ou à un script de
   `package.json`. Ces deux fichiers sont hors du périmètre autorisé.
   - Fichiers : `src/pages/DailyStatementV2.synthetic.test.tsx`,
     `src/features/daily-v2/dailyV2StagingAccountFilter.synthetic.test.ts`.
   - Les tests du pipeline, du parseur et des aides de revue, eux, y sont déjà.
2. `src/services/bankIdentity.ts` (rapports multi-banques historiques) ne reconnaît pas `ORAB`. Ce module n'est pas le
   pipeline Daily v2.
3. Le rapport privé de la recette `rd1-dceebe` classe `ora_211026_orab` « BLOCKED » par erreur (§1-C). Sa
   rectification relève d'une autorisation distincte.
4. Les dialogues Versions et approbation groupée (Lot 1) ne sont pas modifiés. Ils sont refermés au changement de vue
   et gardent leurs propres gardes.

## 7. Protocole de qualification staging ultérieure (préparation seulement)

Ce protocole n'autorise ni qualification, ni ouverture de verrou, ni accès distant. Chaque étape exige son GO
nominatif : `GO_VALIDATE_STAGING_<PACK>`, et `GO_APPLY_STAGING_<PACK>` pour les écritures énumérées. La production est
exclue.

1. **Formats et versions concernés**
   - Profil : CSV `structured_bank_statement_csv`, parseur `structured-csv-0b`, runtime `daily-v2-browser-0q`, pour BDK
     et ORABANK.
   - Noms couverts : `ORA`, `ORAB`, `ORABANK`, `BDK`, `BANQUE DE DAKAR`.
   - Le build déployé est identifié par sa provenance embarquée.
   - Les profils Excel (ATB, BICIS, BIS, BRIDGE), BIS backfill et NSIA sont exclus.
2. **Dates prouvées**
   - Série contiguë de quotidiens réels, avec la date d'export de chaque fichier confirmée à l'écran.
   - Cas couverts : journée close, provisoire tardive, ordre inversé, redépôt identique et mensuel.
   - Pour une réfutation, attendre J+1 ne suffit pas : la preuve doit apporter une journée effectivement postérieure au
     jour de première réception des sources, selon la règle applicative.
   - Le fichier `ORAB` du 21/10 entre dans la série.
3. **Référence indépendante**
   - Elle est recalculée localement par un outil distinct du pipeline, à partir des originaux, et scellée par
     empreintes.
   - Elle est comparée par journée (effectifs, totaux, soldes) sans aucune sortie de montant ; ses copies sont
     supprimées après campagne.
4. **Disponibilité des soldes**
   - La Trésorerie reste `NOT_COVERED` tant que le format n'est pas qualifié dans son registre par un GO dédié.
   - Le contrôle vérifie l'absence de faux solde, la couverture par compte et par date cible, et l'absence de somme de
     soldes datés différemment.
5. **Rôles utilisateurs**
   - Admin : décisions et registre.
   - Manager : dépôt et lecture des seuls comptes actifs.
   - Auditor : lecture canonical, audit et registre, sans staging.
   - User : aucun accès.
   - Sessions réelles par lien magique déjà éprouvé ; contrôle de la révocation et du rafraîchissement des droits.
6. **Contrôles avant/après**
   - Empreintes : historique des migrations, signature D1, fonctions, droits, politiques, déclencheurs.
   - Journées ORA protégées (08/07, 29/09).
   - Inventaire et attestations Trésorerie, verrous et module.
   - Comparaison stricte, écarts persistants listés.
7. **Compensation**
   - Retrait gardé des comptes attendus de recette et désactivation des comptes de recette ; données et audits
     conservés.
   - Fermeture des verrous et du module, puis contrôle final.
   - Aucun nettoyage ORA. Nettoyage local des copies et des volumes dans une clôture distincte.

## 8. Réserves et limites

Réserves maintenues :

1. W9/parcours complet, avec les acquis M2 et Auth acceptés dans leur portée démontrée.
2. États hérités.
3. Convergence bornée.
4. Version du parseur.

Restent également maintenues : la garde après révocation, la limite CRLF/m14, et O2 hors correctif avec sa
rectification.

Limites :

- Les gardes de date et de décision sont des gardes d'interface ; le pipeline accepte toujours une date antérieure à la
  dernière journée, comme le prévoit son contrat.
- Le blocage d'une date postérieure au nom est un choix à ratifier (§3-A).
- Les interactions sont testées par un harnais Node, et non dans un navigateur réel ; ses dialogues ne sont pas modaux.
- Aucune exécution staging.
- Deux fichiers de tests restent à brancher sur la CI (§6).
- Nits non traités, sans effet de sécurité :
  - le type du filtre de compte reste une chaîne ;
  - un utilisateur à la fois manager et auditor lit le registre de la revue comme le formulaire d'import, en comptes
    actifs.
