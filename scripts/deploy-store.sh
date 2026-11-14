#!/usr/bin/env bash
# Deploys the store contract on testnet or mainnet, priced in Circle's USDC.
#
#   ./scripts/deploy-store.sh testnet cs-admin cs-platform
#   ./scripts/deploy-store.sh mainnet <admin identity> <fee account identity>
#
# The admin identity pays for the deploy (a few XLM on mainnet) and can later
# change the fee (capped at 10% by the contract) or upgrade the code. The fee
# account receives the platform fee. Identities live in the stellar CLI's
# config, never in this repo. Prints the new store's contract id: set it as
# STORE_ID (and VITE_STORE_ID for the web app) for that network.
set -euo pipefail
cd "$(dirname "$0")/.."

NET=${1:?network: testnet or mainnet}
ADMIN=${2:?admin identity}
FEE_TO=${3:?fee account identity}
FEE_BPS=${FEE_BPS:-500}

case "$NET" in
  testnet) USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 ;; # centre.io stellar.toml
  mainnet) USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN ;; # centre.io stellar.toml
  *) echo "network must be testnet or mainnet" >&2; exit 1 ;;
esac

stellar contract build >/dev/null
WASM=target/wasm32v1-none/release/creator_store.wasm

# The USDC Stellar Asset Contract: deploy it if nobody has yet (it is the same id for everyone).
USDC_SAC=$(stellar contract id asset --asset "USDC:$USDC_ISSUER" --network "$NET")
stellar contract asset deploy --asset "USDC:$USDC_ISSUER" --source "$ADMIN" --network "$NET" >/dev/null 2>&1 || true

STORE=$(stellar contract deploy --wasm "$WASM" --source "$ADMIN" --network "$NET" -- \
  --admin "$(stellar keys address "$ADMIN")" \
  --token "$USDC_SAC" \
  --fee_bps "$FEE_BPS" \
  --fee_to "$(stellar keys address "$FEE_TO")")

echo "store   $STORE"
echo "usdc    $USDC_SAC"
echo "fee     $FEE_BPS bps to $(stellar keys address "$FEE_TO")"
