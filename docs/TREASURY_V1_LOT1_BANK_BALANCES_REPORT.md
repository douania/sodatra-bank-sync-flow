# TREASURY V1 — LOT 1 : soldes fiables multibanques

**GO :** `GO_IMPLEMENT_TREASURY_V1_LOT1_BANK_BALANCES` — développement local, sur la base du
cadrage trésorerie R3 (`PASS_WITH_RESERVES`, hors dépôt).
**Correctif :** `GO_FIX_TREASURY_V1_LOT1_BANK_BALANCES`, après la contre-revue CTO `FAIL` sur `96be87d` (§ 5 ter).
**Base :** `origin/main` `49afcefba199a1a163c3bc1b1487f87e7b026850` (vérifiée avant travail).
**Branche :** `codex/treasury-v1-lot1-bank-balances`, worktree isolé. **Aucun merge.**
**Environnements :** aucun. PostgreSQL 17 local jetable uniquement ; fixtures synthétiques.

## 1. Périmètre livré

Couche « solde » seule. Aucune lecture du registre des chèques, des factures, des virements
déclarés, des remises ni des facilités.

| Élément | Réalisation |
|---|---|
| Inventaire des comptes attendus | `treasury_private.expected_accounts`, versionné par journal et attestations. Un compte du registre Daily v2 garde son identité canonique (aucun alias propre) ; il ne figure qu'une fois parmi les comptes actifs (index unique). Un compte attendu sans relevé (NSIA, compte à ouvrir) porte un alias ; s'il existe déjà au registre, l'ajout est refusé et le **rattachement** est imposé. Aucun compte NSIA n'est créé dans Daily v2. |
| Attestation | L'administrateur unique atteste **l'empreinte qu'il a vue** ; toute modification intercalée est refusée. L'attestation devient caduque dès que l'inventaire change. |
| Qualification | `treasury_private.bank_format_qualifications`, en ajout seul et journalisée, écrite **uniquement** par `treasury_private.set_bank_format_qualification`, sans aucun privilège d'exécution pour l'API. La migration ne pose **aucune** qualification. Les tests posent des statuts dans leur seule base jetable. |
| Solde historique à D | `public.treasury_balances_at_v1(date)`, une seule instruction SQL `STABLE`. |
| Couverture et motifs | Statuts `AVAILABLE` / `NOT_COVERED` / `BLOCKED` / `OUT_OF_SCOPE`, motifs fermés (§ 3). |
| Dates | Date bancaire couverte (dernière date que la lecture rendrait disponible), date seulement observée, ingestion de **chaque** source utilisée et instant de lecture, séparés. Ancienneté en jours sur la date couverte, fuseau Africa/Dakar. |
| Sources | Preuves effectivement utilisées pour le solde de D, avec références et dates : unité source, fichier qui prouve sa clôture ou unité suivante qui la confirme, contrôle de chaîne de son ouverture, périodes déclarées des journées reportées (§ 3). |
| Consolidation | XOF seule, `COMPLETE` / `PARTIAL` / `BLOCKED`, avec les comptes manquants nommés. Un sous-total partiel n'est jamais présenté comme un total ; aucun montant sans compte disponible. |
| Dates de valeur | Lignes avec date de valeur sur les 90 jours précédant D, par compte (mesure seule). |
| Accès | Lecture par `payables_private.require_bank_read` (READ ou AUDIT, puis BANK_READ), inchangé. Inventaire par `payables_private.require_admin`, inchangé. Aucun rôle, aucune RLS existante, aucune règle Auth modifiés. |
| Interrupteur serveur | Module **fermé par défaut** : `treasury_private.module_switch_events`, en ajout seul et journalisé, écrit uniquement par `treasury_private.set_module_open` (aucun privilège d'exécution pour l'API). Tant qu'aucune ouverture n'est enregistrée, la lecture et les quatre commandes d'inventaire sont refusées (`TREASURY_MODULE_CLOSED`) à tous, administrateur compris. Appliquer la migration n'ouvre donc rien. |
| Vue « Soldes à date » | `/treasury-balances`, local et staging seulement. En production, menu et route refusés, même avec le drapeau « administration seule » du module chèques ; refus avant tout appel au service. Cache de lecture lié à la session : utilisateur dans la clé, aucune lecture sans session, rien conservé une fois la vue quittée, aucune donnée affichée à côté d'une erreur. |
| ATB | Ambiguïté corrigée : `ARAB TUNISIAN BANK` n'est plus rattaché à ATB. `ATLANTIQUE BANK` et `ATLANTIK BANK` sont reconnus dans le **nom** du fichier seulement : dans le contenu, ils peuvent figurer dans les libellés d'opérations d'une autre banque. |
| BIS | Vérifié sans modification : la devise fixe XOF est corroborée par les en-têtes obligatoires `DEBIT XOF` et `CREDIT XOF`. |

## 2. Provenance des périodes d'export (établie avant le développement)

| Format | Banques | Période | Source dans le code (`49afcef`) |
|---|---|---|---|
| `structured_bank_statement_csv` (`structured-csv-0b`) | BDK, ORA | **Déclarée** par la ligne d'en-tête « Période », exigée à l'import | `structuredBankStatementCsvParser.ts` (`extractMetadata`), `dailyV2BrowserPipeline.ts` (`requireStrictDate`) |
| `structured_bank_statement_xls` / `_xlsx` (`structured-excel-0q/…`) | ATB, BICIS, BIS / BRIDGE | **Déduite** de la première et de la dernière opération | `structuredBankStatementExcelParser.ts` (`periodStart`, `periodEnd`) |

