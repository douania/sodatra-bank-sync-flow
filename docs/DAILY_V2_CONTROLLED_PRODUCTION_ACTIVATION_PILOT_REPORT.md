# Daily v2 — Pilote d'activation contrôlée en production

## Statut

`CLOSED_WITH_RESERVE — ORA_FIRST_IMPORT_AND_REPORTING_VALIDATED — PILOT_RELOCKED`
— observations du 2026-08-30 ; dernier contrôle à `2026-08-30T19:05:00.917Z`.

Le premier pilote réel ORABANK est terminé : un dépôt, trois journées et quatre
lignes ont été contrôlés, promus puis retrouvés dans le reporting Daily v2.
La migration de scopes serveur et le runtime ont été appliqués/publiés sous
leurs GO distincts. Le verrou maître et les scopes `daily`, `admin`, `backfill`
sont tous revenus à `false`. Les données validées sont conservées ; le pilote
n'est ni ouvert en permanence ni étendu aux autres banques.

Cette clôture documentaire consolide des preuves déjà recueillies. Elle ne
réexécute aucune opération live et ne vaut pas qualification générale de
l'application, de `/upload`, de Collection Report ou du dashboard principal.
Les interruptions et limites de preuve restent explicites ci-dessous.

## Périmètre autorisable et périmètre réellement qualifié

Le contrat du pilote est volontairement plus étroit que le parcours complet
disponible en staging :

- relevés structurés quotidiens uniquement, dans la limite existante de 45 jours ;
- CSV BDK/ORA et Excel ONLINE ATB/BICIS/BIS/BRIDGE déjà caractérisés ;
- compte actif déjà présent dans le registre Daily v2 ;
- préparation et dépôt : rôles `admin` ou `manager` ;
- promotion et supersede : rôle `admin` ;
- consultation canonical/audit/reporting : règles de rôles existantes ;
- administration du registre et backfill BIS destinés à rester hors du pilote
  production.

La campagne réelle clôturée ici porte uniquement sur un export ORABANK et un
compte existant. L'éligibilité technique des autres profils n'est pas une preuve
de dépôt, de promotion ou de qualification métier en production de ces profils.

La politique statique de cible rend la production éligible à `read`, `deposit`
et `promote`, jamais à `admin`. L'option backfill et les commandes de gestion du
registre/grant ne sont pas rendues dans l'interface. La migration appliquée
porte la même frontière côté serveur :

- `daily` : dépôt `requested_mode=daily`, promotion et supersede ;
- `admin` : provisionnement, désactivation et adoption historique ;
- `backfill` : émission/révocation de grant et dépôt
  `requested_mode=backfill`.

Les huit implémentations existantes sont des cœurs sans `EXECUTE` pour
`PUBLIC`, `anon`, `authenticated` et `service_role`. Seuls leurs wrappers
publics restent exécutables par `authenticated` et vérifient leur scope avant
toute délégation métier.

## Barrières cumulatives

Une opération mutative exige simultanément :

1. l'identité exacte du projet Supabase production canonique ;
2. une capacité statique connue et explicitement autorisée ;
3. une session Auth valide ;
4. le rôle métier attendu ;
5. une réponse explicite `true` du kill switch PostgreSQL privé ;
6. une réponse explicite `true` du scope serveur de la RPC ;
7. l'autorisation `EXECUTE` du wrapper et les contrôles de rôle métier ;
8. les invariants atomiques, d'idempotence, de concurrence et d'audit Daily v2.

Une cible inconnue, une contradiction URL/project ref, une capacité inconnue,
une erreur de lecture du verrou, une réponse absente/invalide ou toute valeur
autre que `true` ferme toutes les mutations. Le verrou serveur reste
l'autorité finale : la politique frontend ne constitue jamais une barrière de
sécurité suffisante.

## Comportement d'interface

- verrou fermé : la production affiche `Pilote production verrouillé`, autorise
  le parsing local et interdit tout dépôt/promotion ;
- verrou indisponible : même comportement fail-closed ;
- verrou ouvert : l'interface affiche `Pilote production actif`, puis combine
  chaque action avec le rôle et la capacité applicables ;
- la cible exacte et l'état du verrou restent visibles à l'opérateur ;
- les commandes d'administration et le backfill BIS restent absents de
  l'interface en production ; avec la migration appliquée, les
  appels directs correspondants restent refusés tant que leurs scopes privés
  sont `false`.

