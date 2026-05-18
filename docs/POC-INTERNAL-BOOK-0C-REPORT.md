# Rapport d'Analyse : POC-INTERNAL-BOOK-0C

## A. Résumé exécutif

L'analyse des fichiers Excel Internal Book anonymisés pour les 6 banques (BIS, BICIS, BDK, ORABANK, BRIDGE, ATLANTIK) révèle que le parser actuel (`POC-INTERNAL-BOOK-0A`) sort massivement en `needs_review` (taux estimé proche de 100% sur les données réelles). 

La cause principale est la règle `AMBIGUOUS_AMOUNT_COLUMN` qui se déclenche sur les lignes de détail (dépôts, chèques, impayés). Le parser lit les fichiers Excel en mode `raw: true`, ce qui convertit les dates en numéros de série Excel (ex: 46148). De plus, les colonnes de références (CH.NO, TR No, FACT No, REF) contiennent des valeurs numériques. Le parser considère toutes ces valeurs numériques comme des montants candidats. La logique actuelle `hasClearRightMostAmount` échoue à lever l'ambiguïté car ces colonnes numériques se trouvent souvent après la dernière colonne de texte, ou parce que plusieurs colonnes numériques sont présentes.

Pour ORABANK, le problème est aggravé par l'absence d'aliases pour certaines sections obligatoires (`TOTAL (A)` au lieu de `TOTAL BALANCE A`), provoquant des erreurs `MISSING_REQUIRED_SECTION`.

L'objectif est de proposer des règles déterministes pour exclure ces colonnes non-montant sans introduire de risques de faux positifs.

## B. Tableau par banque

| Banque | Structure observée | Sections détectables | Colonnes montant | Colonnes à exclure | Causes `needs_review` | Corrections recommandées |
|---|---|---|---|---|---|---|
| **BIS** | 120 onglets journaliers (DDMMYY). | Toutes sauf `depositsNotYetCleared` et `impayes`. | `AMOUNT` (Col 7) | `CH.NO` (Col 2), `TR No/FACT.No` (Col 6) | `AMBIGUOUS_AMOUNT_COLUMN` (Col 2 et 6 lues comme montants). | Exclure les colonnes 2 et 6 de la recherche de montants. |
| **BICIS** | 125 onglets journaliers. | Toutes les sections. | `AMOUNT` (Col 7) | `CH.NO` (Col 2), `TR No/FACT.No` (Col 6), Dates impayés (Col 2) | `AMBIGUOUS_AMOUNT_COLUMN` (Col 2 et 6 lues comme montants). | Exclure les colonnes 2 et 6. Ignorer les dates de série Excel en Col 2. |
| **BDK** | 132 onglets journaliers. | Toutes les sections. | `AMOUNT` (Col 7), `AMOUNT 1` (Col 8) | `CH.NO` (Col 2), `TR No/FACT.No` (Col 6) | `AMBIGUOUS_AMOUNT_COLUMN` (Col 2 et 6 lues comme montants, présence de montants en Col 7 et 8). | Exclure les colonnes 2 et 6. Prendre le montant le plus à droite entre Col 7 et 8. |
| **ORABANK** | 92 onglets journaliers. | Manque `totalBalanceA` et `checksNotYetCleared` (libellés non reconnus). | `MONTANT` (Col 7), `MONTANT -2` (Col 8), Col 9 | `CH.NO/BD` (Col 2), `REF.` (Col 6) | `MISSING_REQUIRED_SECTION`, `AMBIGUOUS_AMOUNT_COLUMN`. | Ajouter les aliases manquants. Exclure les colonnes 2 et 6. Prendre le montant le plus à droite (Col 7, 8 ou 9). |
| **BRIDGE** | 95 onglets journaliers, 1 onglet "Feuil1". | Toutes sauf `impayes`. | `AMOUNT` (Col 7) | `CH.NO` (Col 2), `TR No/FACT.No` (Col 6) | `AMBIGUOUS_AMOUNT_COLUMN` (Col 2 et 6 lues comme montants). | Exclure les colonnes 2 et 6. |
| **ATLANTIK** | 89 onglets journaliers. | Toutes les sections. | `AMOUNT` (Col 7) | `CH.NO` (Col 2), `TR No/FACT.No` (Col 6), Dates impayés (Col 2) | `AMBIGUOUS_AMOUNT_COLUMN` (Col 2 et 6 lues comme montants). | Exclure les colonnes 2 et 6. Ignorer les dates de série Excel en Col 2. |

## C. Liste des aliases à ajouter

Pour résoudre les erreurs `MISSING_REQUIRED_SECTION` (particulièrement sur ORABANK), les aliases suivants doivent être ajoutés dans `SECTION_DEFINITIONS` :

**Section `depositsNotYetCleared` :**
- `DEPOTS PAS ENCORE ENCAISSE` (sans 'S' à la fin)

**Section `totalBalanceA` :**
- `TOTAL (A)`
- `TOTAL A`

**Section `checksNotYetCleared` :**
- `LESS CHEQUES EMIS NON ENCAISSES`
- `CHEQUES EMIS NON ENCAISSES`