Faits complémentaires :
- une unité Daily v2 a toujours au moins une ligne : une journée sans mouvement n'a **jamais** d'unité ;
- une journée est provisoire à partir de la date de référence de l'export (ou, pour ORA sans référence, son dernier jour) ;
- la base ne conserve **ni** la provenance de la période **ni** les soldes déclarés de l'export.

**Fichier digne de preuve.** Un export ne prouve quelque chose (clôture d'une journée, absence de mouvement) que s'il remplit toutes les conditions suivantes :
- il est valide, produit par une version de parseur prise en charge, et ne porte aucun motif de revue (par exemple `ACCOUNT_IDENTITY_NOT_CORROBORATED`) ;
- il est entièrement accepté : aucune journée livrée en conflit, en attente, à revoir ou en échec, aucune journée livrée non valide ou portant un motif de revue.

Règle appliquée (table `treasury_private.supported_formats`, figée) : une journée sans mouvement n'est couverte que si une période **déclarée** d'un fichier digne de preuve remplit en outre les conditions suivantes :
- la journée y est close : le fichier porte une ligne datée **après** elle (et au plus tard le jour de son dépôt, heure de Dakar) ; aucune journée n'est close par un fichier sans ligne ultérieure ;
- aucune autre livraison de la journée ne la dispute (mouvement livré non retenu, version en attente ou en conflit).

Sinon la journée reste `NON COUVERT`. Aucune unité fictive, aucune opération artificielle. La continuité de la chaîne des soldes n'est **pas** une condition de la preuve : elle est contrôlée séparément (§ 3).

**Fin d'une journée.** La base ne connaît ni l'heure de production du fichier par la banque, ni de date d'édition fournie par elle. L'instant de dépôt (`created_at`) peut suivre de plusieurs jours un fichier produit en cours de journée, et la date de référence est saisie par l'opérateur, facultative (`DailyStatementV2.tsx`). Ni l'un ni l'autre ne prouve donc qu'une journée est finie. Seule une **ligne datée après elle**, dans le même fichier, le prouve. Une ligne datée après le dépôt (opération à date future) n'a aucune valeur de preuve.

**Corrections minimales proposées, non réalisées** (elles modifieraient l'ingestion Daily v2 et exigent un arbitrage) :
- enregistrer à l'import la provenance de la période, les soldes d'ouverture et de clôture déclarés, et l'horodatage d'édition fourni par la banque quand le fichier le porte ;
- lire, quand l'export les porte, une période et un solde déclarés dans les profils Excel.

Sans elles, les journées sans mouvement des comptes Excel (week-ends compris) restent non couvertes, et la dernière journée livrée d'un fichier n'est close que par l'ouverture suivante ou par un fichier ultérieur qui la relivre.

## 3. Règles de calcul

**Couverture de D (couche solde)** :
- unité canonique active de D retenue (voir le tableau ci-dessous), ou journée sans mouvement prouvée (§ 2) ;
- le solde d'une journée prouvée sans mouvement est reporté depuis la clôture de l'unité close précédente, à travers des journées prouvées sans mouvement ; à défaut, depuis l'ouverture de l'unité suivante, close ou non (l'ouverture d'une journée est connue dès son début).

**Unité de la journée**, examinée dans cet ordre :

| Situation | Motif | Statut |
|---|---|---|
| Une autre livraison de la journée est en conflit (contenu divergent) | `DAY_CONFLICT` | `BLOCKED` |
| Une autre livraison est en attente, à revoir, en échec ou provisoire | `DAY_CONTESTED` | `NOT_COVERED` |
| Version de parseur non prise en charge | `PARSER_VERSION_UNSUPPORTED` | `NOT_COVERED` |
| Unité ou export à revoir (validation, motif de revue) | `UNIT_NEEDS_REVIEW` | `NOT_COVERED` |
| Soldes non dérivés | `BALANCE_NOT_DERIVED` | `NOT_COVERED` |
| Journée non close (voir ci-dessous) | `DAY_NOT_CLOSED` | `NOT_COVERED` |

Une unité retenue n'est **close** que si l'une de ces preuves existe :
- (a) un fichier digne de preuve (§ 2) qui en livre le contenu exact porte une ligne datée après elle, et au plus tard le jour de son dépôt ;
- (b) la journée suivante qui n'est pas prouvée sans mouvement est une unité retenue dont l'ouverture égale sa clôture.

Une journée sans unité est provisoire (`PROVISIONAL_DAY`), disputée si une livraison non retenue existe (`DAY_CONTESTED`), sans mouvement si elle est prouvée (§ 2), sinon non prouvée (`DAY_WITHOUT_PROOF`).

**Chaîne des soldes jusqu'à D.** L'ouverture de **toute** unité canonique est contrôlée, quelle que soit la nature de sa journée : disputée, en conflit, à revoir, version de parseur non prise en charge, non close. La dispute d'une journée ne masque donc jamais la contradiction qu'elle porte (constat CTO P1).

L'ouverture est comparée, dans cet ordre :
- au solde de la veille **prouvé en avant** : clôture d'une unité close, reportée à travers des journées prouvées sans mouvement. Un report arrière n'est jamais une référence, car il vient de l'ouverture contrôlée elle-même ;
- à défaut, à la **dernière clôture canonique connue**, quelle que soit la nature de cette unité. L'ancrage est la toute première unité canonique de clôture connue ; il n'y a aucun réancrage silencieux.

Une journée est **non résolue** si elle est en conflit, disputée, provisoire, à revoir ou d'une version de parseur non prise en charge. Une unité retenue sans solde dérivé ne se résoudra pas : elle compte comme une journée non prouvée, à travers laquelle la continuité n'est admise que si les soldes concordent. Une continuité qui s'appuie sur la clôture d'une journée non résolue, ou qui en enjambe une, n'est pas prouvée, même si les montants concordent. Il en va de même du premier ancrage de la chaîne quand une journée non résolue le précède : l'historique d'un compte commence à sa première unité retenue, à sa première période déclarée probante ou à sa première livraison non remplacée, la plus ancienne des trois. L'incertitude se propage ainsi à toutes les dates postérieures jusqu'à la résolution de cette journée dans Daily v2.

| Situation | Statut |
|---|---|
| Ouverture différente du solde prouvé en avant de la veille, à D ou avant, journée disputée comprise | `BLOCKED` (`CHAIN_BROKEN`) |
| Discontinuité avec la dernière clôture canonique connue, à travers des journées non prouvées, à D ou avant | `NOT_COVERED` (`CHAIN_UNPROVEN`) |
| Continuité appuyée sur une journée non résolue, ou qui en enjambe une, ou premier ancrage précédé d'une telle journée, à D ou avant | `NOT_COVERED` (`CHAIN_UNPROVEN`), jusqu'à résolution |
| Solde de D reporté en arrière depuis une unité dont l'ouverture n'est pas prouvée continue | `NOT_COVERED` (`CHAIN_UNPROVEN`) : le contrôle de l'unité qui fournit le solde compte |
| Solde de D reporté en arrière depuis une unité d'une autre devise | `BLOCKED` (`CURRENCY_CONTRADICTION`) : la devise est contrôlée jusqu'à l'unité qui fournit le solde |
| Continuité à travers des journées non prouvées, sans journée non résolue | Acceptée ; ces journées elles-mêmes restent non couvertes |

**Contrôle après D.** Le solde de D, reporté ou non, est comparé à **toute ouverture connue** de la première journée suivante qui en porte une :
- unité canonique, quelle que soit sa nature ;
- versions livrées non retenues : provisoire, en attente, à revoir, en échec, en conflit.

| Journées entre D et cette ouverture | Ouverture différente du solde de D |
|---|---|
| Aucune, ou toutes prouvées sans mouvement | `BLOCKED` (`CHAIN_BROKEN_AFTER_DATE`) |
| Non prouvées, mais sans aucune ligne livrée | `NOT_COVERED` (`CHAIN_UNPROVEN_AFTER_DATE`) : écart inexpliqué (exemple : vendredi et lundi d'un même fichier Excel) |
| Au moins une journée porte des lignes de solde inconnu | Aucune conclusion : ces mouvements expliquent l'écart |

Avec la règle de clôture ci-dessus, un D clos suivi d'un écart sans ligne est toujours couvert par un même fichier, qui porte la ligne ultérieure. L'écart y est donc interne au fichier, ce qui justifie le refus.

**Motifs fermés.**

| Famille | Codes |
|---|---|
| Compte | `CURRENCY_OUT_OF_SCOPE`, `BANK_WITHOUT_FORMAT`, `ACCOUNT_NOT_REGISTERED`, `REGISTRY_ACCOUNT_INACTIVE`, `CURRENCY_CONTRADICTION`, `CHAIN_BROKEN`, `CHAIN_BROKEN_AFTER_DATE`, `CHAIN_UNPROVEN`, `CHAIN_UNPROVEN_AFTER_DATE`, `NO_STATEMENT`, `PROVISIONAL_DAY`, `DAY_WITHOUT_PROOF`, `DAY_NOT_CLOSED`, `DAY_CONTESTED`, `DAY_CONFLICT`, `PARSER_VERSION_UNSUPPORTED`, `BALANCE_NOT_DERIVED`, `UNIT_NEEDS_REVIEW`, `BALANCE_UNKNOWN_AT_DATE`, `FORMAT_NOT_QUALIFIED`, `FORMAT_PILOT`, `FORMAT_SUSPENDED` |
| Consolidation | `INVENTORY_EMPTY`, `INVENTORY_NOT_ATTESTED`, `REGISTRY_ACCOUNTS_OUTSIDE_INVENTORY`, `ACCOUNTS_NOT_COVERED`, `ACCOUNTS_BLOCKED` |

Statut `BLOCKED` : `CURRENCY_CONTRADICTION`, `CHAIN_BROKEN`, `CHAIN_BROKEN_AFTER_DATE`, `DAY_CONFLICT`. Un test TypeScript relève les motifs dans la migration elle-même et exige un libellé pour chacun.

**Disponibilité.** `AVAILABLE` exige le format `QUALIFIED` ; `PILOT` et `SUSPENDED` rendent le compte non couvert. Hors `AVAILABLE`, le solde à D est **null**. Le dernier solde observé est rendu à part (`observed_balance`) et n'entre dans aucun calcul.

**Une seule définition par journée.** Chaque journée X de l'historique d'un compte est évaluée comme si elle était la date D : contradictions et incertitudes cumulées jusqu'à X (ou jusqu'à l'unité qui fournit son solde), contrôle de la première ouverture connue après X. La date D demandée et la date couverte lisent cette même évaluation.

**Dates rendues** (constat CTO P2) :
- `bank_date_covered` : dernière date que la lecture rendrait `AVAILABLE`, qualification et devise comprises ; `age_days` est calculé sur elle ;
- `bank_date_observed` : dernière date dont un solde est dérivé, même non validé (rupture, incertitude, format non qualifié). Elle est affichée à part, jamais comme une couverture.

Un test vérifie, pour chaque compte et chaque date de l'historique de test, que la date couverte est exactement la dernière date rendue disponible.

**Sources rendues pour le solde de D** (constat CTO P2), avec références (identifiants internes du fichier et de la journée, sans donnée bancaire) et dates :

| Source | Contenu |
|---|---|
| `CANONICAL_UNIT` | unité qui fournit le solde, rôle `CLOSING` (clôture) ou `OPENING` (report arrière depuis l'ouverture) ; fichier, ingestion de la journée et du fichier |
| `CLOSURE_LATER_LINE` | chaque fichier digne de preuve qui prouve la clôture : livraison ou relivraison, date de la ligne ultérieure, dépôt |
| `CLOSURE_NEXT_OPENING` | à défaut, unité suivante dont l'ouverture égale la clôture : journée, fichier, dépôt |
| `CHAIN_LINK` | contrôle de l'ouverture de l'unité source : résultat et journée de référence (unité dont la clôture a été comparée, ou dernière clôture retenue) |
| `DECLARED_PERIOD` | chaque période déclarée qui prouve au moins une journée sans mouvement utilisée : journées reportées jusqu'à D, journées entre l'unité source et l'ouverture qui confirme sa clôture, journées entre la clôture comparée et l'unité source ; fichier, période, clôture, dépôt |

**Instantané.** Toute la lecture est une seule instruction SQL `STABLE`, appelée par une fonction `STABLE` : elle s'exécute avec l'instantané de la requête appelante. Démontré par une course réelle (§ 5).

## 4. Fichiers

| Fichier | Nature |
|---|---|
| `supabase/migrations/20261102090000_treasury_v1_lot1_bank_balances.sql` | nouveau, additif |
| `src/features/treasury/treasuryRuntimeTarget.ts`, `treasuryService.ts`, `treasuryModel.ts`, `treasuryMenu.ts`, `TreasuryRoute.tsx`, `TreasuryBalancesView.tsx`, `TreasuryInventoryAdmin.tsx` | nouveaux |
| `src/features/treasury/treasuryRuntimeTarget.synthetic.test.ts`, `treasuryModel.synthetic.test.tsx`, `treasuryAccess.synthetic.test.tsx`, `treasuryMutation.proof.ts` | nouveaux (tests ; preuve de mordant locale) |
| `src/pages/TreasuryBalances.tsx` | nouveau |
| `src/App.tsx`, `src/components/Layout.tsx` | route et menu gardés |
| `src/services/bankIdentity.ts`, `src/services/bankIdentity.synthetic.test.ts` | ATB |
| `supabase/tests/treasury_v1_lot1/**` | rejeu PostgreSQL 17, scénarios, mutants, README |
| `package.json` | script `test:treasury-balances` (aucune dépendance, lockfile inchangé) |
| `.github/workflows/ci.yml` | une étape ciblée |
| `docs/STATUS_REGISTRY.md`, `docs/MASTER_CONTEXT.md` | ajout de l'entrée du lot seulement ; aucune autre ligne modifiée |
| ce rapport | documentation |

Fichiers ajoutés en cours de lot, dans le dossier autorisé `src/features/treasury/**` : `TreasuryRoute.tsx`, `TreasuryInventoryAdmin.tsx`, `treasuryMenu.ts`, `treasuryMutation.proof.ts`.

Inchangés :
- objets Daily v2 et payables ;
- RLS existantes et Auth ;
- extraction BDK, empreintes et idempotence ;
- `.env`, dépendances, lockfile ;
- artefact MCP (`npm run build` ne l'a pas modifié).

## 5. Validations

| Contrôle | Résultat |
|---|---|
| `npm run lint` (comparaison item par item à `49afcef`) | 178 erreurs / 11 avertissements, identique à la base ; 0 nouvel item |
| `npx tsc -p tsconfig.app.json --noEmit` | 16 diagnostics, diff exact vide |
| `npx tsc -p tsconfig.node.json --noEmit` | 0 |
| `npm run build` | PASS ; artefact MCP non modifié |
| `npm run test:treasury-balances` | 22/22 (également sans `navigator`, comme sous Node 20) |
| Suites existantes (20 scripts `test:*`) | toutes PASS : CSV 132, CSV E2B 49, Excel 20, Daily v2 application 106, Daily v2 reporting 70, Collections 27, auth 3, BDK PDF 27, garde d'upload 14, financier atomique 25, verrouillage 2, préflight 56, rapports multibanques 49 (dont identité bancaire), contrôle qualité 8, isolation legacy 4, xlsx 6, provenance de build 12, internal book 90, chèques 88 |
| Rejeu PostgreSQL 17, scénario **upgrade** | chaîne de 47 migrations, données existantes, migration du lot, puis toutes les suites : PASS |
| Comparaison de surface (upgrade) | 99 ajouts, tous objets du lot ; 0 objet existant modifié ou retiré ; seuls nouveaux accès : `EXECUTE` des cinq fonctions publiques pour `authenticated` |
| Rejeu PostgreSQL 17, scénario **fresh** | 48 migrations, puis toutes les suites : PASS |
| Course d'instantané (les deux scénarios) | l'écrivain attend que la lecture soit active, valide en ~210 ms et vérifie qu'elle l'est encore (lecture de ~3,2 s) ; la lecture rend exactement l'état antérieur ; une nouvelle lecture voit l'état postérieur |
| Mordant SQL (`-Mutants`, exécuté en CI) | 49/49 mutants tués + m04 (lecture rendue volatile) tué par la course ; les mutants de chaîne m32 à m36 et m45 à m47 changent tous le statut rendu |
| Mordant TypeScript (`treasuryMutation.proof.ts`, local) | 18/18 mutants tués, fichiers restaurés à l'identique |

Les résultats ci-dessus sont ceux du code corrigé après la contre-revue CTO (§ 5 ter).

**Cas couverts par les tests SQL** (34 scénarios synthétiques, plus la reproduction exacte du constat CTO P1).
- **Couverture :**
  - positive : unité close, journée sans mouvement d'une période déclarée dont le fichier porte une ligne ultérieure, journées antérieures au premier mouvement, journée prouvée avant l'ouverture suivante ;
  - absence de preuve : période déduite, après la dernière ligne, période déclarée au-delà de la dernière ligne, export non entièrement accepté, export à revoir, export dont une journée livrée est à revoir, ligne datée après le dépôt, date de référence saisie.
- **Journées et chaîne :**
  - journée provisoire ;
  - journée non close puis close par un fichier ultérieur, ou par l'ouverture suivante ;
  - clôture contredite par l'ouverture suivante ;
  - journée disputée, en conflit ou en attente ; version de parseur non prise en charge ;
  - chaîne rompue à D ; solde de D contredit après D (unité, report, journée suivante à revoir) ; écart inexpliqué dans un même fichier ;
  - chaîne non prouvée, sans réancrage après une journée disputée ;
  - rupture portée par une journée disputée, bloquante aux dates postérieures ; continuité appuyée sur une journée disputée, ou enjambant une journée livrée non retenue ; premier ancrage précédé d'une journée disputée, dans l'historique ou avant le premier relevé ; report arrière depuis une ouverture non continue ou d'une autre devise ;
  - clôture refusée quand elle ne repose que sur un fichier d'identité non corroborée ou dont une journée livrée est à revoir ;
  - solde non dérivable, relevé à revoir.
- **Comptes :** compte absent du registre, compte inactif, NSIA sans format, devise contradictoire, hors périmètre.
- **Valeurs :** solde historique, aucun zéro par défaut, dates et fraîcheur (date couverte égale à la dernière date disponible pour tous les comptes, date observée à part, couverture nulle en pilote), preuves de clôture et de continuité rendues avec leurs références, dates de valeur.
- **Qualification :** non qualifié, pilote, suspendu.
- **Inventaire :** non attesté, comptes hors inventaire.
- **Consolidation :** partielle, complète, bloquée.
- **Accès :** module fermé par défaut puis refermé (lecture et commandes refusées, administrateur compris) ; refus sans READ, sans BANK_READ, en anonyme, sans session ; date absente ou future refusée.
- **Administration :** autorité unique, idempotence, clé réutilisée, ajout seul.
- **Isolation :** aucune donnée de paiement ni legacy lue.

**Cas couverts par les tests TypeScript.** Garde d'environnement, refus avant tout appel, contrat de réponse (sources et dates comprises), libellés de tous les motifs émis par la migration, affichage des preuves avec leurs références, date observée jamais présentée comme couverte, cache lié à la session (utilisateur dans la clé, aucune lecture sans session, aucun cache conservé), une clé de commande par décision (double envoi rejoué à l'identique, même si une autre décision est envoyée entre-temps ou si le panneau est masqué), identité ATB.

## 5 bis. Revues indépendantes et traitement

Deux revues indépendantes ont été menées avant tout commit.

**Première revue**, sur la première version du lot. Verdict : `FAIL` ciblé, avec deux P1 : un résultat financier faux pouvait être présenté comme `AVAILABLE` ou `COMPLETE`. Les règles de clôture de P1-2a ont ensuite été remplacées après la seconde revue (N2).

| Constat | Traitement |
|---|---|
| **P1-1** Une contradiction postérieure à D était ignorée : un solde reporté ou une clôture à D restaient disponibles alors que l'ouverture suivante les contredisait. | `CHAIN_BROKEN_AFTER_DATE` (`BLOCKED`). Scénarios BDK (lendemain) et ORA (à travers deux journées sans mouvement) ; mutant m16. |
| **P1-2a** Une journée livrée par un export créé le jour même était réputée close. | `DAY_NOT_CLOSED` ; règle de clôture définitive : voir N2. Mutant m17. |
| **P1-2b** Les livraisons en conflit ou en attente d'une journée étaient ignorées. | `DAY_CONFLICT` (`BLOCKED`) et `DAY_CONTESTED`, sur une journée avec ou sans unité. Scénario ORA ; mutants m19 à m21. |
| **P2-1** Aucune fermeture côté serveur : une fois la migration appliquée, tout détenteur de BANK_READ pouvait lire. | Interrupteur serveur fermé par défaut, canal opérateur seul ; mutants m26 et m27. |
| **P2-2** Le cache de lecture pouvait servir les soldes d'une session à une autre, et une donnée ancienne restait affichée à côté d'une erreur. | Utilisateur dans la clé, `gcTime` 0, aucune lecture sans session, aucune donnée affichée sur erreur ; mutants t10 à t12. |
| **P2-3** Aucune vérification de la version de parseur des unités. | `PARSER_VERSION_UNSUPPORTED` ; mutant m22. |
| **P2-4** Les exports à revoir prouvaient l'absence de mouvement. | Motifs de revue de l'export et validation de chaque journée livrée exigés ; mutants m23 et m24. |
| P3 Nouvelle clé de commande à chaque envoi (double clic = deux attestations). | Une clé par décision, conservée jusqu'au succès ; mutant t13. |
| P3 Le dernier mouvement accepté comptait des doublons de journées provisoires ; un export sans mouvement accepté prouvait toute sa période. | Remplacé par la règle de N2 : seule une ligne ultérieure, datée au plus tard le jour du dépôt, clôt une journée ; sans ligne, rien n'est clos ; mutant m09. |
| P3 Scénario « ORA sans référence » irréaliste (le pipeline rend provisoire la dernière journée ORA). | Remplacé par un scénario BDK sans référence. |
| P3 Mutants non exécutés en CI ; course dépendante d'un délai fixe. | `-Mutants` en CI ; l'écrivain attend la lecture active et prouve qu'elle l'est encore après sa validation. |
| P3 Les nouveaux alias ATB dans le contenu pouvaient rendre ambigu le document d'une autre banque. | Alias limités au nom du fichier ; non-régression BDK et ORA testée. |
| P3 Aucun réancrage ; identités historiques non adoptées et doublons du registre non signalés ; coût proportionnel aux jours × exports. | Non traités dans ce lot : limites ci-dessous. |

**Seconde revue**, sur les corrections. Verdict : `FAIL`, avec trois nouveaux P1 reproduits sur PostgreSQL 17 : un solde contredit ou non prouvé était encore rendu `AVAILABLE`. Tous sont corrigés, avec scénarios et mutants. Chaque mutant concerné change le **statut** rendu, pas seulement le motif.

| Constat | Traitement |
|---|---|
| **N1 (P1)** Une journée suivante disputée, à revoir, en conflit, de version non prise en charge ou seulement provisoire désactivait le contrôle après D. | Le solde de D est comparé à toute ouverture connue de la première journée suivante qui en porte une, unité canonique de toute nature et versions non retenues comprises. Scénario ORA « suivante à revoir » ; mutant m16. |
| **N2 (P1)** La clôture d'une journée reposait sur l'instant de dépôt et sur la date de référence saisie, pas sur la production du fichier. | Clôture prouvée seulement par une ligne ultérieure du même fichier, datée au plus tard le jour du dépôt, ou par l'ouverture suivante égale. L'instant de dépôt et la date de référence ne prouvent plus rien. Scénarios BDK intrajournalier (dépôt du 03, référence saisie au 04, ligne datée du 05), BDK sans référence, ORA continuité et ORA fin de période ; mutants m09, m17, m18, m25, m29, m30. |
| **N3 (P1)** La chaîne se réancrait en silence en ignorant les unités antérieures non retenues. | Comparaison à la dernière clôture canonique connue, quelle que soit sa nature. Scénario ORA « réancrage » ; mutant m31. |
| **N4 (P2)** Une ouverture différente à travers des journées non prouvées d'un même fichier laissait le solde antérieur disponible. | `CHAIN_UNPROVEN_AFTER_DATE` (`NOT_COVERED`) quand aucune ligne n'est livrée entre les deux journées. Scénario ATB week-end ; mutant m28. |
| **N5 (P3)** m21 ne changeait que le motif. | Scénarios ajustés : m21 change désormais le statut. m18 et m22 aussi ; m09 et m14 grâce au scénario ORA fin de période. |
| **N6 (P3)** Une seule décision en attente était mémorisée, et dans l'état du composant. | Une clé par décision en attente, conservée au niveau du module ; mutants t13 et t15. |
| **N7 (P3)** Les documents partagés réécrivaient les lignes de statut du module chèques. | Lignes hors lot rétablies à l'identique de la base ; seules les entrées du lot sont ajoutées. |

## 5 ter. Contre-revue CTO sur `96be87d` et traitement

Verdict CTO : `FAIL` sur `96be87d` (CI verte, suite TypeScript 20/20, cas reproduit sur PostgreSQL 17). Corrections réalisées sous `GO_FIX_TREASURY_V1_LOT1_BANK_BALANCES`, même branche, même périmètre de fichiers. Les trois constats ont d'abord été reproduits à l'identique sur PostgreSQL 17 local avec le scénario fourni.

| Constat | Traitement |
|---|---|
| **P1** Une journée intermédiaire disputée désactivait le contrôle de sa propre ouverture ; la journée suivante redevenait disponible (clôture 1400, ouverture 9000, puis 9200 rendu `AVAILABLE` sans motif). | L'ouverture de toute unité canonique est contrôlée, quelle que soit la nature de sa journée. Une continuité appuyée sur une journée non résolue, ou qui en enjambe une, reste `CHAIN_UNPROVEN` jusqu'à sa résolution. Le report arrière n'est plus une référence de contrôle, et le contrôle de l'unité qui fournit un solde reporté compte (§ 3). Le scénario CTO exact rend désormais `BLOCKED` (`CHAIN_BROKEN`, `CHAIN_UNPROVEN`) au 22. Scénarios isolés : ORA rupture disputée, appui disputé, journée enjambée, report arrière. Mutants m32 à m36, qui changent tous le statut. |
| **P2** Le fichier ultérieur qui prouve la clôture n'apparaissait pas parmi les sources (ORA, 7 octobre). | Sources `CLOSURE_LATER_LINE` (chaque fichier probant), `CLOSURE_NEXT_OPENING`, `CHAIN_LINK` ; références de fichier et de journée ajoutées à `CANONICAL_UNIT` et `DECLARED_PERIOD`, avec leur rôle (clôture ou ouverture). Périodes déclarées limitées aux journées effectivement reportées. Au 7 octobre : unité du 07, fichier suivant (relivraison, ligne du 10), contrôle d'ouverture contre le 06. Mutants m37 et m38 ; côté interface, t17 et t18. |
| **P2** Un compte bloqué pour rupture affichait sa journée comme « couverte » (seul le solde dérivé était vérifié). | `bank_date_covered` = dernière date que la lecture rendrait `AVAILABLE` ; `bank_date_observed` rendue et affichée à part, jamais comme une couverture. Une même évaluation par journée sert D et la date couverte. Un test de propriété le vérifie sur tous les comptes de test et sur 42 dates. Mutants m39 à m41 ; côté interface, t16. |

**Troisième revue indépendante**, sur ces corrections avant commit. Verdict : `FAIL`, avec un P1 de la même famille que le constat CTO, exécuté sur PostgreSQL 17. Tous les points sont corrigés dans les mêmes fichiers.

| Constat | Traitement |
|---|---|
| **P1** Une journée non résolue **avant** le premier ancrage de la chaîne était ignorée : le premier relevé retenu restait un ancrage, et une livraison disputée antérieure au premier relevé sortait de l'historique (rendue `NO_STATEMENT`). | Premier ancrage non prouvé si une journée non résolue le précède. L'historique commence aussi à la première livraison non remplacée. Scénarios ORA « disputée en amont » et « disputée avant la série » ; mutants m46 et m47. |
| **P2** La clôture par ligne ultérieure était acceptée d'un fichier à revoir, d'identité non corroborée, de version de parseur non prise en charge ou non entièrement accepté. | Une seule définition du fichier digne de preuve, commune à la clôture et à l'absence de mouvement (§ 2). Scénario ORA identité : le 01 et le 04, clos seulement par ces fichiers, deviennent `DAY_NOT_CLOSED` ; mutant m42. |
| **P2** Un report arrière ne contrôlait pas la devise de l'unité qui le fournit. | Devise contrôlée jusqu'à cette unité. Scénario ORA devise étendu à une période déclarée antérieure ; mutant m45. |
| **P2** Les périodes déclarées qui portent une clôture confirmée par l'ouverture suivante n'étaient pas rendues. | Rendues ; scénario ORA « preuve de continuité » ; mutant m43. |
| P3 Une période qui ne prouve aucune journée pouvait être rendue ; la référence du contrôle d'ouverture était la veille, pas l'unité comparée ; motif `FORMAT_NOT_QUALIFIED` rendu avant le premier relevé d'un format qualifié. | Période sans preuve exclue (m44). Référence = unité dont la clôture a été comparée, et période qui prouve les journées intermédiaires rendue (m48, m49). Format du premier relevé retenu lu pour la qualification. |

**Relecture de la seconde passe** par le même relecteur. Verdict : `PASS_WITH_RESERVES`. Les six contre-exemples sont corrigés, réexécutés sur PostgreSQL 17. Aucun nouveau cas de solde rendu `AVAILABLE` sans preuve n'a été trouvé. Les réserves portent sur un excès de prudence :
- **Unité sans solde dérivable** : elle était comptée comme non résolue, alors qu'elle ne se résoudra jamais ; placée avant le premier ancrage, elle bloquait le compte définitivement. **Corrigé** : elle compte comme une journée non prouvée, comme avant la contre-revue. Scénario BIS « sans solde initial », mutant m50.
- **Clôture exigeant un fichier entièrement accepté** : une seule journée en attente dans un fichier lui retire la valeur de preuve de clôture pour ses autres journées. Choix prudent conservé, **soumis à l'arbitrage CTO** (voir § 6).
- **Livraisons en attente antérieures au premier relevé** : elles bloquent jusqu'à leur sortie de l'état vivant. Le chemin de résolution Daily v2 est à confirmer en exploitation (voir § 6).

**Attentes modifiées, et pourquoi.**
- Le scénario « ORA contesté » attendait `AVAILABLE` 40 au 04, lendemain d'une journée en conflit non résolue. C'est exactement le cas critiqué par le constat P1 : le 04 est désormais `NOT_COVERED` (`CHAIN_UNPROVEN`), et `CHAIN_UNPROVEN` s'ajoute aux 03 et 05.
- « ORA identité » attendait `AVAILABLE` 25 au 04 : sa clôture ne reposait que sur un fichier dont une journée livrée est à revoir. Il est désormais `DAY_NOT_CLOSED` (P2 de la troisième revue).
- Deux jeux d'essai sont ajustés sans changer leur objet :
  - « ORA suivante à revoir » livre sa journée à revoir par un second fichier, pour que la clôture de D reste prouvée par un fichier digne de preuve ;
  - « ORA devise » déclare sa période dès le 29/09.
- Décompte des comptes de test : 32 XOF attendus, 33 listés ; sous-total au 02 : 2 250,00 (six comptes).

**Arbitrage CTO sur la clôture des journées.** La règle prudente est acceptée pour ce lot fermé ; elle devra être évaluée sur les vrais fichiers avant toute utilisation quotidienne. L'horodatage d'édition bancaire reste une piste d'amélioration, sans être démontré comme l'unique preuve possible.

## 6. Limites et risques

- **Peu de comptes disponibles sans qualification réelle :** rien n'est qualifié par la migration ; tant que la phase de qualification sur fichiers réels (GO dédié) n'a pas posé de statut, tous les comptes restent `NON COUVERT` (`FORMAT_NOT_QUALIFIED`).
- **Journées sans mouvement des formats Excel :** jamais couvertes tant que la correction d'ingestion du § 2 n'est pas arbitrée et réalisée.
- **Couverture réduite par la règle de clôture (choix prudent, accepté par le CTO pour ce lot fermé) :**
  - la dernière journée livrée d'un fichier reste `DAY_NOT_CLOSED` jusqu'à l'une de deux preuves :
    - un fichier ultérieur la relivre avec une ligne plus récente ;
    - l'ouverture de l'unité suivante, à travers des journées prouvées sans mouvement, égale sa clôture ;
  - avec des exports qui ne se recouvrent pas et des week-ends non prouvés, D = veille peut donc rester non couvert ;
  - à évaluer sur les vrais fichiers avant toute utilisation quotidienne. Un horodatage d'édition fourni par la banque et enregistré à l'ingestion (correction du § 2) est une piste, pas nécessairement la seule.
- **Propagation jusqu'à résolution :** une journée non résolue (conflit, version en attente, provisoire jamais finalisée, à revoir, version de parseur non prise en charge) rend non couvertes toutes les dates postérieures du compte, jusqu'à sa résolution dans Daily v2. Cela vaut aussi pour une livraison en attente antérieure au premier relevé retenu. Ce lot ne propose aucune résolution (aucun réancrage opérateur). Le chemin de résolution Daily v2 des journées `staged` et `needs_review` est à confirmer en exploitation, car les statuts de staging n'ont pas d'état « rejeté ».
- **Clôture et fichier entièrement accepté (arbitrage proposé) :** un fichier ne prouve la clôture d'une journée que s'il est digne de preuve, donc entièrement accepté (§ 2). Une journée en attente ou en conflit dans un fichier lui retire cette valeur pour ses autres journées. C'est plus strict que nécessaire pour prouver l'heure de production du fichier. Un assouplissement possible : n'exiger, pour la clôture, que la validité, la version de parseur et l'absence de motif de revue. Il reste à arbitrer.
- **Opérations à date future :** une ligne datée après le jour du dépôt n'a aucune valeur de preuve. Une ligne datée entre la production et le dépôt du fichier en aurait une ; ce risque résiduel est faible et n'est pas détectable sans horodatage d'édition.
- **Ancrage de la chaîne :** c'est la première unité canonique de clôture connue. Une rupture ancienne bloque le compte, et une discontinuité non prouvée le laisse non couvert, jusqu'à correction des relevés (aucun réancrage opérateur dans ce lot).
- **Journée livrée le jour de l'export, puis complétée :** si la journée complète diffère, elle passe en conflit Daily v2 et reste bloquée jusqu'à son traitement ; la chaîne suivante reste non prouvée.
- **Unités historiques non adoptées** (sans `account_registry_id`) : ignorées ; le compte apparaît sans relevé. Les doublons d'identité dans le registre Daily v2 ne sont pas détectés par ce lot.
- **Coût de lecture :** proportionnel au nombre de jours de l'historique et d'exports par compte. L'évaluation par journée repose sur des fonctions de fenêtre et des jointures par journée. Elle reste à mesurer sur volume réel avant ouverture.
- **Fixtures :** données Daily v2 amorcées en mode réplica (gardes Daily v2 désactivées le temps de l'amorçage), cohérence vérifiée ensuite. Le cas d'un export à revoir dont les journées livrées sont valides n'est pas produit par le pipeline actuel ; il isole le contrôle au niveau de l'export.
- **Date cible par défaut (veille à Dakar) :** paramètre d'exploitation à confirmer avant ouverture ; calendrier ouvré non pris en compte.
- **Local Node 22, CI Node 20 :** compatibilité simulée sans `navigator` ; à confirmer par la CI.

## 7. Réserves du cadrage R3

- **Réserve 1** (dates et connaissance) : traitée dans ce lot (§ 1, § 3).
- **Réserve 2** (exception bloquante maintenant la position `BLOQUÉE`) : portée au Lot 2.
- **Réserve 3** (règlements douaniers partiels) : portée au Lot 3.

## 8. Non fait

Les actions suivantes relèvent de GO distincts :
- merge ;
- application staging ou production ;
- qualification sur fichiers réels ;
- ouverture du module côté serveur (`treasury_private.set_module_open`) ;
- attestation réelle de l'inventaire ;
- publication ;
- ouverture.

Aucun accès Supabase distant, aucune donnée bancaire réelle.