## Historique de contre-review de l'implémentation (avant PR #137)

Verdict sur le SHA `b997dfdebd9b58e061b43dff1e029f93b9fbd339` : **FAIL —
MERGE_READY: NO**.

- P0 : 0 ;
- P1 : 1 — l'ouverture du verrou global autorise encore les chemins RPC
  d'administration/backfill à un administrateur authentifié ;
- P2 lors de la review : 3 — preuves UI majoritairement statiques, absence de
  test serveur négatif verrou ouvert/backfill, commentaire de test obsolète et
  date documentaire incorrecte. Le commentaire et la date sont corrigés dans le
  présent suivi historique ; la preuve serveur restait liée au P1 bloquant ;
- décision CTO : aucun merge ni enchaînement d'environnement tant qu'un contrôle
  serveur borné ne sépare pas le journalier de l'administration/backfill et que
  les tests directs correspondants ne sont pas verts.

## Réconciliation locale du finding P1

Le correctif serveur est matérialisé par
`20260829120000_daily_v2_controlled_production_pilot_server_scope.sql`.
La chaîne PostgreSQL 0R complète a été rejouée dans un conteneur jetable :

- `master=true`, `daily=true`, `admin=false`, `backfill=false` ;
- six appels directs admin/backfill refusés avant toute logique métier ;
- trois chemins daily autorisés à atteindre leurs invariants métier ;
- zéro écriture partielle après les refus ;
- huit cœurs mutatifs inaccessibles aux rôles API et `PUBLIC` ;
- état antérieur préservé et initialisation des scopes auditée ;
- charges BIS 857 unités/4 798 lignes et plafond 4 000/4 000 verts ;
- concurrences, retour du kill switch à `false` et reporting verts ;
- conteneur et fichiers temporaires détruits.

À ce stade historique, le P1 était corrigé **localement**, sous réserve de
contre-review du SHA final ; cette preuve seule ne valait pas validation staging.

La contre-review indépendante du SHA
`d0e3abf9176018b8b844e61f67bf6936c569a9f7` a ensuite rendu
**PASS_WITH_RESERVES — MERGE_READY: YES**, avec `0 P0`, `0 P1` et deux P2 non
bloquants : un commentaire runtime devenu obsolète et une preuve UI encore
principalement textuelle. Les deux réserves sont réconciliées localement :

- le commentaire nomme désormais staging et pilote production autorisé ;
- `DailyV2AdminControlsGate` constitue une frontière de rendu explicite ;
- un test React rendu couvre production × verrou `true`/`false`/absent/erreur ×
  rôles `admin`/`manager`/`auditor`/`user`, vérifie l'absence de markup
  admin/backfill et prouve que le sous-arbre adossé aux services n'est jamais
  évalué ;
- un contrôle positif staging/admin/verrou `true` empêche une preuve vacuement
  verte.

