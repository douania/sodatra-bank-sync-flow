# TREASURY V1 — LOT 1 OPÉRATIONNEL — rapport de lot

Lot `GO_IMPLEMENT_TREASURY_V1_LOT1_OPERATIONAL_FIX`. Base `main` `9256da4`, branche
`codex/treasury-v1-lot1-operational-fix` (worktree isolé). Conception : proposition
corrective R6 (`PASS_WITH_RESERVES`, document hors dépôt, SHA-256 `4039938…8eb4e`) et les
deux exigences du point 4 du GO. Aucun accès staging, production, Lovable ; aucune
migration appliquée hors des bases PostgreSQL 17 jetables de ce lot.

## 1. Ce qui est livré

| R6 | Livré |
|---|---|
| C1 | Noms ORABANK reconnus (`ORA`, `ORAB`, `ORABANK`, séparateurs `_ - .` et espaces) ; variantes existantes conservées (dont « banque de dakar » en sous-chaîne) ; nom désignant deux banques refusé (`UNKNOWN`) |
| C2, C3 | Attestation d'identité (Excel sans libellé de compte) et de devise d'un fichier resélectionné (empreinte recalculée localement), révocation ; motifs résolus par fichier |
| C4 | Statut `rejected` ; écartement des seules livraisons en attente ; une contradiction démontrée n'est jamais écartée ; R1 rejouée sous verrou |
| C4 bis | Versions financières complètes (empreinte, statut des agrégats, ouverture, clôture, totaux) ; comparaison à trois issues (accord, contradiction, données insuffisantes, avec cause et côté) ; correction des seuls soldes ; réfutation justifiée source par source, redépôts identiques couverts, nouvelle source qui rouvre ; pièce corrective archivée hors application (empreinte, références, date d'émission, valeurs saisies, attestation d'archivage, mention « attestation sur pièce archivée, contenu non vérifié automatiquement ») ; réfutation automatique par la livraison adoptée d'un remplacement si elle justifie chaque source |
| H1 | Dans les deux cœurs vivants du dépôt seulement : un doublon R1 de l'unité active dont la version financière diffère, dérivée et cohérente, conserve ses lignes, sauf si un doublon de même version en détient déjà une copie conforme ; jamais pour un doublon R1-provisional |
| C5 | Points de départ vérifiés (pose, révocation, chaîne ajout seul), applicables par période, suspendus par toute contradiction datée au plus tard à l'horizon de D ; panneau administrateur |
| C7 | Volume synthétique, 120 lectures chronométrées, plan détaillé, réécritures à sémantique identique éprouvées par un test différentiel contre une référence figée (§ 4) |
| C8 | Approbation groupée par fichier : liste admissible exacte transmise et recalculée sous verrou, fichier entier, tout ou rien |
| C9 | Clés de commande (rejeu après réponse perdue = résultat enregistré ; même clé, autre contenu = refus), verrou de tentative, ordre des verrous |
| C10 | Textes libres filtrés (numéro de compte, IBAN, adresse) |
| A6 | Journée sans unité retenue dont toutes les livraisons vivantes attendent : `DAY_PENDING_VALIDATION` ; série générée aussi pour un compte n'ayant que des livraisons vivantes |
| Réserve 4.1 | Cohérence financière exigée de toute unité, livraison propre, fichier probant et preuve de clôture, même seule pour sa journée : ouverture 100, crédit 10, clôture 120 ne donne jamais `AVAILABLE` |
| Réserve 4.2 | Une copie existante ne dispense de conserver les lignes que si elle est complète et conforme ; une première copie inutilisable ne bloque pas une correction valide |

Migrations : `20261103120000_daily_v2_operational_decisions.sql` (décisions Daily v2, H1) et
`20261103130000_treasury_v1_lot1_operational_fix.sql` (liste blanche des versions de
profil, points de départ, lecture réécrite). Aucune migration existante modifiée.
Enveloppes du dépôt, promotion unitaire, cœur de promotion et `supersede` inchangés
(vérifié mécaniquement : la redéfinition des deux cœurs ne diffère de leur source vivante
que par H1).

## 2. Tests

