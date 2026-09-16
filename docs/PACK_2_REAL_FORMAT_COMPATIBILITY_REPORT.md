# Pack 2 — Compatibilité des formats réels (rapports bancaires et Fund Position)

**Date :** 2026-09-16
**GO :** `GO_IMPLEMENT_PACK_2_REAL_FORMAT_COMPATIBILITY` (niveau élevé, base `4412d0c9`)
**Statut :** `IMPLEMENTED_LOCAL — DRAFT_PR — MERGE_BLOCKED_UNTIL_PACK_0_CLOSURE_AND_PACK_0R`

## 1. Objet

La campagne locale `GO_VALIDATE_LOCAL_PACK_2_REAL_FILES_JULY_SENSITIVE` (2026-09-16)
avait établi que les fichiers réels de juillet 2026 étaient refusés par les
contrats d'extraction pour des raisons de format, non de qualité : classeurs
annuels à une feuille par jour, identité bancaire exigée unique sur tout le
contenu, dates à année sur deux chiffres, libellés français ORA, Fund Position
tabulaire, feuille BIS déclarée sur 16 384 colonnes. Ce pack rend les
extracteurs compatibles avec ces formes, sans relâcher le principe fail-closed
et sans inventer de donnée.

Aucun fichier réel, aucune valeur financière, aucun nom de feuille (dates) ne
figure dans le dépôt, les tests, les journaux ou ce rapport. Les tests
versionnés sont exclusivement synthétiques.

## 2. Règles introduites (déterministes, documentées)

### 2.1 Sélection explicite d'une feuille (`src/services/excelSheetGrid.ts`)

- Un classeur Excel de rapport bancaire ou de Fund Position est traité sur
  **une** feuille. Un classeur à une seule feuille la retient implicitement ;
  un classeur à plusieurs feuilles exige un nom de feuille explicite
  (`SHEET_SELECTION_REQUIRED`), sinon refus. **Aucune concaténation de
  feuilles** n'existe plus dans `/upload`, ni dans le harness.
- `/upload` : le précontrôle lit localement l'inventaire des feuilles (noms
  seulement, `SHEET_INVENTORY_PENDING` tant qu'il n'est pas connu) et affiche un
  sélecteur par classeur multi-feuilles ; le fichier reste `BLOCKED` sans
  sélection. La sélection est transmise à `fileProcessingService.processFiles`
  par clé de fichier (`importFileKey`).
- Le repli de détection par contenu (nom de fichier insuffisant) ne lit que la
  première feuille.

### 2.2 Grille bornée par les cellules réelles

- La grille est construite depuis les cellules présentes, jamais depuis la
  plage déclarée `!ref` : une feuille BIS déclarée `A1:XFD37` produit 8 colonnes.
- Les cellules au-delà de la 512e colonne (cellules parasites en fin de feuille)
  ne sont ni lues ni parcourues ; elles sont comptées (`ignoredFarCellCount`).
- Une cellule sans valeur, ou au format date sans date calendaire valide, est
  vide. Bornes : 20 000 lignes, 512 colonnes, 1 000 000 cellules.
- Une cellule numérique au format date est convertie depuis son **numéro de
  série Excel** (base 1900, `SSF.parse_date_code`) en date ISO, jamais depuis
  son rendu texte `m/d/yy`. Une cellule d'erreur Excel (`#REF!`, `#DIV/0!`…)
  est conservée comme erreur et refuse tout montant de sa ligne.

### 2.3 Dates textuelles (`parseDocumentDate`)

`JJ/MM/AAAA`, `JJ-MM-AAAA`, `AAAA-MM-JJ` inchangés ; **`JJ/MM/AA` = jour en
premier, année 2000 + AA** (libellés de solde saisis dans les rapports réels).
Toute autre forme (`7/9/26`, `07/9/26`, rendu SheetJS) est refusée.

### 2.4 Identité bancaire par l'émetteur (`src/services/bankIdentity.ts`)

- L'identité d'un document est l'émetteur déclaré dans son **en-tête** : sur
  une grille, les lignes précédant le solde d'ouverture ; sur un texte, les
  trois premières lignes non vides. Le corps peut citer d'autres banques
  (chèques et dépôts tirés sur BDK, SGBS, CBAO, ECOBANK…).
- Zéro banque ou plusieurs banques dans l'en-tête = **fail-closed** (message
  d'ambiguïté listant les banques citées, sans valeur).
- Alias ATB strictement listés : nom de fichier `ATLANTIQUE BANK`,
  `ATLANTIK BANK` ; contenu `ATLANTIQUE BANK` (en plus des motifs existants).
  `ATLANTIC BANK` reste refusé.
- `corroborateBankIdentity`, `bankReportSectionExtractor` (PDF),
  `detectImportDocumentFromText` et `documentDetectionService` appliquent la
  même règle.

### 2.5 Extracteur tabulaire des rapports bancaires (`src/services/bankReportGridExtractor.ts`)

