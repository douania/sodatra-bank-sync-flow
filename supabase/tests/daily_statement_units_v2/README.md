# Tests DB — DAILY-RPC-V2-MIGRATION-DRAFT-0H (migration candidate v2)

Suite de tests SQL pour la migration historique
`supabase/migrations/20260708130000_daily_statement_units_v2.sql` et le wrapper
additif 0U `20260715000000_daily_v2_account_registry_review_visibility.sql`,
puis le pont d'adoption historique 0U3
`20260715010000_daily_v2_historical_identity_adoption_bridge.sql`.

**Périmètre strict :**
- Postgres local **jetable** uniquement (Docker). Jamais Supabase live, jamais
  `db push`, jamais `db reset` sur un projet lié.
- Données 100 % **synthétiques** — aucune donnée bancaire réelle.
- Le shim `00_*` émule la plateforme (rôles `anon`/`authenticated`/`service_role`,
  default privileges larges, `auth.uid()` piloté par GUC, `app_role`/`user_roles`/
  `has_role` copiés des migrations prod). **Ne jamais appliquer le shim en prod.**
- **Non empilable avec la suite v1** : les shims v1 et v2 créent tous deux
  `public.app_role` et `public.user_roles` sans `IF NOT EXISTS`. Chaque suite
  exige sa propre base jetable vierge (conteneur distinct ou base recréée).

## Lancement (base jetable Docker)

```sh
docker run -d --name poc0h-pg -e POSTGRES_PASSWORD=poc0h -p 54330:5432 postgres:15-alpine
PSQL="psql -h localhost -p 54330 -U postgres -d postgres -v ON_ERROR_STOP=1"
export PGPASSWORD=poc0h

# 1. Shim + seed + helpers de payload
$PSQL -f 00_supabase_local_shim.sql
$PSQL -f 01_seed_synthetic_identities.sql
$PSQL -f 02_payload_helpers.sql

# 2. Test de rollback : la migration s'annule proprement
$PSQL -c "BEGIN;" -f ../../migrations/20260708130000_daily_statement_units_v2.sql -c "ROLLBACK;"
#    (vérifier ensuite qu'aucune table daily_statement_% n'existe)

# 3. Application réelle (une transaction, comme le CLI supabase)
$PSQL --single-transaction -f ../../migrations/20260708130000_daily_statement_units_v2.sql

# 4. Suites séquentielles
$PSQL -f 10_structure_and_privileges.sql
$PSQL -f 11_validation_gates.sql
$PSQL -f 12_pipeline_rules.sql
$PSQL -f 13_ora_backfill.sql
$PSQL -f 14_supersede.sql
$PSQL -f 15_rls_read_matrix.sql

# 5. Concurrence (deux sessions réelles)
$PSQL -f 19_concurrency_setup.sql
$PSQL -f 20_concurrency_promote_session_a.sql &   # tient le verrou quelques secondes
sleep 2 && $PSQL -f 21_concurrency_promote_session_b.sql
wait
$PSQL -f 24_concurrency_asserts.sql

docker rm -f poc0h-pg   # destruction de la base jetable
```

Tout `TEST_FAILED:` fait échouer psql (`ON_ERROR_STOP`). Une exécution
intégralement verte = PASS local.

## E2E local multi-banques 0R (chaîne Excel réel -> RPC -> canonical -> reporting)

```sh
bash supabase/tests/daily_statement_units_v2/run_e2e_0r.sh
```

Runner autonome (même doctrine : Postgres Docker **jetable**, jamais Supabase
live). Il enchaîne : génération des classeurs synthétiques ATB `.xls`,
BICIS `.xls`, BIS `.xls` et BRIDGE `.xlsx` **en mémoire** → traversée du **vrai
pipeline TypeScript** `prepareDailyV2BrowserDeposit` → émission d'un artefact SQL
portant les **payloads RPC réels** → conteneur jetable + shim + seed + migration
v2 historique → fixture historique synthétique (3 canonical + 1 conflit) →
migrations additives 0U/0U3 → adoption admin fail-closed et teardown ciblé →
`30_e2e0r_pipeline.sql` (registre de
comptes, grants one-use, motifs de revue, dépôt, duplicate R1, conflict R2, promotion,
gate 0K BRIDGE, supersede, R3, provisional, matrice des rôles, audit
append-only) → extraction des lignes canonical → reporting 0O via les fonctions
pures réelles → **destruction du conteneur** (trap, y compris en cas d'échec).

Fichiers : `e2e0r_generate_payloads.ts`,
`25_e2e0r_historical_adoption_seed.sql`,
`26_e2e0r_historical_adoption_assert.sql`, `30_e2e0r_pipeline.sql`,
`e2e0r_reporting_assert.ts`, `run_e2e_0r.sh`.

Deux points de contrat :

- **Anti-faux-E2E** : il n'existe **aucun** payload écrit à la main côté SQL.
  `30_e2e0r_pipeline.sql` consomme exclusivement `poc_test.e2e0r_payload`,
  alimentée par l'artefact généré depuis les classeurs Excel.
- **Frontière assumée** : la lecture du reporting est faite en **SQL direct**
  (projection et filtre identiques à la requête page réelle), pas via PostgREST.
  La couche PostgREST/JWT n'est pas exercée par ce harnais.

Sorties de succès : `ALL_E2E_0R_SQL_PASS`, `ALL_E2E_0R_REPORTING_PASS`, puis
`ALL_LOCAL_E2E_0R_PASS`.

Prérequis : Docker + image `postgres:15-alpine` déjà présente (le runner n'en
télécharge aucune), `psql` dans le PATH, `node_modules/` installé.

## Rappel d'arbitrage (lot 0J)

La candidate v1 (`structured_csv_import_v1`) est archivée hors du chemin live
dans `supabase/db-archive/structured_csv_import_v1/` ; la v2 est la seule
candidate présente dans `supabase/migrations/`. Aucune des deux n'est appliquée
en prod sans GO CTO explicite.