| Suite | Résultat |
|---|---|
| Trésorerie PG17 (`run_pg17_replay.ps1 -Mutants`) : upgrade sur base peuplée (surfaces 61 et 62), fresh, 46 opérationnel (dont scénarios 2 « 60 jours » et 3 « compte dormant », réserve 4.1 sur fichier probant), course de lecture, différentiel C7 | `TREASURY_V1_LOT1_PG17_REPLAY_PASS` (surfaces : 99 ajouts du lot sans changement existant, puis 156 ajouts et 5 définitions du lot modifiées ; différentiel 40 : 29 dates, 46 : 80 dates, historiques aléatoires : 46 dates, réponses identiques) |
| Mutants SQL trésorerie, sur la version optimisée et sur la référence figée | 74/74 tués sur la version optimisée, 74/74 sur la référence figée ; course en lecture volatile tuée |
| Daily v2 opérationnel PG17 (`run_operational_pg17.ps1`) : 34–41, parité interface/serveur (2 000 cas, six issues), deux courses à sessions réelles | `DAILY_V2_OPERATIONAL_DECISIONS_PG17_PASS` |
| LOCAL-E2E-0R (`run_e2e_0r.sh`) avec la nouvelle migration et les gardes 42/42b | `ALL_LOCAL_E2E_0R_PASS` |
| TypeScript : `test:treasury-balances` 28/28, mutants d'interface 26/26, `test:daily-v2-application` 108/108, `test:daily-v2-reporting` 70/70, `test:structured-csv-all` 134/134, `test:structured-csv-e2b` 49/49, `test:structured-excel` 21/21, `test:payables-cheques` 88/88, décisions Daily v2 et correction des soldes 15/15 | PASS |
| Typecheck application | 16 erreurs, identiques à la base (aucune nouvelle) ; projet Node 0 |
| ESLint | 178 erreurs, 11 avertissements, identiques à la base, aucun élément nouveau |
| Build | PASS ; artefact MCP inchangé |

## 3. Résultats sur les 12 relevés réels (base jetable, sans connexion distante)

Copies privées hors dépôt, empreintes vérifiées avant et après ; vrai pipeline ; fichiers
entiers. Aucun montant, opération ou numéro de compte n'est reproduit ici. « Avant » =
base `9256da4` ; « après » = ce lot, mêmes étapes (dépôt, promotion des journées valides,
redépôts identiques), aucune décision humaine. « Simulation » = SIMULATION LOCALE, dans une
transaction annulée : attestations d'identité (et de devise BRIDGE) sur les fichiers
resélectionnés, formats réputés qualifiés, approbation groupée par fichier ; aucune
validation métier.

| Fichier | Reconnaissance avant → après | Dépôt (ms) avant → après | Journées : attente après | Disponibles avant / après / simulation | Motif principal après (sans décision) |
|---|---|---|---|---|---|
| ATB juillet | oui → oui | 39 → 40 | 12 à revoir (identité) | 0/12 · 0/12 · **11/12** | `DAY_PENDING_VALIDATION` (avant : `NO_STATEMENT`) |
| BDK juillet | oui → oui | 34 → 35 | 0 (2 promues) | 0/2 · 0/2 · **1/2** | `FORMAT_NOT_QUALIFIED`, dernière journée `DAY_NOT_CLOSED` |
| BICIS juillet | oui → oui | 48 → 46 | 12 à revoir (identité) | 0/12 · 0/12 · **11/12** | `DAY_PENDING_VALIDATION` (avant : `NO_STATEMENT`) |
| BIS juillet | oui → oui | 49 → 49 | 19 à revoir (ruptures, agrégats, identité) | 0/19 · 0/19 · 0/19 | `DAY_PENDING_VALIDATION` ; fichier entier non résolu |
| BRIDGE juillet | oui → oui | 24 → 25 | 1 à revoir (identité, devise) | 0/1 · 0/1 · 0/1 | `DAY_PENDING_VALIDATION` ; simulation : journée non close |
| ORA juillet | oui → oui | 31 → 30 | 0 (3 promues) | 0/3 · 0/3 · **2/3** | `FORMAT_NOT_QUALIFIED`, dernière journée `DAY_NOT_CLOSED` |
| ATB octobre | oui → oui | 34 → 34 | 9 à revoir (identité) | 0/9 · 0/9 · 0/9 | `DAY_PENDING_VALIDATION` ; simulation : `CHAIN_UNPROVEN` |
| BDK octobre | oui → oui | 30 → 32 | 0 (3 promues) | 0/3 · 0/3 · 0/3 | `CHAIN_UNPROVEN` |
| BICIS octobre | oui → oui | 49 → 52 | 12 à revoir (identité) | 0/12 · 0/12 · 0/12 | `DAY_PENDING_VALIDATION` ; simulation : `CHAIN_UNPROVEN` |
| BIS octobre (backfill, 883 journées) | oui → oui | 898 → 1 042 | 883 à revoir (B2, ruptures, agrégats) | 0/41 · 0/41 · 0/41 | `DAY_PENDING_VALIDATION` ; B2 |
| BRIDGE octobre | oui → oui | 32 → 31 | 3 à revoir (identité, devise) | 0/3 · 0/3 · 0/3 | `DAY_PENDING_VALIDATION` ; simulation : `CHAIN_UNPROVEN` |
| ORA octobre (`ORAB`) | **non (refusé par le parseur) → oui** | non déposé → 42 | 0 (7 promues) | non lu · 0/7 · 0/7 | `CHAIN_UNPROVEN` |

« Disponibles » : journées livrées par le fichier rendues `AVAILABLE` par la lecture du Lot 1,
sur les journées lues dans les fenêtres de qualification (20 mai – 12 juillet, 18 septembre –
23 octobre). Simulation : attestations d'identité sur tous les fichiers Excel et de devise sur
BRIDGE (fichier resélectionné, empreinte recalculée sur la copie privée), formats réputés
qualifiés, approbation groupée de chaque fichier ; BIS et les fichiers CSV n'ont aucune journée
admissible (fichier entier non résolu, ou journées déjà promues).