**Section `closingBalanceC` :**
- `SOLDE DE CLÔTURE` (avec accent circonflexe)

## D. Règles déterministes proposées

Pour réduire drastiquement les faux `needs_review` liés à `AMBIGUOUS_AMOUNT_COLUMN`, nous recommandons les ajustements déterministes suivants dans le parser :

1. **Exclusion stricte des numéros de série Excel pour les dates :**
   Actuellement, la règle `columnIndex === 1 && this.looksLikeExcelSerialDate(raw)` exclut les dates en colonne 1.
   *Recommandation :* Étendre cette exclusion à la colonne 2 (`columnIndex === 2`) pour gérer les lignes d'impayés qui contiennent souvent une date de rejet en colonne 2.

2. **Exclusion par index de colonne basé sur les en-têtes standardisés :**
   Dans tous les fichiers analysés, les colonnes 2 (`CH.NO`, `CH.NO/BD`) et 6 (`TR No/FACT.No`, `REF.`) contiennent des identifiants numériques qui ne sont jamais des montants.
   *Recommandation :* Ajouter une règle déterministe dans `parseMoneyCell` : si `columnIndex === 2` ou `columnIndex === 6`, retourner `undefined` (ne pas traiter comme montant). Cette règle est sûre car les montants se trouvent toujours en colonne 7, 8 ou 9.

3. **Sélection du montant le plus à droite (Right-Most) :**
   Pour BDK (colonnes 7 et 8) et ORABANK (colonnes 7, 8 et 9), les montants peuvent être répartis sur plusieurs colonnes.
   *Recommandation :* Une fois les colonnes 2 et 6 exclues, s'il reste plusieurs candidats (ex: Col 7 et Col 8), la logique actuelle `selectRightMostMoney` (qui prend le dernier candidat) est correcte et déterministe. L'ambiguïté ne doit être levée en `needs_review` que si les candidats restants ne sont pas contigus (ex: Col 4 et Col 8), ce qui indiquerait une structure anormale.

## E. Cas où needs_review doit rester obligatoire

Le statut `needs_review` doit impérativement être conservé dans les cas suivants pour garantir la sécurité des données :

1. **Mismatches de validation :** Toute différence entre un total déclaré (ex: `TOTAL BALANCE (A)`) et le total calculé (ex: `OPENING BALANCE` + somme des dépôts) dépassant la tolérance.
2. **Sections requises manquantes :** Si malgré les nouveaux aliases, une section comme `closingBalanceC` est introuvable.
3. **Montant requis manquant :** Si aucun montant n'est trouvé sur la ligne d'un total obligatoire.
4. **Ambiguïté résiduelle :** Si, après exclusion des colonnes 2 et 6, on trouve plusieurs montants candidats séparés par du texte, ou plus de 3 montants sur une ligne de facilités bancaires.

## F. Plan de tests Codex minimal

Voici la matrice de tests à fournir à Codex pour valider ces modifications :

1. **Test ORABANK Aliases :**
   - *Input :* Un fichier synthétique avec les sections `TOTAL (A)` et `LESS CHEQUES EMIS NON ENCAISSES`.
   - *Expected :* Le parser détecte correctement `totalBalanceA` et `checksNotYetCleared`, sans erreur `MISSING_REQUIRED_SECTION`.

2. **Test Exclusion CH.NO et REF (Toutes banques) :**
   - *Input :* Une ligne de détail avec `CH.NO` = 123456 (Col 2), `REF` = 7890 (Col 6), et `AMOUNT` = 50000 (Col 7).
   - *Expected :* Le parser extrait uniquement 50000 comme montant. Aucune erreur `AMBIGUOUS_AMOUNT_COLUMN`.

3. **Test Exclusion Date Série Excel (Impayés) :**
   - *Input :* Une ligne d'impayé lue en `raw: true` avec Col 1 = 46148 (date), Col 2 = 46145 (date), Col 7 = 150000.
   - *Expected :* Les colonnes 1 et 2 sont ignorées. Le montant extrait est 150000.

4. **Test Right-Most Amount (BDK/ORABANK) :**
   - *Input :* Une ligne avec `AMOUNT` = 10000 (Col 7) et `AMOUNT 1` = 25000 (Col 8).
   - *Expected :* Le parser extrait 25000 (le plus à droite) sans lever d'ambiguïté.

## G. Risques de faux positifs / faux négatifs

- **Faux positifs (rejet d'un fichier valide) :** Le risque est très faible avec ces règles. L'exclusion stricte des colonnes 2 et 6 est basée sur une observation constante sur les 6 banques.
- **Faux négatifs (acceptation d'un fichier erroné) :** Le risque principal serait qu'une banque change soudainement son format et place un montant réel en colonne 2 ou 6. Dans ce cas, le montant serait ignoré. Cependant, les règles de validation croisée (`OPENING_PLUS_DEPOSITS_MISMATCH`, `A_MINUS_B_MISMATCH`) détecteraient l'absence de ce montant lors du calcul des totaux, forçant ainsi le fichier en `needs_review`. La sécurité est donc maintenue.
