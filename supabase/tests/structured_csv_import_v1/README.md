# Tests DB — POC-BANK-STRUCTURED-EXPORTS-0U (migration candidate v1)

Suite de tests SQL pour `supabase/db-archive/structured_csv_import_v1/20260703120000_structured_csv_import_v1.sql`.

> **Archive candidate v1 — hors chemin live (lot 0J).** Cette migration v1 est
> archivée hors `supabase/migrations` afin d'éviter toute application
> accidentelle par `db push`/`db reset`. Elle reste testable localement comme
> référence historique. La candidate cible est la v2 journalière
> (`supabase/migrations/20260708130000_daily_statement_units_v2.sql`).

**Périmètre strict :**
- Postgres local **jetable** uniquement (Docker). Jamais Supabase live.
- Données 100 % **synthétiques** (`BKTEST`, `fp_synth_*`, `rth_*`, `h_*`) — aucune donnée bancaire réelle.
- Le shim `00_*` émule la plateforme (rôles `anon`/`authenticated`/`service_role`,
  default privileges larges, `auth.uid()` piloté par le GUC `request.jwt.claim.sub`,
  `app_role`/`user_roles`/`has_role` copiés des migrations prod
  `20251119120031_*` et `20260430150428_*`). **Ne jamais appliquer le shim en prod.**

## Lancement (base jetable Docker)

```sh
docker run -d --name poc0u-pg -e POSTGRES_PASSWORD=poc0u -p 54329:5432 postgres:15-alpine
PSQL="psql -h localhost -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1"
export PGPASSWORD=poc0u

# 1. Shim + seed
$PSQL -f 00_supabase_local_shim.sql
$PSQL -f 01_seed_synthetic_identities.sql

# 2. Test de rollback : la migration s'annule proprement
$PSQL -c "BEGIN;" -f ../../db-archive/structured_csv_import_v1/20260703120000_structured_csv_import_v1.sql -c "ROLLBACK;"
#    (vérifier ensuite qu'aucune table bank_statement_% n'existe)

# 3. Application réelle (une transaction, comme le CLI supabase)
$PSQL --single-transaction -f ../../db-archive/structured_csv_import_v1/20260703120000_structured_csv_import_v1.sql

# 4. Suites séquentielles
$PSQL -f 10_structure_and_privileges.sql
$PSQL -f 11_dates_strict.sql
$PSQL -f 12_pipeline_rules.sql
$PSQL -f 13_supersede_and_immutability.sql
$PSQL -f 14_rls_read_matrix.sql

# 5. Concurrence (deux sessions réelles, T16)
$PSQL -f 19_concurrency_setup.sql
$PSQL -f 20_concurrency_promote_session_a.sql &   # tient le verrou ~6 s
sleep 2 && $PSQL -f 21_concurrency_promote_session_b.sql
wait
$PSQL -f 22_concurrency_supersede_session_a.sql &
sleep 2 && $PSQL -f 23_concurrency_supersede_session_b.sql
wait
$PSQL -f 24_concurrency_asserts.sql

docker rm -f poc0u-pg   # destruction de la base jetable
```

Tout `TEST_FAILED:` fait échouer psql (`ON_ERROR_STOP`). Une exécution
intégralement verte = PASS local.

## Couverture

| Fichier | Tests draft 0P/0R couverts |
|---|---|
| 10 | T8 anti-raw, no-enum (CTO-5), index Option A, RLS activée, zéro policy d'écriture (CTO-7), matrice privilèges tables + EXECUTE (CTO-8) |
| 11 | T12 dates DD/MM/YYYY sous `ISO, MDY` **et** `ISO, DMY`, montants sans arrondi silencieux |
| 12 | R1 (T3), R2 (T4), R4, R5 (T6), R6 (T7), gates parser, anti-smuggling payload, rôles (CTO-2/3/4), reject 7.2, escalation 7.5 (T14), events |
| 13 | T11 supersede, T13 lignes communes, T13bis divergence `is_active`, R3, T9 append-only, T10 immutabilité (dont `is_active`), T15 safe_details (top-level, whitelist, imbriqué), T5, trigger anti-promote |
| 14 | T2 matrice RLS lecture par rôle + anon + authentifié sans rôle |
| 19–24 | T16 double promotion et double supersede concurrents (verrou 7.9 + re-lecture 7.7.c) |

## Limites connues

- Le owner local est un superuser (en prod : rôle `postgres` Supabase, non-superuser
  mais owner + définer). Les chemins « owner contourne » (section F de 13) documentent
  ce qui reste possible pour le owner : index partiels + trigger restent les gardes.
- La concurrence est testée avec des fenêtres de 6 s (déterministe par verrou,
  pas par sleep) ; T1 « dry-run + rollback » est porté par l'étape 2/3 du lancement.
- `pg_advisory_xact_lock` et l'index partiel sont les deux garanties indépendantes :
  si le verrou échouait, l'index `uq_canonical_active_import_id` reste la garantie dure.