Constats :

- ORABANK d'octobre (`ORAB`) est désormais reconnu et déposé sans renommage (refusé avant).
- Les journées en attente sont libellées `DAY_PENDING_VALIDATION` au lieu de `NO_STATEMENT`.
- En simulation, juillet devient disponible pour ATB, BICIS, BDK et ORA hors dernière
  journée de chaque fichier (non close, normal) ; octobre reste `CHAIN_UNPROVEN` : aucun
  relevé entre juillet et octobre. Seul un point de départ vérifié, lu par l'utilisateur sur
  pièce, couperait cette incertitude ; aucun n'a été inventé.
- BIS reste en attente : B2 (`BACKFILL_REVIEW_REQUIRED` jamais résolu) et règle du fichier
  entier ; le diagnostic des ruptures BIS reste hors de ce GO.
- Redépôts identiques : classés doublons, sans lignes conservées.
- Lecture sur ces données : médiane 77 ms (maximum 115 ms) contre 7 ms avant, la série du compte BIS (883 journées en attente sur dix ans) étant désormais générée (A6) ; 228 ms avec les décisions simulées.

## 4. Performance (C7)

Mesure de `e3eb8a2`. Mesure finale après les corrections de la contre-revue : § 8.5.

Volume synthétique : 10 comptes, 10 ans (2016-11-01 → 2026-10-31), 30 lignes par jour
(1 095 000 lignes canonical, 37 090 unités, 39 510 livraisons, 4 190 fichiers), avec
doublons, attentes, écartements, ventilations différentes, données insuffisantes,
réfutations (livraison fraîche et pièce), attestations et révocations, remplacements,
corrections des soldes, 30 points de départ dont révoqués et suspendus. Protocole :
10 lectures d'échauffement, puis 120 lectures aux dates `2016-11-01 + floor(i × 3651 / 119)`,
chronométrage serveur ; PostgreSQL 17 (`postgres:17-alpine`), processeur Intel Core i7-13700 (16 cœurs, 24 fils), 31,7 Go de mémoire ; Docker Desktop (24 processeurs, 15,5 Gio), conteneur sans limite ; `shared_buffers` 128 MB, `work_mem` 4 MB, `jit` actif sur le serveur et désactivé sur la fonction, `max_parallel_workers_per_gather` 2 ; base de 679 MB, cache chaud après l'échauffement ; mesure seule, sans autre charge.

| Mesure (120 lectures, cache chaud) | Valeur |
|---|---|
| p50 | 2 796 ms |
| p95 | 2 837 ms |
| maximum | 2 902 ms (D = 2017-03-03) |
| minimum | 2 732 ms |
| Même lecture avant les réécritures (une lecture, plan détaillé) | environ 154 s |
| Relevés réels, sans décision (90 lectures) | médiane 77 ms, maximum 115 ms |
| Relevés réels, simulation des décisions (90 lectures) | médiane 228 ms, maximum 329 ms |

Coût restant, réparti : fichiers probants et périodes déclarées (environ 0,5 s), bornes et série
par compte (environ 1,1 s), assemblage par compte (environ 0,4 s) ; aucun poste dominant.

Réécritures, toutes à sémantique identique :

- regards en avant par cumul décroissant (fenêtre linéaire au lieu de quadratique) ;
- indicateurs cumulés à l'horizon lus sur leur première date, sans auto-jointure ;
- prédécesseur d'une unité remplacée, agrégat par fichier probant, sources non justifiées
  d'une réfutation et sources d'une adoption : regroupés une fois au lieu d'un parcours
  par rangée ;
