#!/usr/bin/env bash
# =============================================================================
# LOCAL-E2E-0R — RUNNER (Postgres local JETABLE uniquement)
# =============================================================================
# Chaîne validée de bout en bout :
#   classeurs Excel synthétiques ATB/BICIS/BIS/BRIDGE (en mémoire)
#     -> parseur + pipeline TypeScript RÉELS (prepareDailyV2BrowserDeposit)
#     -> payloads RPC réels (artefact SQL généré)
#     -> RPC PostgreSQL réelles dans un conteneur Docker jetable
#     -> staging / canonical / audit
#     -> duplicate / conflict / promotion / supersede / R3 / provisional / rôles
#     -> reporting 0O sur les lignes canonical réellement extraites
#     -> destruction complète du conteneur.
#
# Sécurité :
#   - JAMAIS de Supabase live : aucune commande `supabase`, aucun hostname
#     *.supabase.co, aucun project ref, aucun JWT, aucun secret.
#   - Le conteneur est créé par ce script, porte un nom unique vérifié, et n'est
#     détruit que s'il a été créé ici (trap). Aucun autre conteneur, aucun autre
#     port n'est touché. Aucun `docker system prune`.
#   - Données 100 % synthétiques. Tous les fichiers temporaires sont supprimés.
#
# Usage : bash supabase/tests/daily_statement_units_v2/run_e2e_0r.sh
# Sortie : ALL_LOCAL_E2E_0R_PASS
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MIGRATION="$REPO_ROOT/supabase/migrations/20260708130000_daily_statement_units_v2.sql"
MIGRATION_0U="$REPO_ROOT/supabase/migrations/20260715000000_daily_v2_account_registry_review_visibility.sql"
MIGRATION_0U3="$REPO_ROOT/supabase/migrations/20260715010000_daily_v2_historical_identity_adoption_bridge.sql"
IMAGE="postgres:15-alpine"
PGPASSWORD_LOCAL="e2e0r_throwaway"

CONTAINER=""
CREATED=0
WORKDIR=""

winpath() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

cleanup() {
  local code=$?
  # Ne détruire QUE le conteneur créé par ce runner. Le -v supprime aussi son
  # volume anonyme PGDATA (l'image postgres déclare un VOLUME) — jamais un
  # volume nommé, jamais un volume d'un autre conteneur.
  if [ "$CREATED" -eq 1 ] && [ -n "$CONTAINER" ]; then
    echo "--- teardown: destruction du conteneur $CONTAINER"
    docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
    if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
      echo "TEST_FAILED: le conteneur $CONTAINER n a pas pu etre detruit"
      code=1
    else
      echo "--- teardown: conteneur $CONTAINER detruit"
    fi
  fi
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
    echo "--- teardown: fichiers temporaires supprimes"
  fi
  exit "$code"
}
trap cleanup EXIT

# --- 0. Préflight ------------------------------------------------------------
command -v docker >/dev/null 2>&1 || { echo "TEST_FAILED: docker indisponible"; exit 1; }
docker info >/dev/null 2>&1 || { echo "TEST_FAILED: le daemon docker ne repond pas"; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "TEST_FAILED: psql indisponible"; exit 1; }
[ -f "$MIGRATION" ] || { echo "TEST_FAILED: migration introuvable: $MIGRATION"; exit 1; }
[ -f "$MIGRATION_0U" ] || { echo "TEST_FAILED: migration introuvable: $MIGRATION_0U"; exit 1; }
[ -f "$MIGRATION_0U3" ] || { echo "TEST_FAILED: migration introuvable: $MIGRATION_0U3"; exit 1; }
[ -x "$REPO_ROOT/node_modules/.bin/tsx" ] || { echo "TEST_FAILED: node_modules/.bin/tsx introuvable"; exit 1; }

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "TEST_FAILED: image $IMAGE absente."
  echo "Ce runner ne telecharge AUCUNE image. Autorisation operateur requise :"
  echo "  docker pull $IMAGE"
  exit 1
fi

# Nom de conteneur unique, propre à la campagne, vérifié libre.
CONTAINER="sodatra-e2e0r-$$-${RANDOM}"
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo "TEST_FAILED: collision de nom de conteneur ($CONTAINER)"
  exit 1
fi

WORKDIR="$(mktemp -d)"
echo "=== LOCAL-E2E-0R ==="
echo "conteneur : $CONTAINER (cree par ce runner)"

