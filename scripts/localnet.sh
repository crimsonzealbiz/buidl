#!/usr/bin/env bash
# Starts a local Solana validator with the vendored Solana Attestation Service
# program at its real program id. Requires the Agave CLI (solana-test-validator).
set -euo pipefail
cd "$(dirname "$0")/.."
SAS_ID=22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG
mkdir -p .data
exec solana-test-validator \
  --reset \
  --quiet \
  --ledger .data/test-ledger \
  --rpc-port "${LOCALNET_RPC_PORT:-8899}" \
  --bpf-program "$SAS_ID" vendor/sas/solana_attestation_service.so \
  "$@"
