# Pack 2 — Compatibilité des formats réels (rapports bancaires et Fund Position)

**Date :** 2026-09-16 (révisions FIX_1 puis FIX_2 après contre-revues CTO de la PR #149, `GO_FIX_PACK_2` reconduit)
**GO :** `GO_IMPLEMENT_PACK_2_REAL_FORMAT_COMPATIBILITY` (niveau élevé, base `4412d0c9`), puis `GO_FIX_PACK_2` (FIX_1, FIX_2), `GO_VALIDATE_LOCAL_PACK_2_REAL_FILES_JULY_SENSITIVE_FIX_1` et `…_FIX_2`
**Statut :** `IMPLEMENTED_LOCAL — DRAFT_PR_149 — FIX_2_APPLIED — MERGE_BLOCKED_UNTIL_PACK_0_CLOSURE_AND_PACK_0R`

## 1. Objet

La campagne locale `GO_VALIDATE_LOCAL_PACK_2_REAL_FILES_JULY_SENSITIVE` (2026-09-16)
avait établi que les fichiers réels de juillet 2026 étaient refusés par les
contrats d'extraction pour des raisons de format, non de qualité : classeurs
annuels à une feuille par jour, identité bancaire exigée unique sur tout le
contenu, dates à année sur deux chiffres, libellés français ORA, Fund Position
tabulaire, feuille BIS déclarée sur 16 384 colonnes. Ce pack rend les
extracteurs compatibles avec ces formes, sans relâcher le principe fail-closed
et sans inventer de donnée.

Aucun fichier réel ni aucune valeur financière ne figure dans le dépôt, les
tests, les journaux ou ce rapport. Les tests versionnés sont exclusivement
synthétiques ; les noms de feuilles qu'ils utilisent (`010126`, `090726`…) sont
des fixtures synthétiques au format `JJMMAA`, pas des données client.

## 2. Contre-revue CTO (PR #149, commit `a74581b`) et corrections `GO_FIX_PACK_2`

| # | Finding | Correction |
|---|---|---|
| 1 | P1 — perte silencieuse après le total des facilités | Toute ligne après le total des facilités refuse le document (plus de compteur « ignorées »). Le test qui entérinait la perte est remplacé par un test de refus (ligne libellée et ligne chiffrée). |
| 2 | P1 — sélection ambiguë des montants | Zone de montant déterminée par l'en-tête (colonnes titrées `AMOUNT`/`MONTANT`, plus la colonne suivante lorsqu'elle n'est pas titrée — « montant 2 » observé) ; à l'intérieur de la zone, exactement une cellule formatée non nulle, sinon `montant ambigu` ; sans colonne titrée, refus. Fund Position : unicité par ligne (blocs à colonne unique), montant HOLD par colonne `MONTANT`. |
| 3 | P1 — zéros financiers inventés | `depositForDay` / `paymentForDay` : valeur absente (jamais zéro) quand le bloc est absent ou sans montant ; `collectionsNotDeposited` : refus si le titre est absent ou ne porte pas de montant (DEF-24). |
| 4 | P1 — date déduite sans corroboration | `parseDocumentDate` refuse toute année courte ; `parseCorroboratedDate` n'accepte `JJ/MM/AA` que si `2000 + AA` appartient aux années corroborées par les cellules date du document ou par une année à quatre chiffres du nom de fichier ; nom de feuille `JJMMAA` soumis à la même règle ; écart solde d'ouverture → rapport borné à 7 jours (`MAX_OPENING_TO_REPORT_DAYS`), postérieur refusé. |
| 5 | P1 — cellules lointaines ignorées sans refus | Toute cellule non vide au-delà de la 512e colonne refuse la feuille, sauf la seule signature bénigne observée : cellule numérique au format date (comptée dans `ignoredFarDateCellCount`, exposé dans `gridEvidence`). Texte, montant, nombre, erreur, booléen hors borne = refus. |
| 6 | P1 — données réelles dans les journaux | Journaux `/upload` sans nom de fichier, sans résumé financier, sans avertissement détaillé (compteurs seuls) ; erreurs Fund Position par numéro de ligne, sans nom de banque. Les messages d'erreur destinés à l'opérateur conservent le nom du fichier (pré-existant, hors journaux). |
| 7 | P2 — sélection insuffisamment liée au fichier | Inventaire et sélections de feuilles liés à l'instance `File` (`Map`), purgés au retrait d'un fichier ; garde obligatoire : sans inventaire pour l'instance, `SHEET_INVENTORY_PENDING` bloque (le préflight n'est plus fail-open sans option). |
| 8 | P2 — affirmations trop absolues | Portée restreinte : la sélection explicite et l'absence de concaténation s'appliquent aux rapports bancaires et à la Fund Position de `/upload` et du harness ; « Document Understanding » (lecture seule) et les autres familles conservent leur lecture historique. Fixtures : noms de feuilles synthétiques. |

