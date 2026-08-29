# Daily v2 — BIS backfill atomic ingest timeout hardening

## Statut

`IMPLEMENTED_LOCAL — INDEPENDENT_REVIEW_REQUIRED` — 2026-08-29.

Le lot corrige le timeout PostgreSQL `57014` observé pendant la qualification
staging du fichier BIS réel : le parsing avait produit 857 unités et 4 798
lignes, mais la RPC atomique dépassait le budget de requête. Aucune migration
n'a été appliquée sur staging ou production par ce lot.

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
- balaie les provisionals périmées en append-only ;
- conserve une transaction unique, puis consomme le grant dans le wrapper ;
- ne crée aucune table temporaire et n'augmente aucun timeout ;
- révoque l'exécution des deux nouvelles fonctions internes à `PUBLIC`,
  `anon`, `authenticated` et `service_role` ; seule la RPC publique existante
  reste accordée à `authenticated`.

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

## Validations locales

- migration PostgreSQL 17 jetable : **PASS** ;
- charge BIS 857 / 4 798 sous 15 s : **PASS** ;
- chaîne SQL multi-banques 0R : **PASS** (`ALL_E2E_0R_SQL_PASS`) ;
- cycle de vie provisional 0Z : **PASS** ;
- tests Daily v2 application : **102/102 PASS** ;
- toutes les autres suites `test:*` de la matrice CI : **PASS** ;
- typecheck canonique `tsc -p tsconfig.app.json --noEmit` : 17 diagnostics sur
  `origin/main`, 17 sur le lot, **0 nouveau** ;
- ESLint comparatif : 180 erreurs + 11 warnings sur `origin/main`, 180 + 11
  sur le lot, **0 finding nouveau** ;
- ESLint ciblé des deux fichiers TypeScript modifiés : **PASS** ;
- build Vite production : **PASS** ;
- `git diff --check` : **PASS**.

Les conteneurs PostgreSQL et le worktree baseline étaient jetables et ont été
supprimés. Aucun fichier bancaire réel, secret ou payload généré n'est versionné.

## Frontières et prochaine étape

Ce verdict est local. Aucun merge, aucune migration distante et aucune
publication runtime ne sont compris dans l'implémentation. La migration touche
un chemin financier, des fonctions `SECURITY DEFINER`, les ACL et l'audit : une
contre-review indépendante approfondie du SHA de la draft PR est obligatoire
avant tout GO de merge.
