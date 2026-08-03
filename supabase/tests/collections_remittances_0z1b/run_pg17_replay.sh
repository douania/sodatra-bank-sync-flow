#!/bin/bash
set -euo pipefail

# 0Z1B — replay local exclusivement. Aucune cible Supabase n'est utilisée.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

NAME=collections-0z1b-pg17
PORT=54332

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

echo "== 0Z1B/1 PostgreSQL 17 jetable"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p ${PORT}:5432 postgres:17-alpine >/dev/null
ready=0
for _ in $(seq 1 45); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = "1" ] || { echo "TEST_FAILED: PostgreSQL 17 indisponible"; exit 1; }

PSQLI() { docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "== 0Z1B/2 shim plateforme et baseline"
PSQLI < supabase/tests/full_chain_replay/00_platform_shim_minimal.sql
PSQLI --single-transaction < supabase/migrations/20250625000000_baseline_prechain.sql

echo "== 0Z1B/3 chaîne complète de migrations"
while IFS= read -r migration; do
  [ "$(basename "$migration")" = "20250625000000_baseline_prechain.sql" ] && continue
  echo "APPLY $(basename "$migration")"
  PSQLI < "$migration"
done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)

version="$(docker exec "$NAME" psql -U postgres -d postgres -tAc 'show server_version')"
case "$version" in
  17.*) echo "OK: PostgreSQL $version" ;;
  *) echo "TEST_FAILED: version inattendue $version"; exit 1 ;;
esac

echo "== 0Z1B/4 scénarios et attaques synthétiques"
PSQLI < supabase/tests/collections_remittances_0z1b/01_domain_security_replay.sql

echo "ALL_COLLECTIONS_0Z1B_PG17_PASS"