Décisions CTO reprises : DEF-20, DEF-21, DEF-22 différés en Pack 2B (aucune
dérivation, aucun zéro par défaut, aucune liste ouverte) ; DEF-23 corrigé
(refus de toute ligne datée ou financière hors section ou après total).

### 2.1 Deuxième contre-revue (commit `863c671`) et corrections FIX_2

| # | Finding | Correction |
|---|---|---|
| 1 | P1 — exception hors borne trop large | Signature structurelle exacte : **exactement une** cellule hors borne sur toute la feuille, en colonne `XFD` (index 16383), numérique au format date à date valide ; toute autre configuration (autre colonne, plusieurs cellules, texte, montant, nombre, erreur) refuse la feuille. Tests adversariaux : sept variantes refusées. |
| 2 | P1 — nom de fichier dans les erreurs `/upload` | Les erreurs retournées désignent le fichier par son rang dans le lot (`fichier n°N`), jamais par son nom (rapports bancaires, Fund Position, fichiers bloqués, Collection Report legacy). Test de source `uploadErrorHygiene` : aucun `.name` dans les `errors.push`, journaux des chemins bancaires et Fund Position sans nom ni valeur. |
| 3 | P1 — facilité sans libellé nommée par le titre | Toute ligne de facilité sans libellé métier explicite refuse (« facilités bancaires sans libellé ») ; aucun libellé déduit du titre de section. Test inversé (refus attendu, titre absent de la sortie). |
| 4 | P1 — colonne adjacente non titrée intégrée à la zone | Zone de montant strictement limitée aux colonnes titrées `AMOUNT`/`MONTANT` ; un montant porté par une colonne non titrée refuse la ligne (« montant absent »). Tests : BICIS et ORA (colonne suivante) refusés, même ligne acceptée dans la colonne titrée. |

Conséquences consignées : DEF-26 (facilité BICIS sans libellé), DEF-27
(montant en colonne non titrée, BICIS et ORA).

## 3. Règles en vigueur (déterministes, documentées)

### 3.1 Sélection explicite d'une feuille (`src/services/excelSheetGrid.ts`)

- Un classeur Excel de rapport bancaire ou de Fund Position est traité sur
  **une** feuille. Un classeur à une seule feuille la retient implicitement ;
  un classeur à plusieurs feuilles exige un nom de feuille explicite
  (`SHEET_SELECTION_REQUIRED`), sinon refus. Aucune concaténation de feuilles
  pour ces familles, ni dans `/upload`, ni dans le harness.
- `/upload` : inventaire local des noms de feuilles lié à l'instance de
  fichier ; `SHEET_INVENTORY_PENDING` tant qu'il n'est pas connu (garde
  obligatoire) ; sélecteur par classeur multi-feuilles ; sélections purgées au
  retrait du fichier ; transmission à `fileProcessingService.processFiles`
  par `Map<File, string>`.
- Le repli de détection par contenu ne lit que la première feuille.

### 3.2 Grille bornée par les cellules réelles

