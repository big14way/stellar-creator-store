#!/usr/bin/env bash
# End-to-end run of the store contract on Stellar testnet with Circle's
# testnet USDC. Deploys a fresh store, lists a product with a co-creator and
# an affiliate share, buys it, and checks every balance.
#
# The co-creator starts without a USDC trustline, so their share cannot be
# delivered: the sale must still go through, the share must be held, and
# `claim` must pay it once the trustline exists.
#
# Needs: stellar CLI, and the wasm built with `stellar contract build`.
# Test identities live in the stellar CLI config, never in this repo.
set -euo pipefail
cd "$(dirname "$0")/.."

NET=testnet
# Circle's testnet USDC (issuer's stellar.toml is on centre.io)
USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
USDC="USDC:$USDC_ISSUER"
ONE=10000000 # 1 USDC in its smallest unit
PRICE=$((10 * ONE))
WASM=target/wasm32v1-none/release/creator_store.wasm
RUN=$(date +%Y%m%d%H%M%S)
CO="cs-co-$RUN" # fresh each run so it starts with no trustline

say() { printf '\n== %s\n' "$*"; }
addr() { stellar keys address "$1"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

ensure_key() {
  if ! stellar keys address "$1" >/dev/null 2>&1; then
    stellar keys generate "$1" --network "$NET" --fund >/dev/null
  else
    stellar keys fund "$1" --network "$NET" >/dev/null 2>&1 || true
  fi
}

trust_usdc() {
  stellar tx new change-trust --source "$1" --line "$USDC" --network "$NET" >/dev/null
}

read_call() { # read-only contract call, result on stdout without quotes
  stellar contract invoke --id "$1" --source cs-admin --network "$NET" --send=no -- "${@:2}" 2>/dev/null | tr -d '"'
}

balance() { read_call "$SAC" balance --id "$1"; }

[ -f "$WASM" ] || fail "build first: stellar contract build"

say "identities"
for who in cs-admin cs-platform cs-creator cs-affiliate cs-buyer "$CO"; do
  ensure_key "$who"
  printf '%-22s %s\n' "$who" "$(addr "$who")"
done

say "USDC trustlines (not for the co-creator)"
for who in cs-platform cs-creator cs-affiliate cs-buyer; do trust_usdc "$who"; done

SAC=$(stellar contract id asset --asset "$USDC" --network "$NET")
echo "USDC contract $SAC"

say "buyer gets USDC by swapping testnet XLM on the DEX"
have=$(balance "$(addr cs-buyer)")
if [ "$have" -lt "$PRICE" ]; then
  stellar tx new path-payment-strict-receive --source cs-buyer --network "$NET" \
    --send-asset native --send-max $((400 * ONE)) \
    --destination "$(addr cs-buyer)" --dest-asset "$USDC" --dest-amount $((12 * ONE)) >/dev/null
fi
echo "buyer USDC: $(balance "$(addr cs-buyer)")"

say "deploy the store (5% platform fee)"
STORE=$(stellar contract deploy --wasm "$WASM" --source cs-admin --network "$NET" --alias creator-store -- \
  --admin "$(addr cs-admin)" --token "$SAC" --fee_bps 500 --fee_to "$(addr cs-platform)" 2>/dev/null)
echo "store $STORE"

say "creator lists a 10 USDC product: co-creator 20%, affiliate 10%"
PRODUCT=$(stellar contract invoke --id "$STORE" --source cs-creator --network "$NET" -- create_product \
  --creator "$(addr cs-creator)" --price "$PRICE" \
  --shares "[{\"to\":\"$(addr "$CO")\",\"bps\":2000}]" --affiliate_bps 1000 2>/dev/null)
echo "product $PRODUCT"

before_platform=$(balance "$(addr cs-platform)")
before_creator=$(balance "$(addr cs-creator)")
before_affiliate=$(balance "$(addr cs-affiliate)")
before_buyer=$(balance "$(addr cs-buyer)")

say "buyer pays through the affiliate's link"
stellar contract invoke --id "$STORE" --source cs-buyer --network "$NET" -- buy \
  --buyer "$(addr cs-buyer)" --product_id "$PRODUCT" --affiliate "\"$(addr cs-affiliate)\"" 2>/dev/null
echo

d_platform=$(($(balance "$(addr cs-platform)") - before_platform))
d_creator=$(($(balance "$(addr cs-creator)") - before_creator))
d_affiliate=$(($(balance "$(addr cs-affiliate)") - before_affiliate))
d_buyer=$((before_buyer - $(balance "$(addr cs-buyer)")))
held=$(read_call "$STORE" owed --to "$(addr "$CO")")
in_store=$(balance "$STORE")

printf 'buyer paid      %s\nplatform got    %s\ncreator got     %s\naffiliate got   %s\nheld for co     %s\nstore holds     %s\n' \
  "$d_buyer" "$d_platform" "$d_creator" "$d_affiliate" "$held" "$in_store"

[ "$d_buyer" -eq "$PRICE" ] || fail "buyer should pay exactly 10 USDC"
[ "$d_platform" -eq $((PRICE * 5 / 100)) ] || fail "platform should get 5%"
[ "$d_affiliate" -eq $((PRICE / 10)) ] || fail "affiliate should get 10%"
[ "$d_creator" -eq $((PRICE * 65 / 100)) ] || fail "creator should get 65%"
[ "$held" -eq $((PRICE / 5)) ] || fail "co-creator's 20% should be held"
[ "$in_store" -eq "$held" ] || fail "store should hold only the undelivered share"
[ "$(read_call "$STORE" has_purchased --product_id "$PRODUCT" --buyer "$(addr cs-buyer)")" = "true" ] ||
  fail "receipt missing"

say "co-creator adds a USDC trustline and claims"
trust_usdc "$CO"
stellar contract invoke --id "$STORE" --source "$CO" --network "$NET" -- claim --to "$(addr "$CO")" 2>/dev/null
echo
[ "$(balance "$(addr "$CO")")" -eq $((PRICE / 5)) ] || fail "co-creator should now hold 2 USDC"
[ "$(read_call "$STORE" owed --to "$(addr "$CO")")" -eq 0 ] || fail "nothing should be owed after claim"
[ "$(balance "$STORE")" -eq 0 ] || fail "store should be empty"
echo "co-creator USDC: $(balance "$(addr "$CO")"), store holds: $(balance "$STORE")"

say "paying twice is refused"
if out=$(stellar contract invoke --id "$STORE" --source cs-buyer --network "$NET" -- buy \
  --buyer "$(addr cs-buyer)" --product_id "$PRODUCT" 2>&1); then
  fail "second purchase should fail"
fi
grep -q "Error(Contract, #8)" <<<"$out" || fail "expected AlreadyPurchased (#8), got: $out"
echo "refused with AlreadyPurchased"

say "PASS: store $STORE, product $PRODUCT"
