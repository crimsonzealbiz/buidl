#!/usr/bin/env bash
# Runs the browser end-to-end flow against a local validator.
# Requires: `npm run localnet` running in another terminal, Agave CLI on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=${LOCALNET_RPC_URL:-http://127.0.0.1:8899}
PORT=${E2E_PORT:-3100}
STUB_PORT=${E2E_STUB_PORT:-4010}
mkdir -p .data
rm -rf .data/e2e-pglite .data/e2e-shots
[ -f .data/e2e-issuer.json ] || npx tsx scripts/new-issuer-key.ts .data/e2e-issuer.json
solana airdrop 10 "$(solana-keygen pubkey .data/e2e-issuer.json)" --url "$RPC" >/dev/null

export SOLANA_CLUSTER=localnet SOLANA_RPC_URL="$RPC"
export ISSUER_SECRET_KEY="$(cat .data/e2e-issuer.json)"
export DATABASE_URL="$PWD/.data/e2e-pglite"
export APP_URL="http://127.0.0.1:$PORT"
export SESSION_SECRET="e2e-only-session-secret"
export GITHUB_CLIENT_ID=e2e GITHUB_CLIENT_SECRET=e2e
export GITHUB_WEB_URL="http://127.0.0.1:$STUB_PORT" GITHUB_API_URL="http://127.0.0.1:$STUB_PORT"
export ADMIN_GITHUB_LOGINS=olivia
export NEXT_TELEMETRY_DISABLED=1

npm run -s sas:setup
npx next build >/dev/null
setsid node node_modules/next/dist/bin/next start -p "$PORT" -H 127.0.0.1 > .data/e2e-app.log 2>&1 &
APP_PID=$!
trap 'kill -- -$APP_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "$APP_URL" >/dev/null && break; sleep 1; done
E2E_APP_URL="$APP_URL" E2E_STUB_PORT="$STUB_PORT" E2E_SHOTS="$PWD/.data/e2e-shots" npx tsx tests/e2e/ui-flow.ts