- Grille construite depuis les cellules présentes, jamais depuis `!ref`.
- Cellule sans valeur, ou au format date sans date calendaire valide : vide.
- Hors borne de 512 colonnes : seule la signature exacte « une unique cellule
  hors borne, en colonne `XFD`, numérique au format date à date valide » est
  tolérée (comptée) ; toute autre configuration refuse.
- Bornes : 20 000 lignes, 512 colonnes, 1 000 000 cellules.
- Cellule numérique au format date → ISO depuis le numéro de série Excel ;
  cellule d'erreur Excel conservée comme erreur (refus des montants).

### 3.3 Dates

- `parseDocumentDate` : `JJ/MM/AAAA`, `JJ-MM-AAAA`, `AAAA-MM-JJ` seulement.
- `parseCorroboratedDate` (grille) : `JJ/MM/AA` accepté uniquement si
  `2000 + AA` est corroboré par une cellule date du document ou une année à
  quatre chiffres du nom de fichier. Le nom de feuille `JJMMAA` suit la même
  règle. Conséquence opérationnelle : un classeur Fund Position dont le nom ne
  porte pas d'année et dont la feuille ne contient aucune cellule date est
  refusé (date non corroborée).
- Rapport bancaire : date du rapport = nom de feuille `JJMMAA` (sinon date du
  solde d'ouverture) ; solde d'ouverture daté du jour ou d'au plus 7 jours
  avant ; postérieur ou plus ancien = refus.

### 3.4 Identité bancaire (`src/services/bankIdentity.ts`)

- Émetteur lu dans l'en-tête (grille : lignes avant le solde d'ouverture ;
  texte : trois premières lignes non vides) ; zéro ou plusieurs banques =
  refus avec la liste des banques citées (codes seulement).
- Alias ATB strictement listés : nom `ATLANTIQUE BANK`, `ATLANTIK BANK` ;
  contenu `ATLANTIQUE BANK`.

### 3.5 Extracteur tabulaire des rapports bancaires (`src/services/bankReportGridExtractor.ts`)

- Libellés strictement listés (anglais : BDK, ATB, BICIS, BIS, SGBS ;
  français ORA : `SOLDE D'OUVERTURE`, `SOLDE DE CLÔTURE …`, `Dépôts pas encore
  encaissé`, `Chéques émis non encaissés`, `Impayés`).
- Zone de montant strictement titrée `AMOUNT`/`MONTANT` (§2.1, finding 4) ;
  montant unique dans la zone ; colonne non titrée jamais lue.
