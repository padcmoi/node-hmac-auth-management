#!/usr/bin/env bash
# POC end-to-end test runner. Fails (exit != 0) if ANY assertion fails.
#
#   ./test.sh         -> runs the suite once
#   ./test.sh N       -> runs the suite N times consecutively (regression-hunt)
#
# Pre-requisite: the docker compose stack is already up. The script assumes
# host-side localhost port mapping:
#   api_a -> :3010, api_b -> :3011, api_c -> :3012, app_d -> :3013, app_e -> :3014
# Each Redis is reached through the docker network via `docker exec redis-cli`
# (no host port exposure needed).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNS="${1:-1}"

cd "$SCRIPT_DIR/e2e-tests"

if [ ! -d node_modules ]; then
  echo "[e2e] installing dependencies..."
  npm install --no-audit --no-fund --silent
fi

export API_A_BASE="${API_A_BASE:-http://localhost:3010}"
export APP_D_BASE="${APP_D_BASE:-http://localhost:3013}"
export APP_E_BASE="${APP_E_BASE:-http://localhost:3014}"

# Redis instances are NOT exposed on host ports; the test reads them
# via `docker exec mgmt-poc-redis-X redis-cli HGETALL <ns>:clients`.
# We pass an empty REDIS_URL_* and let the test fall back to docker exec.
export USE_DOCKER_EXEC_FOR_REDIS=1

failures=0
for i in $(seq 1 "$RUNS"); do
  echo ""
  echo "============================================================"
  echo "[e2e] RUN $i / $RUNS"
  echo "============================================================"
  if ! npm test --silent; then
    failures=$((failures + 1))
    echo "[e2e] !!! RUN $i FAILED !!!" >&2
  fi
done

if [ "$failures" -ne 0 ]; then
  echo ""
  echo "[e2e] $failures/$RUNS runs failed" >&2
  exit 1
fi
echo ""
echo "[e2e] ALL $RUNS RUN(S) PASSED"
