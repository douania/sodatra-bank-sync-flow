# Daily v2 — BIS backfill atomic ingest timeout hardening

## Statut

`CLOSED — PRODUCTION_VALIDATED_READ_ONLY` — 2026-08-29.

Le lot corrige le timeout PostgreSQL `57014` observé pendant la qualification
staging du fichier BIS réel : le parsing avait produit 857 unités et 4 798
lignes, mais la RPC atomique dépassait le budget de requête. Durant la phase
d'implémentation locale et de review de la PR #135, aucune migration n'a été
appliquée sur staging ou production. Les applications distantes, réalisées
ultérieurement sous des GO nominatifs, sont tracées ci-dessous.

## Cause confirmée

Le cœur historique 0Z et le wrapper 0U exécutaient plusieurs boucles PL/pgSQL :

- validation ligne par ligne et recherches répétées dans les tableaux JSON ;
- recalcul des hashes par relecture des 4 798 lignes pour chaque unité ;
- un `INSERT` par ligne de staging ;
- un `UPDATE` et plusieurs événements d'audit par unité.

Un `SET statement_timeout` porté par une fonction ne peut pas prolonger le
timeout déjà armé sur la requête PostgREST. Le correctif devait donc réduire le
nombre de statements, sans chunking et sans transaction partielle.

## Correction

La migration
`20260829000000_daily_v2_bis_backfill_atomic_ingest_timeout_hardening.sql` :

- conserve le cœur 0Z pour les dépôts `daily` ;
- route exclusivement les backfills BIS historiques, bornés et constitués de
  journées closes vers un cœur interne ensembliste ;
- conserve les validations serveur d'identité, de dates, de montants, de
  cardinalité, de `day_unit_id`, de `day_content_hash` et de grant ;
- acquiert les advisory locks dans l'ordre canonique anti-deadlock ;
- arbitre R1/R2/R3 ensemblistement ;
- insère les unités, lignes et événements d'audit par lots ;
- vérifie après insertion que la cardinalité des lignes staging correspond
  exactement à la cardinalité attendue ;
- balaie les provisionals périmées en append-only ;
- conserve une transaction unique, puis consomme le grant dans le wrapper ;
- ne crée aucune table temporaire et n'augmente aucun timeout ;
- révoque l'exécution des deux nouvelles fonctions internes à `PUBLIC`,
  `anon`, `authenticated` et `service_role` ; seule la RPC publique existante
  reste accordée à `authenticated`.

La contre-review indépendante initiale de la draft PR #135 avait signalé un
dernier risque quadratique et plusieurs réserves de preuve. Le correctif :

- supprime les deux rescans corrélés restants : `line_count` est transporté
  dans la décision et les unités du résultat sont matérialisées une seule fois ;
- acquiert chaque advisory lock dans une boucle explicitement ordonnée, au lieu
  de dépendre de l'ordre d'évaluation implicite d'une sous-requête ;
- fait échouer atomiquement la RPC si le nombre de lignes insérées diverge ;
- ajoute une campagne distincte à la borne contractuelle de 4 000 unités.

La revalidation indépendante du SHA `5b38593` a ensuite identifié une
régression P1 dans la classification R3 du nouveau cœur. Le wrapper ajoutait le
motif serveur `ACTIVE_LINE_HASH_SCOPE_CONFLICT` avant de vérifier la cohérence
du statut déclaré par le client. Une journée correctement déclarée `valid`,
sans motif client, mais reclassée `needs_review` par R3 était donc refusée à
tort. La correction :

- mémorise séparément la présence de motifs de revue fournis par le client ;
- applique `DAILY_STMT_REVIEW_STATUS_MISMATCH` uniquement à ces motifs client ;
- conserve les motifs ajoutés par le serveur et la classification R3
  `needs_review` dans le résultat et l'audit ;
- étend la sonde 0R-J0/J1 pour prouver explicitement le cas client
  `valid`/sans motif puis serveur R3 `needs_review` ;
- réutilise le helper canonique `daily_stmt_acquire_day_lock` dans la boucle
  ordonnée ;
- calcule la cardinalité attendue des lignes depuis les décisions validées,
  indépendamment du comptage des lignes effectivement insérées ;
- ajoute une preuve directe à deux sessions du nouveau cœur BIS ensembliste.

La revalidation indépendante du SHA `ce9dcff` a confirmé ce correctif R3, puis
a détecté un nouveau P1 : le grant bornait la fenêtre déclarée dans la
tentative, sans vérifier que chaque `accounting_date` d'unité appartenait
réellement à cette fenêtre. Elle a également demandé la fermeture de l'entrée
applicative backfill directe, des preuves comportementales négatives du cœur et
une comparaison directe du canonical dans la course. Le correctif V2 :

