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

- Budget C7 : **dépassé** sur le volume C7 (p95 2,84 s pour 1 s visé) ; respecté sur les relevés réels (médiane 77 ms, 228 ms en simulation). Conformément à la R6, aucune matérialisation automatique : rapport de mesure rendu, suite à arbitrer (pré-agrégation persistée, index additif en dernier recours, ou budget redéfini pour ce volume).
- Aucune attestation, qualification ni point de départ réel : à fournir par écrit (GO
  distinct), fichier par fichier, avec la lecture sur pièce pour tout point de départ.
- BIS : diagnostic des ruptures et éventuelle évolution de profil hors de ce GO.
- Application staging et production, ouverture du module et des verrous : GO distincts.