La revalidation indépendante du SHA
`e7634696d8a34a0b208d9f5d858bd921ed734ac1` a confirmé le comportement et
rendu **PASS — MERGE_READY: YES**, avec un dernier P2 limité à la précision du
compteur de test. Le delta ciblé
`e7634696d8a34a0b208d9f5d858bd921ed734ac1..39af326897125ef38b6d70ff6c61af16ad653676`
sépare désormais l'invocation du render prop du rendu de l'enfant. Sa dernière
revalidation a rendu **PASS — MERGE_READY: YES**, avec `0 P0`, `0 P1` et
`0 P2`. Aucun environnement n'avait été touché par ces travaux locaux.
La [PR #137](https://github.com/douania/sodatra-bank-sync-flow/pull/137) a
ensuite été fusionnée le 2026-08-30 : tête
`70b40c6c4c66a42cfc4379f860e18401b3ffd540`, commit de merge/source production
`85150a6a466cf87e12b28d945e0849458c5ddf2c`.

## Identités et versions constatées

| Cible | Lovable | Supabase | URL publiée |
|---|---|---|---|
| Staging | `8c508b94-d03f-4165-ab2b-7a3cd52d2d2b` | `gbbsqcscryygqlmqncyv` | `https://cash-sync-wiz.lovable.app` |
| Production | `e52d9fce-f1b4-46f8-900c-c559a6eb2115` | `leakcdbbawzysfqyqsnr` | `https://sodatra-bank-sync-flow.lovable.app` |

- Migration : `20260829120000_daily_v2_controlled_production_pilot_server_scope.sql`.
- SHA-256 du SQL normalisé LF : `3c66f7f606bd42990f71ea7da19690adb718b9a9a7f24f0b23e33b271ca24bc2`.
- MD5 LF du ledger : `ba1d02e2c5e057f7fb39b44c3d82696c` ; les fins de ligne
  CRLF de l'éditeur ont été distinguées d'un changement sémantique.
- Runtime staging observé pendant l'E2E :
  `d353923791ee342748145305a284634929ffba54` (normalisation native Lovable tracée).
- Déploiement production : `179ee590-613f-43fa-b404-0a480cbe8506`.
- Bundle production : `/assets/index-C4s2fvfW.js`, SHA-256
  `a33c1cb8c6c2d9629e4c26c9397cd8a5c8872cf9740036f49943586f604d9312`.

La présence de références staging et production dans un bundle statique ne
prouve pas à elle seule le routage : celui-ci a aussi été contrôlé dans les
lectures authentifiées et les preuves de cible serveur.

## Exécution sous GO distincts et résultats

Les suffixes ci-dessous complètent les préfixes GO indiqués ; ils désignent
des autorisations déjà exécutées, pas une nouvelle autorisation implicite.

Staging — préfixe
`GO_VALIDATE_STAGING_DAILY_V2_CONTROLLED_PRODUCTION_ACTIVATION_PILOT_` :

- `RUNTIME_E2E_ROLLBACK` : 35/35 assertions synthétiques, migration et runtime
  staging présents. Rôle SQL `authenticated` simulé, pas une preuve de transport
  JWT navigateur ; compte synthétique créé dans la transaction, pas une preuve
  de provisionnement par RPC. Dépôt, promotion, doublon, conflit, supersede,
  reporting et refus admin/backfill couverts. Après `ROLLBACK`, données et
  verrous identiques ; seule la séquence d'audit non transactionnelle avance
  de 20 à 22, sans ligne d'audit persistée supplémentaire ni remise à zéro.

Production — préfixe
`GO_PRODUCTION_DAILY_V2_CONTROLLED_PRODUCTION_ACTIVATION_PILOT_` :

| Suffixe du GO | Résultat établi |
|---|---|
| `PREFLIGHT_READ_ONLY` | Cible et source confirmées ; migration encore absente à cette étape, verrous fermés. |
| `APPLY_MIGRATION` | Commit atomique SQL + ledger : 12 préconditions et 20 assertions vertes ; ledger 39 → 40, audit runtime 1 → 2 par initialisation, aucune activation ni écriture financière. Cœurs/ACL/wrappers vérifiés ; rôles et policies préservés. |
| `PUBLISH_RUNTIME` | Source production `85150a6a466cf87e12b28d945e0849458c5ddf2c`, déploiement `179ee590-613f-43fa-b404-0a480cbe8506`, bundle `/assets/index-C4s2fvfW.js` publié et HTTP 200 ; état DB inchangé et quatre verrous fermés. |
| `POST_PUBLISH_SMOKE_READ_ONLY` | Routes protégées et refus anonymes contrôlés ; aucune authentification ou donnée importée dans cette phase. |
| `AUTHENTICATED_SMOKE_READ_ONLY` | Lectures de la session existante sur la bonne production, UI verrouillée, aucun fichier chargé ; réserve mineure sur un badge de session. |
| `ORA_FIRST_IMPORT_ACTIVATE_DEPOSIT_RELOCK` | Un appel navigateur authentifié de dépôt a persisté trois journées/quatre lignes en staging métier, pas encore dans le canonical ; fermeture immédiate après contrôle. |
| `ORA_FIRST_IMPORT_REVIEW_READ_ONLY` | Comparaison intégrale source/staging : 4/4 lignes et 3/3 unités conformes, soldes/continuité contrôlés ; aucun redépôt. |
| `ORA_FIRST_IMPORT_PROMOTE_RELOCK` | **PARTIAL_STOPPED_RELOCKED** : première journée promue, interruption d'interaction avant les suivantes, fermeture de sécurité ; donnée déjà promue conservée. |
| `ORA_FIRST_IMPORT_PROMOTE_REMAINING_RELOCK` | Deux journées restantes promues exactement une fois, première inchangée ; deux interruptions supplémentaires avec fermeture de sécurité, puis fin contrôlée. |
| `ORA_CANONICAL_REPORTING_SMOKE_READ_ONLY` | **PASS_WITH_RESERVES** : huit scénarios UI rapprochés des agrégats SQL, données et verrous inchangés avant/après. |

Il n'y a pas eu une ouverture continue : une fenêtre de dépôt, une de première
promotion, puis trois fenêtres pour terminer les promotions. Pour ces trois
dernières : deux reprises de sécurité, durée ouverte cumulée 208,684412 s ; les
intervalles fermés ne sont pas comptés comme ouverts. Une erreur de contrôleur
local puis une erreur d'interaction dont la cause n'a pas été complètement
capturée sont conservées dans les preuves. Elles ne sont pas requalifiées en
succès sans réserve ni attribuées sans preuve au moteur métier.

Seuls maître + `daily` ont été temporairement ouverts, sous confirmation de
l'opérateur ; `admin` et `backfill` sont restés fermés. Les reprises n'ont pas
créé de nouveau dépôt, de grant ou de supersede.

Le kill switch consiste à remettre le verrou privé à `false`. Il bloque les
nouvelles mutations sans supprimer de donnée. Une donnée déjà validée ne doit
jamais être effacée pour simuler un rollback : toute correction métier passe par
les mécanismes auditables de supersede/réconciliation et un GO dédié.

## État final et niveau de preuve

Au dernier contrôle, les quatre verrous sont `false`, le ledger compte 40
migrations (dernière : `20260829120000`) et l'audit runtime 12 lignes. Le dernier
identifiant d'audit n'est pas un compteur : les trous de séquence sont possibles.

| Table Daily v2 | Lignes constatées |
|---|---:|
| `daily_statement_import_events` | 10 |
| `daily_statement_lines_staging` | 45 |
| `daily_statement_units_staging` | 5 |
| `daily_statement_account_events` | 6 |
| `daily_statement_backfill_grants` | 0 |
| `daily_statement_export_attempts` | 2 |
| `daily_statement_lines_canonical` | 4 |
| `daily_statement_units_canonical` | 3 |
| `daily_statement_account_registry` | 6 |

Les trois journées ORA sont promues, avec quatre lignes canonical actives.
Les deux unités/41 lignes BDK déjà en staging métier restent inchangées et
non promues. `daily_statement_export_attempts` désigne ici les tentatives
d'import de sources : ce compteur ne prouve pas des téléchargements de rapports.

Le smoke reporting a couvert le périmètre complet ORA, chacune des trois
journées, une période vide, BDK sans canonical, une devise sans donnée et la
vue toutes banques. Les huit résultats UI correspondent aux agrégats SQL
indépendants par empreintes ; équations de solde et continuité vérifiées. Les
filtres invalides effacent les anciens résultats. Les boutons CSV/XLSX sont
présents ou désactivés selon le résultat, mais **aucun export n'a été exécuté**.

Les snapshots avant/après de ce smoke conservent compteurs et empreintes des
neuf tables, verrous, audit runtime, rôles/policies et ledger. Le fichier source
n'a pas été relu pendant ce dernier smoke : sa correspondance vient de la revue
antérieure et de la conservation des empreintes. Les captures réseau de
l'ensemble du parcours ne sont pas exhaustives ; la conservation DB ne prouve
pas à elle seule l'absence de toute requête réseau. Ce contrôle n'est pas une
certification comptable externe de la source.

Validation synthétique de reporting lors du smoke : **63 tests, 63 PASS,
0 FAIL, 0 SKIP**, suites `dailyV2Money`, `dailyV2ReportingCalculations`,
`dailyV2ReportingRead` et `dailyV2ReportingContract` (`*.synthetic.test.ts`).
Ces tests ne sont ni toute la CI ni un test d'export réel. Ils sont distincts
des 35 assertions SQL de l'E2E staging.

## Index des preuves locales (non versionnées)

Les dossiers ci-dessous sont des identifiants de preuves conservées sur le
poste opérateur, hors dépôt. L'empreinte porte sur leur `REPORT.md`, pas sur un
fichier bancaire. Les pièces peuvent contenir des métadonnées opérationnelles
privées : elles ne sont ni recopiées dans Git ni jointes à la PR. Cet index
permet d'en vérifier l'intégrité lorsqu'on y a accès ; il ne rend pas la preuve
live publiquement reproductible. Les synthèses ci-dessus sont expurgées des
montants, identités, références de compte et noms/empreintes des fichiers réels.

| Étape | Identifiant local | SHA-256 du rapport |
|---|---|---|
| Staging rollback | `sodatra-pilot-rollback-08f10a5e4eeb4937b9c26bc652f8abd5` | `53125ae8ea71c19cb59dba0208e6b7897acfd63765406841ecc16bd5165769ee` |
| Production préflight | `sodatra-pilot-production-preflight-a755522179554dd4ad028a7c534fb79f` | `6885a9bf2330cf3777c2d7b32b9643bf495a60f93bb4638ce4787ddd8367de1a` |
| Production migration | `sodatra-pilot-production-migration-557ca17bddbf4ab1bd54b6c5202aec3a` | `c8989921149a138ecbf5ee4b95fe779d7efd2f6d12ead701573f8416aa9f07dc` |
| Production publication | `sodatra-pilot-production-publish-ea5c15b0e528466cb6bc20ea9feab2ed` | `f63f3e6bd8b73a70077181cc240b7cd114a08fcb63681eb14c160682bfcb3e9b` |
| Smoke public | `sodatra-pilot-production-post-publish-smoke-cc24a40ebd714b748f01b4b5297f9e1b` | `a019d8a058f86a59b600aa8c775cc6174df545ecf3f9bc32e99721b3afc09dbd` |
| Smoke authentifié | `sodatra-pilot-production-authenticated-smoke-52fb08cfe83b4cf18559c85b5b7f6a77` | `368aa04cd140104b7455d2c65824f493da4f4b182b2519cbd6fb95fc71b9e900` |
| Dépôt ORA | `sodatra-ora-first-import-52c78d70bbd5418f8acb6a58a01af43f` | `3393e106992c64547ecf756c4175a5b5e880deb20b66d2d649678b523573d052` |
| Revue source/staging | `sodatra-ora-first-import-review-69936f4eee7e44c3ab09fe12751101ae` | `f6a93709e5426b10e0ccc548970ff442e4e53714ce4b332979991f04b61520d2` |
| Promotion interrompue | `sodatra-ora-first-import-promote-55190de26cc34892b1b291a4ac5628ee` | `fff11aa5b7dddf4c1a6b3003c237c033480bd3fce1771512ab84db7a38eb1c89` |
| Promotions restantes | `sodatra-ora-promote-remaining-5d5743f92952405fbcd9a6d21b7041f1` | `7e9c17459406378a29b2cc22894a4eee7d5f6635fd0bacd44d4466af97ae9592` |
| Reporting final | `sodatra-ora-reporting-smoke-f97ff0d7bbd44bc1ab352b3432e9fb5d` | `36b72dd38d6b135f3d2107c736be9e9ddfaa5d0176df2c2e8a6cb568961ee334` |

## Interdits conservés et périmètre de cette clôture

- aucune activation de `/upload` ou de Collection Report ;
- aucun Client Reconciliation ;
- aucun backfill BIS ou provisionnement/désactivation de compte en production ;
- aucune mutation automatique au chargement de la page ;
- aucun secret, fichier bancaire ou payload réel dans Git, les tests ou ce rapport ;
- aucune nouvelle application de migration, modification Auth/RLS, écriture
  métier, ouverture de verrou ou publication dans ce lot **documentaire** ;
- aucun merge implicite de la PR documentaire ; l'autorisation d'implémenter
  couvre son patch, sa validation et sa livraison en draft, pas sa fusion.

## Contrôles de l'implémentation (historique, PR #137)

- suites Daily v2 application et reporting ;
- contrat de garde production : verrou `false`/absent/erreur ferme toutes les
  mutations, `true` n'ouvre que les capacités statiques ;
- tests des rôles et de l'absence des commandes d'administration/backfill ;
- build Vite production et hygiène du bundle ;
- comparaison lint/typecheck à `origin/main` ;
- review indépendante obligatoire, le lot touchant une garde d'intégrité.
- contre-review indépendante du contrôle serveur par capacité/mode et de ses
  tests négatifs directs.

## Validation de la clôture documentaire

Lot : `GO_IMPLEMENT_DAILY_V2_CONTROLLED_PRODUCTION_ACTIVATION_PILOT_PRODUCTION_CLOSURE_DOCUMENTATION`,
confirmation de continuation de l'utilisateur. Branche
`codex/daily-v2-pilot-production-closure` issue de `origin/main` à
`85150a6a466cf87e12b28d945e0849458c5ddf2c` ; préflight initial propre, fetch
réussi, identité du dépôt et merge PR #137 confirmés. Trois fichiers seulement :
ce rapport, `docs/MASTER_CONTEXT.md`, `docs/STATUS_REGISTRY.md`.

Contrôles locaux de ce lot, distincts des anciens GO environnementaux :

- `git diff --check`, liste des fichiers et cohérence du statut : PASS ;
- intégrité des onze `REPORT.md` indexés et des empreintes SQL LF : PASS ;
- lecture du diff ajouté : aucun fichier/payload bancaire réel, montant, identité,
  référence de compte ou secret ajouté ; aucun fichier applicatif/SQL modifié ;
- quatre suites de reporting ci-dessus rejouées : 63 PASS, 0 FAIL, 0 SKIP ;
- lint/typecheck/build complets non rejoués : delta exclusivement Markdown,
  sans revendication de nouvelle validation de runtime ou de CI complète.

Contre-review Claude Code read-only, session
`99587145-f44b-4dc9-99ca-9252cd068afb` : **PASS_WITH_RESERVES — MERGE_READY: YES**,
0 P0, 0 P1, 5 P2 documentaires non bloquants. Relecture des documents et
vérification statique du dashboard/Collections Core ; aucune preuve live privée
ouverte. Les commandes Git du reviewer ont été refusées par ses permissions :
la revue porte sur le contenu des fichiers, pas une contre-vérification du diff
Git ou des assertions serveur. Les vérifications Git et tests sont celles de
l'agent principal, pas de Claude.

Les cinq précisions sont réconciliées dans ce lot : artefact production nommé
sans ambiguïté, ponctuation des quatre verrous, réserve explicite dans le
résumé/tableau du Master, temps historique du finding P1, séparation entre
clôture opérationnelle et livraison documentaire. Ces corrections sont
contrôlées localement ; aucun second verdict indépendant sur ce delta n'est
revendiqué. Décision de livraison : draft PR documentaire ; son merge exige
toujours un GO distinct. Les réserves opérationnelles ci-dessous ne sont pas
levées par cette review documentaire.

## Réserves et suite métier proposée

- le contrôle de cible frontend n'est pas une frontière de sécurité ; les RPC et
  le verrou PostgreSQL restent indispensables ;
- le badge statique « Session requise » était encore affiché malgré les lectures
  authentifiées réussies : réserve UI mineure, non corrigée par ce lot docs ;
- les interruptions d'opérateur/automatisation, les exports non exécutés et les
  limites de capture ci-dessus restent ouverts ; aucun test de réimport réel
  supplémentaire ni matrice complète des rôles en production n'est revendiqué ;
- toute nouvelle activation est une opération séparée, atomique et auditée,
  avec compte/période/fichier bornés, opérateur et critères d'arrêt ;
- l'élargissement futur au backfill BIS ou à l'administration exigera un nouveau
  pack et un GO distinct ; il ne doit jamais réutiliser implicitement le GO du
  pilote journalier.

**Dashboard principal : non raccordé au reporting Daily v2 de ce pilote.** Le
constat est une lecture statique de `src/pages/Dashboard.tsx`,
`src/services/databaseService.ts` et `src/services/dashboardMetricsService.ts` :
le dashboard consomme encore `bank_reports`, `collection_report` et
`fund_position`. Il n'a pas été chargé/testé live pendant ce smoke reporting.
Le reporting contrôlé appartient à `/daily-statements`. Un consommateur
canonical existe aussi dans Collections Core, mais sa garde de cible refuse
la production ; cela ne vaut pas activation de Collection Report.

Prochain pack proposé, **PLANNED — NOT_IMPLEMENTED** : fournir au dashboard
une vue opérationnelle read-only des données Daily v2 canonical actives, avec
source, date de situation, fraîcheur et couverture explicites. Critères :

- distinguer le dernier solde par compte/devise des flux sur une période ;
- ne pas additionner les soldes historiques ni compter deux fois canonical et
  sources legacy ; conserver des périmètres de source clairement séparés ;
- exclure staging et versions superseded, ne pas inventer un mouvement ou un
  solde nul quand une journée manque, ne pas agréger des devises sans convention ;
- couvrir plusieurs comptes/devises, périodes vides et erreurs par tests
  synthétiques et comparaison aux agrégats canonical.

Ce cadrage n'autorise pas son implémentation. Il n'inclut ni nouvelle migration,
ni ouverture de production, ni promotion d'autres banques, ni rapprochement
client/Collection Report. Un GO de pack permettra de grouper développement,
tests et livraison documentaire/code sans demander un GO par micro-contrôle.