- refuse avant tout routage toute unité daily ou backfill dont la date est
  absente ou hors de la période d'export déclarée ;
- conserve ensuite le contrôle distinct de cette période déclarée contre la
  période du grant ;
- supprime l'export applicatif `preIngestDailyV2`, sans consommateur, afin que
  tout backfill passe nécessairement par l'entrée incrémentale ;
- injecte réellement dans PostgreSQL une ligne manquante, excédentaire,
  orpheline, un hash dupliqué et un `line_count` mensonger ; chaque refus
  prouve zéro tentative, unité, ligne ou audit et un grant encore actif ;
- teste les deux dépassements de période en daily et en backfill ;
- compare directement l'identifiant canonical renvoyé à la session B avec
  celui promu par la session A.

## Traitement incrémental durable du fichier BIS

Le classeur reste intégralement parsé et validé dans le navigateur : l'application
ne fait donc jamais confiance à une simple date de dernière importation. Avant
la RPC backfill, elle lit uniquement, pour le compte et la période sélectionnés :

- les `day_unit_id` et `active_day_content_hash` canonical actifs ;
- les `day_unit_id` provisional encore vivants.

Le delta applique ensuite la règle suivante :

- journée canonical strictement identique et sans provisional : ignorée ;
- journée absente : déposée comme nouvelle ;
- journée dont le contenu diffère : déposée et laissée à l'arbitrage serveur ;
- journée identique avec un provisional vivant : déposée pour permettre au
  serveur de réconcilier ce provisional.

Ainsi, les milliers d'anciennes lignes utiles comme historique ne sont ni
supprimées ni retraitées à chaque import. Elles servent à vérifier l'identité du
fichier, puis seules les journées utiles franchissent la RPC. Si le delta est
vide, aucune RPC n'est appelée et le grant reste actif. Cette optimisation ne
remplace aucune garantie serveur : une course concurrente reste arbitrée
atomiquement par R1/R2/R3. La comparaison ne télécharge ni montant, ni libellé,
ni numéro de compte complet.

Le contrat du grant est désormais explicite : `max_units` borne le nombre de
journées utiles réellement transmises à la RPC, c'est-à-dire le delta, tandis
que `period_start` et `period_end` continuent de borner la période complète de
l'export sélectionné. Une journée canonical identique ignorée ne consomme donc
pas le grant et ne crée ni tentative ni événement d'audit supplémentaire. Le
canonical existant reste la preuve financière durable de ce contenu. Si une
traçabilité de chaque présentation physique du fichier devient nécessaire,
elle devra être conçue comme un registre de réception distinct, sans recréer de
staging financier en doublon.

## Preuve synthétique de volumétrie réelle

Le générateur `e2e0r_generate_bis_mass_backfill.ts` crée en mémoire un classeur
BIS 100 % synthétique qui traverse le vrai
`prepareDailyV2BrowserDeposit`. Il reproduit exactement :

- 857 journées ;
- 4 798 lignes ;
- période du 01/08/2016 au 25/08/2026 ;
- quatre motifs de revue par unité, soit 3 428 événements dédiés.

Le test PostgreSQL jetable impose `SET LOCAL statement_timeout = '15s'` et
vérifie :

- ingestion complète sous la borne de 15 secondes ;
- exactement 857 unités et 4 798 lignes persistées ;
- un événement append-only pour chaque motif de revue ;
- grant consommé et lié à l'unique tentative ;
- rejet tardif après écritures du cœur : zéro attempt, zéro unité et grant
  toujours actif grâce au rollback intégral ;
- rollback externe de toute la campagne synthétique.

Une seconde campagne synthétique vérifie en plus la borne maximale autorisée :

- 4 000 journées et 4 000 lignes ;
- passage par le vrai pipeline navigateur ;
- ingestion atomique sous 15 secondes ;
- exactement 4 000 unités et 4 000 lignes staging ;
- grant consommé, puis rollback externe complet.

## Validations locales

- migration PostgreSQL 15 jetable : **PASS** ;
- charge BIS 857 / 4 798 sous 15 s : **PASS** ;
- charge plafond BIS 4 000 / 4 000 sous 15 s : **PASS** ;
- chaîne SQL multi-banques 0R : **PASS** (`ALL_E2E_0R_SQL_PASS`) ;
- bornes de période daily et backfill, inférieure et supérieure : **PASS** ;
- cinq corruptions de cardinalité/ligne sur le nouveau cœur avec rollback
  complet : **PASS** ;