- Libellés strictement listés. Anglais (BDK, ATB, BICIS, BIS, SGBS) :
  `OPENING BALANCE JJ/MM/AA`, `CLOSING BALANCE as per Book`, `DEPOSIT NOT YET
  CLEARED`, `CHECK Not yet cleared`, `BANK FACILITY (…)`, `IMPAYE`. Français
  ORA : `SOLDE D'OUVERTURE JJ/MM/AAAA`, `SOLDE DE CLÔTURE …`, `Dépôts pas encore
  encaissé`, `Chéques émis non encaissés`, `Impayés` (facilités : `BANK
  FACILITY`).
- Date du rapport : le nom de feuille `JJMMAA` fait foi ; le solde d'ouverture
  est daté du jour ou d'un jour antérieur (clôture de la veille, constaté sur
  les fichiers réels), jamais postérieur ; sans nom de feuille daté, la date du
  solde d'ouverture est la date du rapport.
- Montant d'une ligne : dernière cellule **formatée en montant** (format
  comptable) non nulle ; zéro si toutes nulles (colonnes « - ») ; une cellule
  numérique sans format (référence, compteur) n'est jamais un montant ;
  montant non entier ou cellule d'erreur = refus.
- Sections : dépôts (implicite après le solde d'ouverture, titre facultatif —
  rapports BIS), chèques, facilités (ligne d'en-tête `Limit | Used | Balance`
  ignorée ; ligne datée sans libellé nommée par le titre de section — BICIS ;
  ligne de total sans date = fin ; lignes suivantes comptées, non
  persistées), impayés (marqueur `IMPAYE` en 3e colonne, code client en 4e).
- Une ligne datée non exploitable, une ligne datée hors section, un solde
  absent, une cellule d'erreur refusent le document. Une section titrée sans
  ligne est un état normal (titre imprimé chaque jour) : avertissement, pas
  refus.

### 2.6 Extracteur tabulaire Fund Position (`src/services/fundPositionGridExtractor.ts`)

- En-tête : `Bank Balance | Fund Applied | Net Balance | NonValidated Deposit`
  obligatoires, `Grand Balance` signalée si absente ; une ligne par banque
  (nom = dernière cellule texte avant la colonne de solde) ; cellule vide,
  d'erreur ou non entière = refus.
- Date : nom de feuille `JJMMAA`, sinon `FUND POSITION JJ/MM/AAAA` ou `REPORT
  DATE …`, sinon refus.
- `totalFundAvailable` = ligne `TOTAL FUND AVAILABLE` sous la colonne Net
  Balance ; `grandTotal` = même ligne sous Grand Balance ; `depositForDay` /
  `paymentForDay` = somme des lignes de leur bloc (lignes sans montant
  ignorées) ; `collectionsNotDeposited` = montant porté par la ligne du titre,
  sinon 0.
- HOLD : colonnes fixées par l'en-tête du bloc (`MONTANT` = montant, jamais la
  dernière cellule formatée : la colonne des jours peut l'être) ; jours et
  date de dépôt facultatifs ; le bloc se termine par une ligne non datée à
  montant unique égal à la somme.
- **Sans colonne Grand Balance, le document est refusé** : ni le solde global
  par banque ni le grand total ne sont dérivés (voir §5).

### 2.7 Harness (`scripts/qualifyOperationalImportRealFile.ts`)

