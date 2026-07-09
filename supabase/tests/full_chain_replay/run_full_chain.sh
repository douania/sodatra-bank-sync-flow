#!/bin/bash
# ============================================================================
# 0M-E — Rejeu FULL-CHAIN local : baseline + chaîne active complète via le
# vrai CLI Supabase (`db push --db-url`) sur un Postgres Docker jetable.
# ============================================================================
# Usage    : bash supabase/tests/full_chain_replay/run_full_chain.sh
# Prérequis: Docker + Supabase CLI. AUCUN projet lié n'est utilisé : la seule
#            cible est postgresql://…@127.0.0.1:54331 (conteneur jetable).
#            Jamais de staging/prod ici.
# ============================================================================
set -e
set -o pipefail

# Git Bash (Windows) : ne pas convertir les chemins destinés au conteneur.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

NAME=fullchain-pg
PORT=54331
# Le CLI Supabase (2.75.0) force TLS sur --db-url (ignore sslmode=disable) :
# le conteneur reçoit donc un certificat auto-signé à l'étape 0bis.
DBURL="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"

PSQL() { docker exec "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
# Variante stdin (heredoc) : docker exec exige -i pour forwarder stdin.
PSQLI() { docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== 0. base jetable"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p ${PORT}:5432 postgres:15-alpine
ready=0
for i in $(seq 1 45); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = "1" ] || { echo "TEST_FAILED: postgres jamais pret"; exit 1; }
sleep 3

echo "== 0bis. TLS auto-signe (le CLI force TLS sur --db-url)"
docker exec "$NAME" apk add --no-cache openssl >/dev/null
docker exec "$NAME" sh -c "openssl req -new -x509 -days 1 -nodes \
  -out /var/lib/postgresql/server.crt -keyout /var/lib/postgresql/server.key \
  -subj /CN=localhost 2>/dev/null \
  && chown postgres:postgres /var/lib/postgresql/server.crt /var/lib/postgresql/server.key \
  && chmod 600 /var/lib/postgresql/server.key"
PSQL -c "ALTER SYSTEM SET ssl='on';"
PSQL -c "ALTER SYSTEM SET ssl_cert_file='/var/lib/postgresql/server.crt';"
PSQL -c "ALTER SYSTEM SET ssl_key_file='/var/lib/postgresql/server.key';"
PSQL -c "SELECT pg_reload_conf();"

echo "== 1. shim plateforme minimal"
# docker cp exige des chemins RELATIFS sous Git Bash (binaire Windows +
# MSYS_NO_PATHCONV) — toujours relatifs au REPO_ROOT courant.
docker cp "supabase/tests/full_chain_replay/00_platform_shim_minimal.sql" "$NAME":/shim.sql
docker cp "supabase/migrations/20250625000000_baseline_prechain.sql" "$NAME":/baseline.sql
docker cp "supabase/migrations/20260707000000_db_freeze_1b_collection_report_truth.sql" "$NAME":/freeze.sql
PSQL -f /shim.sql

echo "== 2. baseline : test rollback"
PSQL -c "BEGIN;" -f /baseline.sql -c "ROLLBACK;"
cnt=$(docker exec "$NAME" psql -U postgres -d postgres -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
[ "$cnt" = "0" ] || { echo "TEST_FAILED: rollback baseline a laisse $cnt table(s) public"; exit 1; }
echo "OK: rollback baseline sans residu"

echo "== 3. baseline : idempotence (2 applications)"
PSQL --single-transaction -f /baseline.sql
PSQL --single-transaction -f /baseline.sql
echo "OK: baseline idempotente (2x sans erreur)"

echo "== 4. full-chain via supabase db push --db-url (aucun projet lie)"
echo Y | supabase db push --db-url "$DBURL"

echo "== 5. ledger local supabase_migrations.schema_migrations"
EXPECTED_FILE=$(mktemp)
ACTUAL_FILE=$(mktemp)
ls supabase/migrations/*.sql | xargs -n1 basename | cut -d_ -f1 | sort > "$EXPECTED_FILE"
docker exec "$NAME" psql -U postgres -d postgres -tAc \
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version" > "$ACTUAL_FILE"
if ! diff -w "$EXPECTED_FILE" "$ACTUAL_FILE"; then
  echo "TEST_FAILED: ledger local != liste des fichiers supabase/migrations/"
  exit 1
fi
NB=$(wc -l < "$EXPECTED_FILE" | tr -d ' ')
echo "OK: ledger local conforme — $NB versions appliquees"

echo "== 6. db_freeze_1b : idempotence (re-application post-chaine)"
PSQL -f /freeze.sql
echo "OK: db_freeze_1b rejouable sans erreur"

echo "== 7. post-checks etat final"
POSTCHECK_OUT=$(PSQLI 2>&1 <<'SQL'
DO $$
DECLARE
  v_cnt bigint;
  r record;
BEGIN
  -- 7.1 RLS activee sur toutes les tables public
  SELECT count(*) INTO v_cnt FROM pg_tables
  WHERE schemaname = 'public' AND rowsecurity = false;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: % table(s) public sans RLS', v_cnt;
  END IF;
  RAISE NOTICE 'OK: RLS activee sur toutes les tables public';

  -- 7.2 zero policy permissive USING(true) / WITH CHECK(true)
  SELECT count(*) INTO v_cnt FROM pg_policies
  WHERE schemaname = 'public' AND (qual = 'true' OR with_check = 'true');
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: % policy permissive(s) restante(s)', v_cnt;
  END IF;
  RAISE NOTICE 'OK: zero policy USING(true)/WITH CHECK(true)';

  -- 7.3 toutes les tables metier vides. Exception attendue : user_roles
  -- contient les roles du SEUL user fixture plateforme, poses par la chaine
  -- elle-meme (backfill 20251119125337 + promotion admin 20260430150428).
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.tablename) INTO v_cnt;
    IF r.tablename <> 'user_roles' AND v_cnt > 0 THEN
      RAISE EXCEPTION 'TEST_FAILED: table % non vide (% lignes)', r.tablename, v_cnt;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: toutes les tables metier vides';

  SELECT count(*) INTO v_cnt FROM public.user_roles
  WHERE user_id <> '9539d4f5-a600-4bf7-931f-315e597e4441'::uuid;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: user_roles contient des lignes hors fixture plateforme';
  END IF;
  RAISE NOTICE 'OK: user_roles = roles du seul user fixture (comportement chaine attendu)';

  -- 7.4 verite colonne unique_excel_traceability
  PERFORM 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'collection_report'
    AND column_name = 'unique_excel_traceability'
    AND data_type = 'text' AND is_generated = 'NEVER'
    AND generation_expression IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST_FAILED: unique_excel_traceability != text/NEVER/NULL';
  END IF;
  RAISE NOTICE 'OK: unique_excel_traceability = text / NEVER / expression NULL';

  -- 7.5 contrainte UNIQUE classique sur la colonne
  PERFORM 1 FROM pg_constraint
  WHERE conname = 'unique_excel_traceability'
    AND conrelid = 'public.collection_report'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (unique_excel_traceability)';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST_FAILED: contrainte UNIQUE (unique_excel_traceability) absente ou non conforme';
  END IF;
  RAISE NOTICE 'OK: contrainte UNIQUE (unique_excel_traceability) presente';

  -- 7.6 idx_collection_excel_source : unique partiel sur la paire excel
  PERFORM 1 FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'collection_report'
    AND indexname = 'idx_collection_excel_source'
    AND indexdef ILIKE '%UNIQUE%'
    AND indexdef ILIKE '%excel_filename%'
    AND indexdef ILIKE '%excel_source_row%'
    AND indexdef ILIKE '%WHERE%';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST_FAILED: idx_collection_excel_source absent ou non conforme';
  END IF;
  RAISE NOTICE 'OK: idx_collection_excel_source unique partiel present';

  -- 7.7 check_excel_traceability_not_null
  PERFORM 1 FROM pg_constraint
  WHERE conname = 'check_excel_traceability_not_null'
    AND conrelid = 'public.collection_report'::regclass;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST_FAILED: check_excel_traceability_not_null absent';
  END IF;
  RAISE NOTICE 'OK: check_excel_traceability_not_null present';

  -- 7.8 privileges RPC v2 : 3 RPC exposees a authenticated, fermees a anon
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('pre_ingest_daily_statement_units',
                        'promote_daily_statement_unit',
                        'supersede_daily_statement_unit')
  LOOP
    IF NOT has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: authenticated sans EXECUTE sur %', r.sig;
    END IF;
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: anon a EXECUTE sur %', r.sig;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: RPC v2 exposees a authenticated, fermees a anon';

  -- 7.9 helpers v2 verrouilles pour anon/authenticated
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'daily\_stmt\_%'
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE')
       OR has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: helper % accessible a anon/authenticated', r.sig;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK: helpers daily_stmt_%% verrouilles';
END
$$;
SELECT 'POSTCHECKS_EXECUTED' AS sentinel;
SQL
)
echo "$POSTCHECK_OUT"
# Anti-faux-vert : la sentinelle prouve que le bloc a bien ete execute.
echo "$POSTCHECK_OUT" | grep -q "POSTCHECKS_EXECUTED" || { echo "TEST_FAILED: post-checks non executes"; exit 1; }

echo "== 8. destruction de la base jetable"
docker rm -f "$NAME"

echo "ALL_FULL_CHAIN_PASS"