- cycle de vie provisional 0Z : **PASS** ;
- concurrence historique provisional sur deux sessions : **PASS** ;
- concurrence directe du cœur BIS ensembliste sur deux sessions : **PASS** ;
  la session B a attendu **4,082 s**, a renvoyé exactement le canonical promu
  par A, puis a produit un doublon audité sans ligne financière supplémentaire ;
- tests Daily v2 application : **103/103 PASS** ;
- tests Daily v2 reporting : **70/70 PASS** ;
- toutes les autres suites `test:*` de la matrice CI : **PASS** ;
- typecheck canonique `tsc -p tsconfig.app.json --noEmit` : 17 diagnostics sur
  `origin/main`, 17 sur le lot, **0 nouveau** ;
- ESLint comparatif : 180 erreurs + 11 warnings sur `origin/main`, 180 + 11
  sur le lot, **0 finding nouveau** ;
- ESLint ciblé des quatre fichiers TypeScript/TSX modifiés : **PASS** ;
- build Vite production : **PASS** ;
- `git diff --check` : **PASS**.

Les conteneurs PostgreSQL et le worktree baseline étaient jetables et ont été
supprimés. Aucun fichier bancaire réel, secret ou payload généré n'est versionné.

## Revalidations indépendantes, merge et CI

La draft PR #135 a fait l'objet de revalidations indépendantes successives.
Elles ont bloqué le merge tant que subsistaient la régression R3, la faille de
portée temporelle du grant, les preuves comportementales incomplètes et les
derniers écarts de concurrence. Le SHA final
`0e4acf20e85164e477977fcb68f4a65ec1109b4e` ne conserve aucun finding P0, P1
ou P2 ouvert et a été déclaré prêt au merge.

La PR #135, `fix(daily-v2): harden atomic BIS backfill timeout`, a été fusionnée
le 2026-08-29. Son head est intégré dans `main` par le commit
`f6f6c0bdd435532b82dc3195f8d09f143b3d6299`. Le check GitHub Actions
`Lint and build` s'est terminé avec la conclusion `SUCCESS`.

## Validation staging

Les phases staging ont ciblé exclusivement le projet Lovable
`8c508b94-d03f-4165-ab2b-7a3cd52d2d2b` et le projet Supabase canonique
`gbbsqcscryygqlmqncyv`.

Traçabilité du 2026-08-29 :

- `GO_VALIDATE_STAGING_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_PREFLIGHT_READ_ONLY` ;
- `GO_APPLY_STAGING_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_MIGRATION` ;
- `GO_APPLY_STAGING_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_RUNTIME_SYNC` ;
- `GO_VALIDATE_STAGING_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_RUNTIME_E2E_ROLLBACK` ;
- confirmation utilisateur de l'E2E BIS et de son rollback avant toute phase
  production.

Sous ces autorisations distinctes :

- le préflight read-only a confirmé la cible, le SHA et l'absence de la
  migration du lot ;
- la migration `20260829000000` a été appliquée avec son entrée de ledger ;
- le runtime staging a été synchronisé sur le code fusionné
  `f6f6c0bdd435532b82dc3195f8d09f143b3d6299` ;
- le scénario authentifié BIS 857 journées / 4 798 lignes a traversé le
  chemin atomique optimisé sous le budget de requête puis a été annulé ;
- le contrôle final n'a trouvé aucun résidu synthétique ni verrou temporaire.

Les identifiants de réconciliation staging sont donc le projet Lovable
`8c508b94-d03f-4165-ab2b-7a3cd52d2d2b`, le project ref
`gbbsqcscryygqlmqncyv`, le SHA runtime `f6f6c0b`, la version de migration
`20260829000000` et la preuve E2E `857 unités / 4 798 lignes / rollback sans
résidu`.

Cette validation n'a promu aucune donnée staging vers le canonical de
production. Les fichiers bancaires réels utilisés pour qualifier le parsing ne
sont ni versionnés ni reproduits dans ce rapport.

## Validation production

### Préflight, migration et E2E avec rollback

Traçabilité du 2026-08-29 :

