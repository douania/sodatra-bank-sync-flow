# Pack 2 — Compatibilité des formats réels (rapports bancaires et Fund Position)

**Date :** 2026-09-16 (révisions FIX_1, FIX_2 puis FIX_3 après contre-revues CTO de la PR #149, `GO_FIX_PACK_2` reconduit)
**GO :** `GO_IMPLEMENT_PACK_2_REAL_FORMAT_COMPATIBILITY` (niveau élevé, base `4412d0c9`), puis `GO_FIX_PACK_2` (FIX_1 à FIX_3), `GO_VALIDATE_LOCAL_PACK_2_REAL_FILES_JULY_SENSITIVE_FIX_1` à `…_FIX_3`
**Statut :** `IMPLEMENTED_LOCAL — DRAFT_PR_149 — FIX_3_APPLIED — MERGE_BLOCKED_UNTIL_PACK_0_CLOSURE_AND_PACK_0R`

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

### 2.2 Troisième contre-revue (commit `76c1324`) et corrections FIX_3

| # | Finding | Correction |
|---|---|---|
| 1 | P1 — date invalide en XFD éliminée avant la collecte hors borne | Les cellules hors borne sont collectées **avant** tout filtre de valeur ; la signature bénigne exige une date calendaire valide : série nulle, négative ou hors calendrier en XFD = refus. Tests : trois variantes supplémentaires refusées. |
| 2 | P1 — `extractionResult.errors` journalisé (Fund Position PDF), captures d'objets d'erreur | Plus aucun journal du pipeline ne porte de nom de fichier, de valeur, d'objet d'erreur ni de liste d'erreurs (compteurs seuls), y compris le chemin legacy Client Reconciliation (bloqué au précontrôle) ; test de source étendu à tout le fichier. |
| 3 | P1 — date textuelle prise pour un libellé de facilité | `isBusinessLabel` : un libellé métier n'est ni une date (typée, textuelle, année courte corroborée), ni un marqueur structurel (TOTAL…, LIMIT/USED/BALANCE, titre de section, préfixe ADD/LESS), ni un contenu numérique ; à défaut, refus. Un titre de section ou une ligne d'en-tête de colonnes portant des montants refuse aussi. Tests : sept libellés déguisés refusés. |
| 4 | P2 — rang non affiché dans l'interface | `/upload` affiche « fichier n°N » devant chaque entrée du précontrôle et transmet le même rang (`fileOrdinals`) au pipeline ; test de source du contrat interface ↔ erreurs. |

Décisions CTO reprises : DEF-25, DEF-26, DEF-27 en Pack 2B (correction à la
source privilégiée ; profil bancaire explicite seulement sur attestation
métier, jamais de réouverture générique).

### 2.3 Quatrième contre-revue (commit `cc7fa3c`) et corrections FIX_4

| # | Finding | Correction |
|---|---|---|
| 1 | P1 — hygiène incomplète du pipeline : les extracteurs texte (Fund Position PDF, rapports bancaires PDF) journalisaient encore des lignes brutes, des montants, des dates et des objets d'erreur, et leurs messages bruts remontaient tels quels dans `results.errors` | Assainissement de **tout le graphe d'appel** : `extractionService.ts` (helpers de date et de montant, soldes, dépôts, facilités, impayés, Fund Position) et `bankReportSectionExtractor.ts` ne journalisent plus que des compteurs et des rangs de ligne ; les messages d'erreur portent un rang (`Ligne n°N`, `(ligne N)`) et un motif, jamais la ligne, le chèque, le client ni le montant. Nouvelle frontière `src/services/extractionErrorSummary.ts` : `summarizeExtractionErrors` réduit tout message d'extracteur (grille, texte, legacy, exception) à « ligne N : motif » dans un vocabulaire fermé de treize motifs ; `fileProcessingService.ts` ne pousse plus aucun message brut. |
| 2 | P1 — tests de source seulement, pas d'exécution : aucune preuve runtime | Nouvelle suite `sensitiveSentinelRuntime.synthetic.test.ts` (enregistrée dans `test:multi-bank-reports`) : chaque chemin est **exécuté** avec des sentinelles (client, chèque, banque de détail, montant, date invalide) — Fund Position texte, rapport bancaire texte, extracteurs tabulaires, `bankReportProcessingService.processBankReportExcel` sur un vrai `File` (sans et avec feuille choisie), résumé fermé — console capturée sur les quatre niveaux ; aucune sentinelle ne peut apparaître dans la console, les erreurs retournées ni le résumé. Vérifié adversarial : la suite échoue sur `cc7fa3c` (deux chemins texte fuient), passe après FIX_4. |
| 3 | P1 — validation du libellé contournable : `IMPAYE` et `1 000 FCFA` acceptés comme facilités | `isBusinessLabel` exige au moins une lettre et refuse : marqueurs d'impayé (`IMPAYE`, `IMPAYES`, `UNPAID`, `DEFAULT`), tous les titres de section des deux jeux de libellés, les en-têtes de colonnes (DATE, CH.NO, DESCRIPTION, VENDOR PROVIDER, CLIENT, TR NO/FACT.NO, AMOUNT, MONTANT, LIMIT/LIMITE, USED, BALANCE, SOLDE, DISPONIBLE, DEPOSIT/DEPOT…), les préfixes structurels (TOTAL, IMPAYE, CHECK, DEPOSIT, OPENING/CLOSING BALANCE…) et tout contenu monétaire avec ou sans devise (`1 000 FCFA`, `12,5 €`, `250 000 XOF`). Tests : dix-huit libellés déguisés refusés. |

Décisions CTO reprises : DEF-25 correction à la source ou profil bancaire
explicitement attesté ; DEF-28 correction à la source, aucune exception XFD.

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
- Hors borne de 512 colonnes : cellules collectées avant tout filtre de
  valeur ; seule la signature exacte « une unique cellule hors borne, en
  colonne `XFD`, numérique au format date à date calendaire valide » est
  tolérée (comptée) ; toute autre configuration, y compris une série nulle,
  négative ou hors calendrier, refuse.
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
  chèques, facilités (ligne d'en-tête `Limit | Used | Balance` ignorée si
  elle ne porte aucun montant, sinon refus ; **libellé métier explicite
  obligatoire** — ni date, ni marqueur structurel, ni contenu numérique ;
  exactement trois montants formatés ; ligne de total sans date = fin ;
  **toute ligne après le total = refus**), impayés (marqueur `IMPAYE`, code
  client). Un titre de section portant des montants refuse.
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
`scripts/qualifyOperationalImportRealFile.ts`, `src/pages/FileUpload.tsx`,
`src/services/extractionService.ts`, `src/services/extractionErrorSummary.ts` (nouveau, FIX_4).

Tests synthétiques : `excelSheetGrid`, `bankReportGridExtractor`,
`fundPositionGridExtractor` (nouveaux) ; `bankIdentity`,
`bankReportExtractionContract`, `importPreflightService`,
`operationalImportReadiness`, `multiBankReportExtraction`, `uploadRuntimeGuard`,
`uploadErrorHygiene` (contrat de source), `sensitiveSentinelRuntime` (exécution par sentinelles, FIX_4)
(complétés ou adaptés : contrat de source `processFiles(otherFiles, { sheetSelections })`).

`package.json` : scripts uniquement. Docs : ce rapport, runbook de
qualification, `STATUS_REGISTRY`, `MASTER_CONTEXT`, `DEFERRED_BACKLOG`
(DEF-20 à DEF-24).

## 5. Validation locale sur fichiers réels (`…_FIX_3` puis `…_FIX_4`, hors dépôt, sous GO)

Rejeu `GO_VALIDATE_LOCAL_PACK_2_REAL_FILES_JULY_SENSITIVE_FIX_4` (harness,
feuille du 9 juillet ; Fund Position 7 juillet ; échantillons 60 / 150
feuilles) : verdicts, codes d'erreur et compteurs **identiques** à FIX_3 —
FIX_4 ne modifie ni l'acceptation ni le refus d'un document réel, seulement
la forme des journaux et des erreurs ; le durcissement du libellé de facilité
ne change aucun verdict (aucune facilité réelle n'était libellée par un
marqueur ou un montant). Aucune persistance, aucune sortie brute.

Harness officiel, feuille du 9 juillet 2026 (Fund Position : dernière feuille
disponible, 7 juillet 2026) :

| Famille | Décision | Motif |
|---|---|---|
| BDK | `FAIL_CLOSED` | deux lignes chiffrées après le total des facilités (DEF-25) |
| ATB | `FAIL_CLOSED` | deux lignes libellées « LIMITE » / « DISPONIBLE » après le total des facilités (DEF-25) — auparavant ignorées à tort comme en-tête de colonnes |
| BICIS | `FAIL_CLOSED` | facilité unique sans libellé métier (DEF-26) ; chèques en colonne non titrée (DEF-27) |
| ORA | `FAIL_CLOSED` | chèques en colonne non titrée (DEF-27) |
| BIS | `FAIL_CLOSED` (`DOCUMENT_RESOURCE_LIMIT_EXCEEDED`) | cellule parasite en XFD sans date calendaire valide (DEF-28) |
| SGBS | `NOT_TESTED` | aucun fichier fourni |
| Fund Position | `FAIL_CLOSED` | colonne Grand Balance absente (DEF-20) ; titre COLLECTION NOT DEPOSITED sans montant (DEF-24) ; date non corroborée (nom de fichier sans année) |

Échantillon de 60 feuilles par banque (verdicts et motifs seulement) :

| Famille | PASS | Motifs de refus résiduels |
|---|---|---|
| BDK | 46/60 | 6 lignes après le total des facilités ; 9 marqueurs d'impayé non listés (DEF-22) ; 2 soldes d'ouverture postérieurs ; 1 cellule d'erreur |
| ATB | 0/60 | 120 lignes après le total des facilités (DEF-25, libellées « LIMITE » et « DISPONIBLE ») ; 1 solde postérieur ; 2 lignes hors section |
| BICIS | 0/60 | 60 facilités sans libellé (DEF-26) ; 2 chèques en colonne non titrée (DEF-27) ; 1 facilité non exploitable ; 1 écart de dates |
| ORA | 0/60 | 960 chèques en colonne non titrée (DEF-27) ; 64 lignes hors section ; 54 facilités non exploitables (DEF-21) ; 10 titres de section portant des montants ; 4 soldes postérieurs ; 2 clôtures en erreur Excel ; 1 nom de feuille non corroboré |
| BIS | 9/60 | 47 feuilles refusées à la lecture de la grille (cellule XFD sans date valide, DEF-28) ; 6 lignes après le total ; 1 solde postérieur |
| Fund Position (150 feuilles) | 0/150 | titre COLLECTION NOT DEPOSITED sans montant (150) ; colonne Grand Balance absente (102) ; date non corroborée (95) ; cellules d'erreur et montants vides |

Lecture : sous les règles des trois contre-revues, **aucune famille n'est
acceptée sur la feuille du 9 juillet** ; seuls BDK (46/60) et BIS (9/60)
conservent des journées acceptées. Ce sont des refus de contrat conformes aux
verdicts : les écarts de format des rapports réels (DEF-20 à DEF-28) doivent
être traités en Pack 2B, par correction à la source en priorité, sinon par
profil bancaire explicite sur attestation métier.

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
9. DEF-28 : cellules parasites en colonne XFD sans date calendaire valide
   (série nulle ou invalide) dans 47 feuilles BIS sur 60 : refus de lecture ;
   correction à la source.

## 7. Sécurité

| Contrôle | Réponse |
|---|---|
| Secrets | non |
| Données bancaires réelles | lues localement sous GO ; aucune dans Git, tests, logs, docs |
| SQL / migration / Supabase live | non |
| Auth / RLS | non |
| Réseau / services tiers | non |
| Journaux navigateur | sans nom de fichier, sans valeur, sans nom de banque de détail, sur tout le graphe d'appel (grille, texte PDF, legacy) — prouvé par sentinelles exécutées |
| Erreurs `/upload` | vocabulaire fermé « ligne N : motif » (`summarizeExtractionErrors`), jamais un message brut d'extracteur |

## 8. Tests et baselines (local, Node 22.23.1, dépendances du lockfile)

| Commande | Résultat |
|---|---|
| `npm run test:multi-bank-reports` (+ `uploadErrorHygiene`, `sensitiveSentinelRuntime`) | 86/86 PASS |
| `sensitiveSentinelRuntime` rejoué sur `cc7fa3c` (worktree temporaire, supprimé) | 2/5 FAIL attendus (chemins texte) — preuve adversariale |
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