# --- 1. Génération des payloads par le VRAI pipeline TypeScript --------------
echo ""
echo "--- [1/6] generation des payloads via prepareDailyV2BrowserDeposit"
( cd "$REPO_ROOT" && ./node_modules/.bin/tsx \
    supabase/tests/daily_statement_units_v2/e2e0r_generate_payloads.ts \
    "$(winpath "$WORKDIR")" )
[ -f "$WORKDIR/e2e0r_payloads.sql" ] || { echo "TEST_FAILED: artefact SQL non genere"; exit 1; }

# --- 2. Conteneur Postgres jetable ------------------------------------------
echo ""
echo "--- [2/6] demarrage du conteneur jetable"
PORT=""
for candidate in $(seq 54332 54360); do
  if docker run -d --name "$CONTAINER" \
       -e POSTGRES_PASSWORD="$PGPASSWORD_LOCAL" \
       -p "127.0.0.1:${candidate}:5432" \
       "$IMAGE" >/dev/null 2>&1; then
    CREATED=1
    PORT="$candidate"
    break
  fi
  # Le conteneur a pu être créé puis échouer sur l'allocation du port ; le -v
  # emporte aussi son volume anonyme.
  docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
done
[ -n "$PORT" ] || { echo "TEST_FAILED: aucun port libre entre 54332 et 54360"; exit 1; }
echo "conteneur demarre sur 127.0.0.1:$PORT"

export PGPASSWORD="$PGPASSWORD_LOCAL"
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

echo -n "attente de disponibilite"
for _ in $(seq 1 60); do
  if "${PSQL[@]}" -c 'SELECT 1' >/dev/null 2>&1; then break; fi
  echo -n "."
  sleep 1
done
echo ""
"${PSQL[@]}" -c 'SELECT 1' >/dev/null || { echo "TEST_FAILED: postgres injoignable"; exit 1; }

# --- 3. Shim plateforme + identités + migration réelle -----------------------
echo ""
echo "--- [3/6] shim, identites synthetiques et migration Daily v2"
"${PSQL[@]}" < "$SCRIPT_DIR/00_supabase_local_shim.sql" >/dev/null
"${PSQL[@]}" < "$SCRIPT_DIR/01_seed_synthetic_identities.sql" >/dev/null
"${PSQL[@]}" --single-transaction < "$MIGRATION" >/dev/null
"${PSQL[@]}" < "$SCRIPT_DIR/25_e2e0r_historical_adoption_seed.sql"
"${PSQL[@]}" --single-transaction < "$MIGRATION_0U" >/dev/null
"${PSQL[@]}" --single-transaction < "$MIGRATION_0U3" >/dev/null
"${PSQL[@]}" < "$SCRIPT_DIR/26_e2e0r_historical_adoption_assert.sql"
echo "migrations Daily v2 historique + additives 0U/0U3 appliquees"

# --- 4. Chargement des payloads réels + suite E2E ----------------------------
echo ""
echo "--- [4/6] chargement de l artefact et execution de la suite 0R"
"${PSQL[@]}" < "$WORKDIR/e2e0r_payloads.sql" >/dev/null
"${PSQL[@]}" < "$SCRIPT_DIR/30_e2e0r_pipeline.sql"

# --- 5. Extraction des lignes canonical réelles ------------------------------
echo ""
echo "--- [5/6] extraction des snapshots canonical"
"${PSQL[@]}" -At -c \
  "SELECT coalesce(jsonb_object_agg(checkpoint, units), '{}'::jsonb)
     FROM poc_test.e2e0r_report_snapshot" > "$WORKDIR/e2e0r_snapshots.json"
[ -s "$WORKDIR/e2e0r_snapshots.json" ] || { echo "TEST_FAILED: snapshots vides"; exit 1; }

# --- 6. Reporting 0O sur les données canonical réelles ------------------------
echo ""
echo "--- [6/6] reporting 0O (fonctions pures reelles) sur les lignes extraites"
( cd "$REPO_ROOT" && ./node_modules/.bin/tsx \
    supabase/tests/daily_statement_units_v2/e2e0r_reporting_assert.ts \
    "$(winpath "$WORKDIR/e2e0r_snapshots.json")" \
    "$(winpath "$WORKDIR/e2e0r_payloads.json")" )

echo ""
echo "ALL_LOCAL_E2E_0R_PASS"