- `GO_PRODUCTION_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_PREFLIGHT_READ_ONLY` ;
- `GO_PRODUCTION_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_APPLY_MIGRATION` ;
- `GO_PRODUCTION_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_AUTHENTICATED_E2E_ROLLBACK` ;
- `GO_PRODUCTION_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_PUBLISH_RUNTIME` ;
- `GO_PRODUCTION_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_POST_PUBLISH_SMOKE_READ_ONLY` ;
- `GO_PRODUCTION_DAILY_V2_BIS_BACKFILL_ATOMIC_INGEST_TIMEOUT_HARDENING_AUTHENTICATED_SMOKE_READ_ONLY`.

Le préflight a verrouillé la cible sur le projet Supabase production
`leakcdbbawzysfqyqsnr`. La migration du lot était absente et les prérequis
Daily v2 étaient présents. L'application transactionnelle de
`20260829000000_daily_v2_bis_backfill_atomic_ingest_timeout_hardening.sql` a
ensuite été autorisée séparément.

Le post-contrôle a confirmé :

- 39 versions au ledger, avec `20260829000000` comme dernière version ;
- aucun verrou de migration restant ;
- les fonctions internes du nouveau cœur toujours fermées aux rôles clients ;
- la RPC publique existante et les contrôles Auth, rôles, grant et audit
  conservés.

Le scénario production authentifié, exécuté dans une transaction annulée, a
rejoué la volumétrie synthétique représentative de 857 unités et 4 798 lignes.
Il a terminé sous 15 secondes, consommé le grant dans la transaction, conservé
les cardinalités attendues et prouvé le rollback intégral. Le contrôle final a
confirmé zéro donnée et zéro grant synthétique résiduel.

### Publication du runtime

Le projet Lovable production exact est
`e52d9fce-f1b4-46f8-900c-c559a6eb2115`, publié à l'URL canonique
`https://sodatra-bank-sync-flow.lovable.app`. Le runtime est aligné sur le
commit de merge `f6f6c0bdd435532b82dc3195f8d09f143b3d6299`. Le bundle actif
`index-BU3Wr_fP.js` contient les marqueurs incrémentaux `submittedUnits`,
`identicalUnitsSkipped` et `Synthèse incrémentale BIS`, et ne référence que la
cible Supabase production `leakcdbbawzysfqyqsnr`.

La publication est réconciliée par l'identifiant de déploiement Lovable
`c8f7e858-af66-476a-bcf0-d881238869ee`. Après déploiement, le projet a été
observé `ready`, publié et aligné sur `f6f6c0b`, avec
`updated_at = 2026-08-29T20:44:05.348Z`.

### Smokes post-publication

Le smoke anonyme a confirmé :

- chargement HTTP du domaine canonique et du bundle publié ;
- redirection de `/daily-statements` vers `/auth` ;
- aucun contenu Daily v2 protégé exposé ;
- aucun échec réseau ni erreur ou avertissement frontend ;
- aucune requête métier ou Supabase, hors télémétrie technique Lovable.

Le smoke authentifié a ensuite confirmé :

- accès à `/daily-statements` sur une session production valide ;
- affichage de `Production en lecture seule` et
  `Verrou serveur : lecture seule imposée` ;
- absence de sélecteur de fichier et de commande d'import ou de mutation ;
- chargement des vues Staging, Canonical, Audit et Reporting ;
- appels Supabase exclusivement en `GET` vers
  `leakcdbbawzysfqyqsnr.supabase.co` ;
- aucun appel métier `POST`, `PATCH` ou `DELETE`, aucun échec réseau et aucun
  finding console. Les seuls `POST` observés sont la télémétrie Lovable.

## Sécurité, rollback et limites

La migration est additive et transactionnelle. Un retour arrière après commit
nécessiterait une nouvelle migration additive et un GO production dédié ; il
ne doit pas réintroduire l'ancien chemin quadratique ni ouvrir les fonctions
internes aux rôles clients.

Les validations environnementales ont utilisé des transactions annulées pour
les données synthétiques. Aucun secret, fichier bancaire, numéro de compte,
montant détaillé ou payload financier n'est consigné dans Git ou dans ce
rapport. La publication n'a modifié ni Auth, ni RLS, ni les rôles métier.

La production reste volontairement en consultation seule. Cette clôture prouve
que le correctif est déployé et que le chemin atomique tient la volumétrie
contractuelle ; elle n'autorise pas l'import opérationnel BIS en production.
Toute ouverture future d'une mutation Daily v2, tout nouveau format de fichier
ou tout registre de réception physique exigera un pack et des GO distincts.

## Clôture

Le timeout atomique BIS est corrigé, fusionné, migré et validé sur staging puis
production. Le runtime publié expose le delta incrémental tout en conservant la
garde production read-only. Le pack est clos sans réserve bloquante.