- Attestation : exactement une de `--anonymized` ou
  `--real-sensitive-authorized` (usage local d'un fichier réel sous GO
  nominatif ; le harness n'est jamais un anonymiseur).
- `--sheet <nom>` : feuille à traiter ; refus `SHEET_SELECTION_REQUIRED` sur un
  classeur multi-feuilles sans sélection, `SHEET_NOT_FOUND` sinon. Le plafond
  de 50 feuilles est supprimé (seule la feuille choisie est convertie ; pour un
  XLSX, seule elle est analysée par SheetJS).
- Sortie : mêmes invariants (aucune donnée brute, aucun chemin, aucun nom de
  feuille) plus `attestation`, `sheetSelection` (`explicit` / `single` /
  `not-applicable`) et `gridEvidence` (lignes, colonnes, cellules d'erreur,
  lignes ignorées après total). Nouveau code `EXCEL_ERROR_CELL`.

## 3. Fichiers modifiés

Runtime : `src/services/excelSheetGrid.ts` (nouveau),
`src/services/bankReportGridExtractor.ts` (nouveau),
`src/services/fundPositionGridExtractor.ts` (nouveau),
`src/services/bankIdentity.ts`, `src/services/bankReportExtractionContract.ts`,
`src/services/bankReportSectionExtractor.ts`,
`src/services/bankReportProcessingService.ts`,
`src/services/fileProcessingService.ts`, `src/services/importPreflightService.ts`,
`src/services/documentDetectionService.ts`,
`src/services/operationalImportRealFileQualification.ts`,
`scripts/qualifyOperationalImportRealFile.ts`, `src/pages/FileUpload.tsx`.

Tests synthétiques : `excelSheetGrid.synthetic.test.ts`,
`bankReportGridExtractor.synthetic.test.ts`,
`fundPositionGridExtractor.synthetic.test.ts` (nouveaux) ;
`bankIdentity`, `bankReportExtractionContract`, `importPreflightService`,
`multiBankReportExtraction` (complétés).

`package.json` : scripts uniquement (`test:multi-bank-reports` étendu aux trois
nouvelles suites) ; aucune dépendance ni lockfile modifié.

Docs : ce rapport, `docs/OPERATIONAL_IMPORT_MULTI_BANK_REAL_FILE_QUALIFICATION_STAGING_PREP.md`,
`docs/STATUS_REGISTRY.md`, `docs/MASTER_CONTEXT.md`, `docs/DEFERRED_BACKLOG.md`.

## 4. Validation locale sur les fichiers réels (hors dépôt, sous GO)

Harness officiel, feuille du 9 juillet 2026 (Fund Position : dernière feuille
disponible, 7 juillet 2026 ; le classeur ne contient pas le 9 juillet) :

| Famille | Décision | Preuves agrégées |
|---|---|---|
| BDK | `LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW` | 2 dépôts, 76 chèques, 8 facilités, 8 impayés |
| ATB | `LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW` | 1 dépôt, 2 chèques, 3 facilités, 8 impayés |
| BICIS | `LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW` | 4 dépôts, 3 chèques, 1 facilité, 2 impayés |
| ORA | `LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW` | 2 dépôts, 16 chèques, 2 facilités, 12 impayés |
| BIS | `LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW` | 1 dépôt, 4 chèques, 17 facilités, 0 impayé |
| SGBS | `NOT_TESTED` | aucun fichier fourni |
| Fund Position | `FAIL_CLOSED` (`FUND_POSITION_GRAND_TOTAL_INVALID`, `FUND_POSITION_DETAILS_INVALID`) | colonne Grand Balance absente |

Un classeur multi-feuilles sans `--sheet` est refusé (`SHEET_SELECTION_REQUIRED`).

Robustesse sur un échantillon de 60 feuilles par banque (harness local
d'extraction, verdicts et motifs seulement) :

| Famille | PASS | Motifs de refus résiduels (fail-closed) |
|---|---|---|
| BDK | 48/60 | 9 lignes d'impayés avec un marqueur de type non listé (3e colonne ≠ `IMPAYE`), 2 soldes d'ouverture datés après la feuille, 1 cellule d'erreur Excel |
| ATB | 59/60 | 1 solde d'ouverture daté après la feuille |
| BICIS | 59/60 | 1 ligne de facilité non exploitable |
| ORA | 11/60 | 49 feuilles dont les lignes de facilités ne portent que deux montants (limite et solde, colonne « utilisé » vide) ; 6 lignes datées hors section ; 4 dates d'ouverture postérieures ; 2 soldes de clôture en erreur Excel |
| BIS | 56/60 | 2 dates textuelles malformées en colonne A, 2 soldes d'ouverture datés après la feuille |
| Fund Position (150 feuilles) | 24/150 | 102 feuilles sans colonne Grand Balance (formats récents, dont juillet 2026) ; cellules `#REF!` et montants vides dans les autres |

Ces refus sont des décisions de contrat, pas des défauts du harness ; ils
sont consignés dans `docs/DEFERRED_BACKLOG.md` (DEF-20 à DEF-23) pour
arbitrage CTO.

## 5. Points d'arbitrage CTO

1. **Fund Position sans colonne Grand Balance** (feuilles récentes). Sur les
   860 lignes bancaires vérifiables des feuilles qui portent la colonne,
   `Grand Balance = Net Balance + NonValidated Deposit` sans exception ; mais
   le grand total inscrit sur la ligne `TOTAL FUND AVAILABLE` n'est pas la somme
   de cette colonne dans 111 feuilles sur 137. Dériver un grand total serait
   donc inventer une valeur : le pack refuse. Options : (a) rendre `grandTotal`
   et `grandBalance` facultatifs dans le modèle et la base ; (b) exiger le
   rétablissement de la colonne dans le document source ; (c) accepter une
   dérivation explicitement marquée.
2. **Facilités ORA à deux montants** : sans en-tête de colonnes, « utilisé »
   vide ne peut être lu comme zéro sans décision métier.
3. **Marqueur de type d'impayé BDK** : lister les types admis (3e colonne) ou
   accepter tout texte avec code client présent.
4. **Lignes datées hors section** (ORA) : lignes placées après un total ;
   refus maintenu.

## 6. Sécurité

| Contrôle | Réponse |
|---|---|
| Secrets | non |
| Données bancaires réelles | lues localement sous GO ; aucune dans Git, tests, logs, rapport |
| SQL / migration / Supabase live | non |
| Auth / RLS | non |
| Réseau / services tiers | non |
| Copies temporaires | aucune créée par ce pack |

## 7. Tests et baselines (local, Node 22.23.1, dépendances du lockfile)

| Commande | Résultat |
|---|---|
| `npm run test:multi-bank-reports` (+3 suites) | 73/73 PASS |
| `npm run test:import-preflight` | 58/58 PASS |
| `npm run test:upload-guard` | 14/14 PASS (contrat de source mis à jour : `processFiles(otherFiles, { sheetSelections })`) |
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
aucun item nouveau (comparaison fichier|règle|sévérité).