- variante de chaîne d'un point de départ par fenêtres au lieu d'une jointure sur rang ;
- paramètres de la fonction : `enable_mergejoin = off` (les CTE cachent leur taille à
  l'optimiseur, qui choisissait des fusions quadratiques) et `jit = off` (compilation plus
  coûteuse que l'exécution).

Garde : la version non optimisée est figée (`perf/reference_balances_snapshot.sql`, seules
les corrections de règle y sont reportées) ; `82_differential.sql` exige la même réponse JSON,
instant de lecture excepté, à chaque date des scénarios 40 et 46 et de douze historiques
aléatoires à graine fixe (`83_random_histories.sql`) ; tous les mutants sont joués sur les deux
versions.

## 5. Écarts par rapport à la R6, à arbitrer

1. Réfutation automatique évaluée à la lecture (aucune ligne écrite à l'adoption), y compris
   pour les remplacements antérieurs au lot ; une nouvelle source de l'ancienne version annule
   toute la couverture automatique (plus conservateur que la R6 ; aucune trace en journal).
2. La livraison fraîche exige un fichier digne de preuve.
3. H1 limitée aux doublons dérivés et cohérents.
4. Attentes de tests existants changées et justifiées (40 : A6 ; 52 : contradictions de
   versions) ; mutants existants reportés sur la nouvelle écriture.
5. Gardes des quatre nouvelles tables publiques testées par `42` / `42b` (après la migration)
   plutôt que par `17a` / `17b`.
6. Fonctions pures de version dans `dailyV2Types.ts` (le service importe le client Supabase,
   inutilisable sous Node) ; page `src/pages/TreasuryBalances.tsx` modifiée d'une ligne pour
   monter le panneau des points de départ.
7. Champ de compte `retained_unit_at_date` et empreinte de contenu dans la source
   `CANONICAL_UNIT` ajoutés au contrat (liaison d'un point de départ sans lecture de table).
8. Paramètres d'optimiseur au niveau de la fonction (§ 4).
9. Refus d'une attestation sur un fichier CSV non testé avec une charge CSV (refus vérifié par
   le format de la tentative).

## 6. Revue indépendante

`PASS_WITH_RESERVES`, aucun P1. Traité avant commit : F1 (réserve 4.1 sur fichier probant :
scénario et mutant m75), F2 (dernière journée livrée absente = source non justifiée), F4
(verrou de tentative à la pose d'un point), F5 (variante « banque de dakar » conservée), F6
(pièce réutilisée avec une autre référence d'archivage refusée), F8 (pose sur une journée non
close). F3 et F7 : documentés (§ 5 et § 4). Question ouverte : l'attestation de devise doit-elle
exiger, comme l'identité, un fichier sans libellé de compte ?

## 7. Limites et confirmations nécessaires

- Budget C7 : **dépassé** sur le volume C7 (p95 2,84 s pour 1 s visé à `e3eb8a2` ; mesure finale au § 8.5) ; respecté sur les relevés réels (médiane 77 ms, 228 ms en simulation). Conformément à la R6, aucune matérialisation automatique : rapport de mesure rendu, suite à arbitrer (pré-agrégation persistée, index additif en dernier recours, ou budget redéfini pour ce volume).
- Aucune attestation, qualification ni point de départ réel : à fournir par écrit (GO
  distinct), fichier par fichier, avec la lecture sur pièce pour tout point de départ.
- BIS : diagnostic des ruptures et éventuelle évolution de profil hors de ce GO.
- Application staging et production, ouverture du module et des verrous : GO distincts.

## 8. Corrections après la contre-revue CTO de `e3eb8a2` (`GO_FIX_TREASURY_V1_LOT1_OPERATIONAL_FIX`)

Verdict CTO sur `e3eb8a2` : `FAIL` (P1 concordance soldes/lignes, P2 exhaustivité des lectures,
P2 effectivité des réfutations dans l'interface). Corrections dans les deux migrations
candidates du lot seulement ; aucune migration historique, empreinte, idempotence ou
enveloppe existante modifiée ; aucune dépendance, aucun `.env`, aucun seuil CI, aucun
artefact MCP.

### 8.1 Constat → correction → preuve

| Constat CTO | Correction | Preuve |
|---|---|---|
| **P1** — charge synthétique issue du vrai pipeline, aux agrégats décalés de 1 000 000 XOF, lue `AVAILABLE` à 1 000 110 XOF (l'équation ouverture + crédits − débits = clôture ne suffisait pas) ; ce faux solde n'a pas été observé sur les relevés réels | Règle unique `daily_stmt_line_facts_conform` : nombre de lignes, totaux et chaîne des soldes courants de l'ouverture à la clôture (ordre du fichier ou son inverse exact) ; appliquée aux lignes staging (`daily_stmt_staging_lines_conform`) et canonical (`daily_stmt_canonical_lines_conform`). Lecture « Soldes à date » : une passe, une fenêtre (`canon_agg`, `stg_agg`) ; unité non conforme → `UNIT_FINANCIAL_FACTS_INCOHERENT`, jamais de solde ; livraison non conforme → non propre, son fichier ne prouve ni clôture ni réfutation ; doublon sans lignes propre seulement si une version retenue de mêmes faits a des lignes conformes ; constat `LINES_NOT_CONFORMING`. Approbation groupée : journées aux lignes non conformes inadmissibles. Réfutation : refusée si la version retenue a des lignes non conformes, ou si le fichier de la livraison fraîche porte une journée aux lignes non conformes | `44_lines_conformity.sql` (contre-exemple CTO sur une charge synthétique issue du vrai pipeline : plus de solde ; variantes totaux à net égal et soldes courants ; promotion unitaire historique puis lecture ; réfutation refusée ; correction des seuls soldes ; deux mordants : sans la condition, la charge serait admissible et le solde décalé redeviendrait `AVAILABLE` à 1 000 110 XOF) ; `46_operational.sql` scénarios O, P et N bis (unité, fichier, doublon sans lignes, profil décroissant, nombre, totaux, chaîne interne, faits de livraison incohérents) ; mutants m76 (unité), m77 (fichier), m78 (protection entière) tués sur les deux versions ; H1 et « première copie inutilisable puis copie valide » : `40_duplicate_financial_version_lines.sql` et scénario L inchangés, verts |
| **P2** — lectures non paginées (livraisons, fichiers, journées, unités retenues, attestations, réfutations, sources) | Cœur pur `dailyV2DecisionReadCore.ts` : pages de 500 jusqu'au total exact annoncé, décalage égal aux lignes reçues, tri stable terminé par l'identifiant (ou la clé primaire), identifiants découpés en lots de 100, plafond de sûreté ; erreur, total absent ou modifié, page vide, ligne répétée, fichier associé manquant → `DAILY_V2_READ_INCOMPLETE`. Interfaces : lecture en échec signalée, décisions dépendantes suspendues (versions non construites, attestations et approbation groupée retirées, preuve fraîche non proposée) | `dailyV2DecisionReads.synthetic.test.ts` (faux PostgREST : 1 234 réfutations dont la révocation en troisième page, 1 101 livraisons dont une nouvelle source en dernière réponse avec un plafond serveur de 300 lignes, 250 fichiers en trois lots, sept cas de lecture incomplète) ; contrat des interfaces dans `dailyV2OperationalDecisions.synthetic.test.ts` |
| **P2** — ancienne réfutation affichée acquise après changement de l'unité retenue | Effectivité calculée par le serveur seul : constat `REFUTATION_STATUS` de la lecture (`EFFECTIVE`, `PARTIAL` avec sources non couvertes, `SUSPENDED` avec causes `RETAINED_VERSION_CHANGED`, `RETAINED_VERSION_UNUSABLE`, `PROOF_NO_LONGER_VALID`, `SOURCE_NOT_JUSTIFIED`, `NEW_SOURCE_UNCOVERED`) et lecture `daily_v2_refutation_status_v1` (administrateur ; `verifiable = false` avec motif si le module est fermé, la journée inconnue ou le compte hors inventaire). Interface : décision enregistrée, puis effectivité actuelle telle que le serveur la rend, avec l'heure de la lecture, ou « non vérifiable » (lecture en cours, en échec ou impossible) ; plus aucun calcul de couverture dans le navigateur ; sources non couvertes comptées hors couverture par l'adoption. Plan d'approbation groupée lu de même sur le serveur (`daily_v2_attempt_batch_plan_v1`) | `46_operational.sql` : effective, partielle (nouvelle source F2), suspendue (justificatif invalidé ; version retenue changée par une correction des seuls soldes = cas CTO), lecture serveur avant/après, refus sans rôle admin, journée inconnue, module fermé ; mutants m79 (partielle ignorée) et m80 (changement de retenue ignoré) ; TypeScript : cas CTO (décision enregistrée visible, effectivité « Suspendue », jamais « effective » sans lecture serveur), réponses hors contrat refusées |

### 8.2 Tests rejoués

| Suite | Résultat |
|---|---|
| Trésorerie PG17 `run_pg17_replay.ps1 -Mutants` (upgrade avec surfaces 61/62, fresh, course de lecture, différentiel) | `TREASURY_V1_LOT1_PG17_REPLAY_PASS` ; surface : 162 ajouts, 5 définitions du lot modifiées ; différentiel identique (40 : 29 dates, 46 : 80 dates, historiques aléatoires : 46 dates) |
| Mutants SQL trésorerie | 80/80 sur la version optimisée, 80/80 sur la référence figée |
| Daily v2 opérationnel PG17 (dont 44) | `DAILY_V2_OPERATIONAL_DECISIONS_PG17_PASS` |
| LOCAL-E2E-0R | `ALL_LOCAL_E2E_0R_PASS` |
| TypeScript | voir § 8.4 |

### 8.3 Relevés réels (rejeu local, base jetable)

Les 12 fichiers `RELEVE_SOURCE` du manifeste, copiés entiers et sans renommage dans un
dossier privé ; taille et SHA-256 identiques au manifeste avant la copie, sur la copie, et
après les essais. Mêmes étapes que pour `e3eb8a2` (dépôt, promotion des journées valides,
redépôts identiques, lecture sans décision, puis SIMULATION LOCALE annulée : attestations,
formats réputés qualifiés, approbation groupée).

| Fichier | Lignes stockées conformes | Écart avec `e3eb8a2` |
|---|---|---|
| ATB juillet / octobre | 12/12 · 9/9 | aucun (hors durées) |
| BDK juillet / octobre | 2/2 · 3/3 (unités retenues conformes) | aucun |
| BICIS juillet / octobre | 12/12 · 12/12 | aucun |
| BIS juillet / octobre (backfill) | 19/19 · 883/883 | aucun |
| BRIDGE juillet / octobre | 1/1 · 3/3 | aucun |
| ORA juillet / octobre | 3/3 · 7/7 (unités retenues conformes) | aucun |

Lecture sans décision, simulation et rapport par fichier : lignes identiques à `e3eb8a2`, aux
durées près. Seules nouveautés : le plan serveur nomme le motif d'inadmissibilité
(`STATUS_NOT_STAGED` pour les CSV déjà promus, `FILE_UNRESOLVED` pour BIS) ; aucune journée
réelle n'est écartée pour lignes non conformes. Redépôts identiques : doublons sans lignes,
toujours justifiés par leur version retenue conforme. Lecture : médiane 80 ms (maximum 109 ms)
sans décision, contre 77 ms pour `e3eb8a2` ; médiane 243 ms (maximum 266 ms) en simulation,
contre 228 ms. Verrous Daily v2 et module refermés, refus vérifiés, base détruite, copies,
charges utiles et manifestes privés supprimés ; seules les lignes agrégées (sans montant) sont
conservées hors dépôt comme preuves.

### 8.4 TypeScript, typecheck, ESLint, build

| Contrôle | Résultat |
|---|---|
| `test:treasury-balances` | 28/28 |
| Mutants d'interface trésorerie (`treasuryMutation.proof.ts`) | 26/26 |
| `test:daily-v2-application` | 108/108 |
| `test:daily-v2-reporting` | 70/70 |
| Décisions Daily v2, correction des soldes, lectures paginées | 22/22 |
| `test:structured-csv-all` · `-e2b` · `test:structured-excel` · `test:payables-cheques` | 134/134 · 49/49 · 21/21 · 88/88 |
| Typecheck application | 16 erreurs, identiques à la base ; projet Node 0 |
| ESLint | 178 erreurs, 11 avertissements, identiques à la base, aucun élément nouveau |
| Build | PASS ; artefact MCP inchangé |

### 8.5 Mesure C7 finale

Même protocole et même machine qu'au § 4 (120 lectures après échauffement, cache chaud,
mesure seule). Le volume porte désormais aussi les lignes staging de chaque livraison
(1 095 600 lignes de plus, base de 1 156 MB), comme le pipeline les stocke : sans elles, le
contrôle P1 ne serait pas mesuré. Statuts finaux inchangés (`NOT_COVERED` = 10 au 31 octobre).

| Mesure (120 lectures) | `e3eb8a2` | Après corrections |
|---|---|---|
| p50 | 2 796 ms | 4 725 ms |
| p95 | 2 837 ms | 4 839 ms |
| maximum | 2 902 ms | 4 873 ms (D = 2025-04-26) |

**Budget de 1 s dépassé**, davantage qu'avant : le contrôle des lignes ajoute environ 1,8 s sur
ce volume (10 comptes × 10 ans × 30 lignes par jour). Sur la même base, la lecture de
`e3eb8a2` mesure 2,84 s et rend des réponses identiques. Décomposition du surcoût : tri,
fenêtre et agrégat des 1,1 million de lignes canonical (environ 1,2 s, tri débordant sur
disque avec `work_mem` à 4 MB), lecture des lignes staging des livraisons jamais promues
(environ 0,1 s), appels de la règle par unité (environ 0,25 s). Essais écartés, faute de gain
suffisant : règle écrite en ligne (−0,24 s, au prix d'une seconde écriture de la règle) et
`work_mem` porté à 64 MB sur la fonction (−0,18 s). Aucune matérialisation, aucun index, aucune
réduction de l'historique. Options à arbitrer : indicateur de conformité calculé une fois à la
promotion (les lignes et faits d'une unité sont immuables), ou index additif
`(canonical_unit_id, source_line_index, daily_occurrence_ordinal, id)` qui supprimerait le tri.
Relevés réels : médiane 80 ms sans décision.

### 8.6 Revue indépendante des corrections

Relecture indépendante en lecture seule. P1 tient pour les soldes et les preuves (chaque chemin
vérifié échoue fermé), version optimisée conforme à la référence et aux fonctions scalaires,
privilèges corrects. Constats traités :

| Constat | Traitement |
|---|---|
| F1 (moyen) — une relecture en échec ou en cours gardait l'ancien statut « effective » | Relecture en cours ou en échec : effectivité « non vérifiable », alerte, heure de la lecture serveur affichée ; plan d'approbation et bornes d'une livraison fraîche jamais repris d'une lecture périmée ; tests de contrat |
| F2 — un doublon sans lignes par construction était dit « lignes non conformes » | Le constat ne compte que les livraisons qui portent des lignes stockées ; la propreté reste stricte (sans effet sur les soldes) ; scénario O |
| F3 — l'état `PARTIAL` ignorait la couverture par l'adoption | Sources non couvertes = livraisons comparées non couvertes, hors sources de la réfutation ; scénario « réfutation explicite d'une version adoptée », mutant m81 |
| F4 — une livraison fraîche était acceptée alors que son fichier ne pouvait pas faire preuve | Refus si une journée du fichier porte des lignes stockées non conformes (staging ou unité retenue) ; deux refus dans `46` |
| F5 — la lecture des statuts filtrait par compte et date | Filtre sur les réfutations de la journée demandée |

Doutes rapportés, non modifiés :

- Une unité retenue non conforme reste créable par la promotion unitaire et le remplacement
  historiques (enveloppes inchangées, hors périmètre) ; elle n'établit alors aucun solde. Si
  seuls ses soldes courants stockés étaient faux (faits identiques), un redépôt correct serait
  un doublon sans lignes et la journée resterait non réparable sans point de départ vérifié.
  Le pipeline réel dérive les faits des mêmes soldes courants, ce qui rend ce cas improbable ;
  un recensement en lecture seule de `daily_stmt_canonical_lines_conform` sur staging, puis
  production, avant toute application est recommandé (GO distinct).
- Une livraison non conforme continue d'alimenter les ouvertures connues et les comparaisons :
  elle peut bloquer une journée (`CONFLICT`, chaîne rompue), jamais en établir une. Choix
  conservateur, à confirmer.
- `daily_v2_refutation_status_v1` est réservée au rôle admin Daily v2 ; elle révèle l'état du
  module et l'appartenance à l'inventaire, aucun solde ; chaque appel lit tous les comptes
  (coût de la lecture C7). Module fermé : réfutations « non vérifiables », comme prévu.
- Égalités de `(source_line_index, daily_occurrence_ordinal)` départagées par l'identifiant
  de ligne, différent entre copie staging et copie canonical : seule une charge fabriquée peut
  les produire (indices uniques par fichier dans le pipeline).
- Étape CI ciblée du lot complétée d'un fichier de test, sans changement de seuil.
- Hors de ce diff : un redépôt R1 provisoire identique reste comparé après clôture de la
  journée (comportement antérieur).

### 8.7 Limites

- Budget C7 dépassé (§ 8.5) : à arbitrer.
- Aucune attestation, qualification ni point de départ réel n'a été posé ; les simulations
  sont annulées et étiquetées SIMULATION LOCALE.
- Diagnostic des ruptures BIS hors périmètre.
- Merge, application staging ou production, ouverture du module ou des verrous : GO
  distincts.

## 9. Correction après la contre-revue CTO de `972baaf` (même GO reconduit)

Verdict CTO sur `972baaf` : `FAIL` ciblé. Le P1 du faux solde est levé ; lectures paginées et
effectivité lue sur le serveur acceptées ; un P2 d'interface reste à corriger. Correction
limitée à l'interface : aucune migration, aucun SQL, aucun test PostgreSQL modifié (suites SQL
et relevés réels non rejoués, conformément au GO) ; aucune dépendance, aucun `.env`, aucun
seuil CI, aucun artefact MCP.

### 9.1 Constat → correction → preuve

| Constat | Correction | Preuve |
|---|---|---|
| **P2 (CTO)** — un formulaire déjà ouvert échappait à la suspension : après une relecture en erreur `DAILY_V2_READ_INCOMPLETE`, « Confirmer » restait actif et envoyait la décision malgré l'annonce « Les décisions de la journée sont suspendues » | Lectures nécessaires par décision : journée (livraisons, unité retenue, réfutations) pour l'écartement, la correction des seuls soldes, la réfutation et sa révocation ; journée et attestations pour l'attestation et sa révocation. Lecture en échec, incomplète ou en cours, ou versions non calculables → formulaire suspendu : message dans le formulaire, bouton d'envoi inactif, point d'envoi unique (`submit`) qui refuse tout envoi suspendu ; sous-formulaires de réfutation et d'attestation inactifs et gardés jusque dans leur gestionnaire. La saisie est conservée ; le formulaire redevient utilisable sur une lecture complète. Le statut des réfutations (affichage seul) n'en fait pas partie | `DailyV2DecisionDialogsSuspension.synthetic.test.tsx` : séquence CTO exacte (ouverture d'« Écarter », relecture `DAILY_V2_READ_INCOMPLETE`, bouton inactif, gestionnaire sans envoi, puis envoi unique après une lecture complète) ; sept formulaires (écartement, correction des seuls soldes, révocation de réfutation, réfutation par livraison fraîche, par pièce corrective, attestation d'identité, révocation d'attestation) × chaque lecture nécessaire × {échec, relecture en cours} ; versions devenues non calculables ; le harnais CTO d'origine échoue désormais sur son assertion « bouton reste actif après erreur » |
| **P2 (relecture indépendante, préexistant)** — un formulaire survivait au changement de journée (dialogue resté monté, passage à l'approbation groupée sans fermeture) et s'envoyait sur les lectures d'une autre journée ; la révocation n'envoie qu'un identifiant, que le serveur accepte | Le formulaire porte la journée où il a été ouvert : sur une autre journée, il n'est ni affiché ni envoyable ; passage à l'approbation groupée = formulaire, raison et message remis à zéro | Journée changée avec approbation groupée puis retour à la première journée ; journée changée sans fermeture |
| **P3 (relecture)** — sujet figé à l'ouverture : après une relecture complète, le formulaire redevenait actif même si son sujet avait changé | Sujet revérifié sur chaque lecture complète, selon la condition d'affichage du bouton qui l'a ouvert : livraison retrouvée avec le même statut (encore en attente, ou encore candidate à la correction des soldes), version retrouvée par sa clé et réfutable, réfutation active, même fichier sans attestation de même type, attestation active ; la réfutation et la correction des soldes visent la version retenue de l'ouverture (`expectedRetainedVersionKey` transmise telle quelle). Sinon : suspension et alerte « le sujet de cette décision a changé ». La réfutation lit sources et faits de la version dans la lecture actuelle | Dix cas de sujet changé (livraison écartée ou passée à `needs_review`, soldes déjà retenus, retenue changée pour la correction et la réfutation, réfutation révoquée, livraisons remplacées, version devenue retenue, identité attestée, attestation révoquée) ; autre fichier de la même journée ; sources à jour (nouvelle source justifiée transmise, non justifiée bloquante) |
| **P3 (relecture)** — périmètre et annonces | Boutons de fichier masqués si les versions ne sont pas calculables (« aucune décision possible ») ; message du formulaire annoncé poliment pour une lecture en échec (déjà annoncée par l'alerte de la journée) ou en cours, en alerte pour un sujet changé ; borne de livraison indisponible et lecture des journées du fichier signalées. Approbation groupée : bouton et gestionnaire partagent la même condition | Cas « versions non calculables » ; gestionnaire de l'approbation groupée sans raison |
| **P3 (CTO)** — § 8.1 : « charge réelle » | « Charge synthétique issue du vrai pipeline » et mention que le faux solde n'a pas été observé sur les relevés réels ; même alignement dans le README des tests Daily v2 (trois lignes de ce lot) | § 8.1, `supabase/tests/daily_statement_units_v2/README.md` |

Le test compte 27 cas. Sur le code de `972baaf`, 24 échouent : le défaut est reproduit. Trois
passent : la limitation du périmètre (statut des réfutations et attestations sans effet sur
l'écartement), l'approbation groupée sur plan relu (déjà protégée) et la valeur transmise de la
retenue. Ce sont des cas de non-régression. Quatorze mutants ciblés (garde d'envoi, relecture en cours, journée du
formulaire, remise à zéro, revérification du sujet, même statut, même fichier, retenue de la
réfutation, retenue de la correction, sources à jour, bouton inactif, gestionnaire de
l'approbation groupée, périmètre des attestations, boutons de fichier) : chacun tué par au
moins un cas. Le test exécute les deux dialogues et leurs sous-composants : l'état local est
conservé, les gestionnaires sont ceux du dernier rendu. Lectures, mutation, services réseau et
primitives d'interface sont remplacés au chargement par un hook de résolution Node, sans
dépendance ajoutée. Le comportement simulé de TanStack Query v5 est celui que documente la
bibliothèque : données conservées sur une relecture en échec.

### 9.2 Contrôles

| Contrôle | Résultat |
|---|---|
| Test d'interaction (nouveau) | 27/27 ; 27/27 aussi sans `navigator` (simulation de la CI Node 20) |
| Étape CI ciblée du lot (quatre fichiers) | 49/49 |
| `test:daily-v2-application` · `test:daily-v2-reporting` | 108/108 · 70/70 |
| Daily v2 tableau de bord · session et accès | 34/34 · 11/11 |
| `test:treasury-balances` | 28/28 |
| Typecheck | 16 erreurs, identiques à la base ; projet Node 0 |
| ESLint | 178 erreurs, 11 avertissements, identiques à la base ; fichiers modifiés sans constat |
| Build | PASS ; artefact MCP inchangé |
| Suites PostgreSQL, relevés réels, C7 | non rejoués : aucun code serveur modifié |

### 9.3 Relecture indépendante

Deux relectures en lecture seule. Première : `FAIL` sur le changement de journée (P2
préexistant) et cinq réserves P3, traitées ci-dessus. Seconde, sur la correction :
`PASS_WITH_RESERVES`, aucun P1 ni P2, aucun chemin d'envoi restant, aucun faux positif sur
les cas légitimes rejoués (journée sans retenue, attestation de devise, deux livraisons d'une
même version). Ses deux trous de test (même statut, même fichier) et sa réserve sur la
retenue visée sont traités. Réserves maintenues :

- La signature de commande d'une réfutation ne contient ni les sources attendues ni la
  retenue. Après une réponse perdue puis une relecture qui les change, la même clé serait
  réutilisée avec une autre requête, et le serveur répondrait `DAILY_STMT_COMMAND_KEY_REUSED`.
  L'échec est sûr, mais déroutant. Hors autorisation : la dérivation des clés de commande
  relève de l'idempotence.
- Un formulaire laissé ouvert réapparaît si l'on revient à la même journée sans fermer le
  dialogue. Il est alors revérifié sur les lectures de cette journée.
- Le mode hors ligne (`fetchStatus` en pause) n'est pas traité comme une relecture en cours ;
  le serveur revérifie toute décision sous verrou.

### 9.4 Réserves et limites

- **C7 inchangé** : p95 4,84 s pour un objectif de 1 s. La réserve vaut pour une éventuelle
  fusion du module fermé ; la qualification d'usage quotidien à ce volume n'est pas acquise.
  Les contrôles de conformité sont conservés.
- **Étape CI ciblée du lot** : complétée du nouveau fichier de test, sans changement de seuil.
- **Merge, application staging ou production, ouverture du module** : GO distincts.