- Sections : dépôts (implicite après le solde d'ouverture, titre facultatif),
  chèques, facilités (ligne d'en-tête `Limit | Used | Balance` ignorée ;
  **libellé métier explicite obligatoire** ; exactement trois montants
  formatés ; ligne de total sans date = fin ; **toute ligne après le total =
  refus**), impayés (marqueur `IMPAYE`, code client).
- Toute ligne datée, financière ou libellée hors section, toute ligne datée
  non exploitable, toute cellule d'erreur refusent. Une section titrée vide
  est un avertissement uniquement si aucune ligne n'est ignorée jusqu'à la
  frontière suivante.

### 3.6 Extracteur tabulaire Fund Position (`src/services/fundPositionGridExtractor.ts`)

- En-tête `Bank Balance | Fund Applied | Net Balance | NonValidated Deposit`
  obligatoire, `Grand Balance` refusée si absente (DEF-20, aucune dérivation).
- `totalFundAvailable` = ligne `TOTAL FUND AVAILABLE` sous Net Balance ;
  `grandTotal` = même ligne sous Grand Balance.
- `depositForDay` / `paymentForDay` : somme des lignes à montant unique du
  bloc ; bloc absent ou sans montant = valeur absente.
- `collectionsNotDeposited` : montant porté par la ligne du titre, sinon refus
  (DEF-24).
- HOLD : colonnes fixées par l'en-tête du bloc, montant = colonne `MONTANT`,
  jours et date de dépôt facultatifs, total de bloc obligatoire et égal à la
  somme.
- Erreurs par numéro de ligne, sans nom de banque ni valeur.

### 3.7 Harness (`scripts/qualifyOperationalImportRealFile.ts`)

- Attestation : exactement une de `--anonymized` ou
  `--real-sensitive-authorized` ; `--sheet <nom>` obligatoire sur un classeur
  multi-feuilles ; sortie sans donnée brute, sans chemin, sans nom de feuille ;
  `attestation`, `sheetSelection`, `gridEvidence` (lignes, colonnes, cellules
  d'erreur, cellules date parasites hors borne) ; code `EXCEL_ERROR_CELL`.

## 4. Fichiers modifiés

Runtime : `src/services/excelSheetGrid.ts`, `src/services/bankReportGridExtractor.ts`,
`src/services/fundPositionGridExtractor.ts` (nouveaux) ; `src/services/bankIdentity.ts`,
`src/services/bankReportExtractionContract.ts`, `src/services/bankReportSectionExtractor.ts`,
`src/services/bankReportProcessingService.ts`, `src/services/fileProcessingService.ts`,
`src/services/importPreflightService.ts`, `src/services/documentDetectionService.ts`,
`src/services/operationalImportRealFileQualification.ts`,
`scripts/qualifyOperationalImportRealFile.ts`, `src/pages/FileUpload.tsx`.

Tests synthétiques : `excelSheetGrid`, `bankReportGridExtractor`,
`fundPositionGridExtractor` (nouveaux) ; `bankIdentity`,
`bankReportExtractionContract`, `importPreflightService`,
`operationalImportReadiness`, `multiBankReportExtraction`, `uploadRuntimeGuard`
(complétés ou adaptés : contrat de source `processFiles(otherFiles, { sheetSelections })`).

`package.json` : scripts uniquement. Docs : ce rapport, runbook de
qualification, `STATUS_REGISTRY`, `MASTER_CONTEXT`, `DEFERRED_BACKLOG`
(DEF-20 à DEF-24).

## 5. Validation locale sur fichiers réels (`…_FIX_2`, hors dépôt, sous GO)

Harness officiel, feuille du 9 juillet 2026 (Fund Position : dernière feuille
disponible, 7 juillet 2026) :

| Famille | Décision | Motif ou preuves agrégées |
|---|---|---|
| BDK | `FAIL_CLOSED` | deux lignes chiffrées après le total des facilités (DEF-25) |
| ATB | `LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW` | 1 dépôt, 2 chèques, 3 facilités, 8 impayés |
| BICIS | `FAIL_CLOSED` | facilité unique sans libellé métier (DEF-26) ; chèques en colonne non titrée (DEF-27) |
| ORA | `FAIL_CLOSED` | chèques en colonne non titrée (DEF-27) |
| BIS | `FAIL_CLOSED` | deux lignes chiffrées après le total des facilités (DEF-25) |
| SGBS | `NOT_TESTED` | aucun fichier fourni |
| Fund Position | `FAIL_CLOSED` | colonne Grand Balance absente (DEF-20) ; titre COLLECTION NOT DEPOSITED sans montant (DEF-24) ; date non corroborée (nom de fichier sans année) |

Échantillon de 60 feuilles par banque (verdicts et motifs seulement) :

| Famille | PASS | Motifs de refus résiduels |
|---|---|---|
| BDK | 46/60 | 6 lignes après le total des facilités ; 9 marqueurs d'impayé non listés (DEF-22) ; 2 soldes d'ouverture postérieurs ; 1 cellule d'erreur |
| ATB | 58/60 | 1 solde d'ouverture postérieur ; 2 lignes hors section |
| BICIS | 0/60 | 60 facilités sans libellé (DEF-26) ; 2 chèques en colonne non titrée (DEF-27) ; 1 facilité non exploitable ; 1 écart de dates |
| ORA | 0/60 | 960 chèques en colonne non titrée (DEF-27) ; 74 facilités à deux montants (DEF-21) ; 34 lignes hors section ; 4 soldes postérieurs ; 2 clôtures en erreur Excel ; 1 nom de feuille non corroboré |
| BIS | 22/60 | 70 lignes après le total des facilités (DEF-25) ; 2 chèques en colonne non titrée ; 2 dates malformées ; 3 écarts de dates |
| Fund Position (150 feuilles) | 0/150 | titre COLLECTION NOT DEPOSITED sans montant (150) ; colonne Grand Balance absente (102) ; date non corroborée (95) ; cellules d'erreur et montants vides |

Lecture : les règles imposées par les deux contre-revues (refus après total,
aucun libellé déduit, zone de montant strictement titrée, aucun zéro par
défaut, corroboration des années) laissent ATB comme seule famille acceptée
sur la feuille du 9 juillet. Ce sont des refus de contrat conformes aux
verdicts, pas des défauts d'extraction : les écarts de format des rapports
réels (DEF-20 à DEF-27) doivent être arbitrés en Pack 2B, par modélisation
explicite ou par correction à la source, avant toute promotion.

## 6. Points d'arbitrage CTO (Pack 2B)

1. DEF-20 : Fund Position sans colonne Grand Balance (différé, aucune dérivation).
2. DEF-21 : facilités ORA à deux montants (différé, « utilisé » vide ≠ zéro).
3. DEF-22 : marqueur de type d'impayé BDK (liste blanche stricte à établir).
4. DEF-24 : `COLLECTION NOT DEPOSITED` sans montant sur la ligne du titre ;
   contrat de nullabilité à définir.
5. DEF-25 : lignes d'ajustement après le total des facilités (BDK, BIS, ATB) :
   présentes dans la majorité des rapports quotidiens ; à modéliser ou à
   faire supprimer à la source avant toute promotion de ces familles.
6. DEF-26 : facilité BICIS sans libellé métier (toutes les feuilles).
7. DEF-27 : montants de chèques en colonne non titrée (ORA systématiquement,
   BICIS et BIS ponctuellement).
8. Fund Position : année à corroborer par une cellule date complète de la
   feuille ou par le nom du fichier (le nom n'est pas obligatoire, mais sans
   aucune année complète le document reste refusé).

## 7. Sécurité

| Contrôle | Réponse |
|---|---|
| Secrets | non |
| Données bancaires réelles | lues localement sous GO ; aucune dans Git, tests, logs, docs |
| SQL / migration / Supabase live | non |
| Auth / RLS | non |
| Réseau / services tiers | non |
| Journaux navigateur | sans nom de fichier, sans valeur, sans nom de banque de détail |

## 8. Tests et baselines (local, Node 22.23.1, dépendances du lockfile)

| Commande | Résultat |
|---|---|
| `npm run test:multi-bank-reports` (+ `uploadErrorHygiene`) | 80/80 PASS |
| `npm run test:import-preflight` | 58/58 PASS |
| `npm run test:upload-guard` | 14/14 PASS |
| `npm run test:bdk-pdf` | 27/27 PASS |
| `npm run test:structured-excel` | 20/20 PASS |
| `npm run test:xlsx-characterization` | 6/6 PASS |
| `npm run test:legacy-isolation` | 4/4 PASS |
| `npm run test:internal-book` | 90/90 PASS |
| `npm run test:quality-control` | 8/8 PASS |
| `npm run test:daily-v2-application` | 106/106 PASS |
| `npm run build` | PASS ; `supabase/functions/mcp/index.ts` intact |
| `git diff --check` | PASS |

Baselines mesurées sur un worktree `origin/main` @ `4412d0c9` (`npm ci`) :
typecheck application 16 diagnostics, branche 16, diff exact vide ; projet
Node 0 erreur ; ESLint 178 erreurs / 11 avertissements, branche 178 / 11,
aucun item nouveau.
