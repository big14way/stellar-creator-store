# Creator Store on Stellar

**Sell digital products to buyers anywhere. Get paid in dollars on Stellar the moment a sale happens.**

Built for the Stellar Buildathon for Builder's Circle members in Nigeria and Ghana.

> Status: the split contract is built, unit-tested and running on testnet with Circle's testnet USDC. The web app is next.

## The problem

Creators in Nigeria and Ghana (designers, tutors, coders, musicians) earn by selling templates, courses, ebooks and beats. The demand is proven: Selar reports paying out about ₦18 billion to roughly 400,000 creators in 2025.

Getting paid is still slow and lossy:

- payouts wait for processing and stall at weekends
- sales to buyers abroad lose value when converted to naira or cedis
- affiliates who bring in sales wait for their share

Creators want to earn in a stable currency, from buyers in any country, and be paid instantly.

## How it works

1. A creator signs in with a passkey and lists a product: the file, a price in USD, and optional co-creator and affiliate shares.
2. A buyer opens the product link and pays in USDC, with a passkey smart wallet or a Stellar wallet they already have.
3. A Soroban contract splits the payment in the same transaction: creator, co-creators, affiliate and platform fee, each paid straight to their wallet.
4. The sale recorded on-chain is the buyer's receipt and unlocks the download.
5. The creator keeps their earnings in dollars or cashes out small amounts to naira through a Stellar anchor.

## Stellar pieces

| Piece | What it does here |
|---|---|
| USDC on Stellar | Prices and settlement |
| Soroban contract | Splits each sale in one transaction and records the sale |
| Passkeys and smart wallets | Sign-in with a fingerprint or face, no seed phrase; the app pays the network fees |
| Stellar Wallets Kit | Checkout for buyers who already use a Stellar wallet |
| SEP-24 anchor (LINK NGNC) | Naira cash-out for small amounts |

## The contract

[`contracts/store`](contracts/store/src/lib.rs) (Rust, Soroban SDK 29). One contract holds every product.

- `create_product(creator, price, shares, affiliate_bps)` lists a product with up to 5 co-creators, each on a fixed share. The platform fee in force at that moment is locked into the product.
- `buy(buyer, product_id, affiliate)` takes the price from the buyer in one transfer and, in the same transaction, pays the platform fee, the co-creators, the affiliate and the creator. The creator gets the remainder, so rounding never loses a unit. It stores the receipt that unlocks the download and refuses a second payment for the same product.
- If a recipient's wallet can't receive USDC yet (no trustline, or frozen), their share is held in the contract instead of failing the sale. `claim(to)` pays it once they can receive.
- `update_product` changes the price or pauses sales. Shares can't be changed after listing, so a creator can't cut a co-creator out.
- Admin: `set_fee` (capped at 10%, new listings only), `set_admin`, `upgrade`.

### Run it

```sh
cargo test                  # 19 unit tests
stellar contract build
./scripts/testnet-e2e.sh    # deploys a store on testnet and runs a real sale
```

### On testnet

Last run, 14 Nov 2026: Circle's testnet USDC, 5% platform fee, a 10 USDC product with a 20% co-creator and a 10% affiliate. The co-creator had no USDC trustline yet.

| | USDC |
|---|---|
| Buyer paid | 10.00 |
| Platform fee | 0.50 |
| Affiliate | 1.00 |
| Creator | 6.50 |
| Co-creator: held at sale, claimed after adding a trustline | 2.00 |

- Store contract: [`CD6MR5EW…A3ZU`](https://stellar.expert/explorer/testnet/contract/CD6MR5EWSIJ6GOMKZ6UUP53SECPCMU6LRA7PW3XYBUMGCM3AQ5YAA3ZU)
- Sale: [`972038f5…a0e7`](https://stellar.expert/explorer/testnet/tx/972038f5914edad8c8ac96eb2cae80e7eb7ade599af8734ded4a24983143a0e7)
- Claim: [`d40f1241…2105`](https://stellar.expert/explorer/testnet/tx/d40f124171bc41492c0f176e92ae6767be3ee0a43fb6f6ea87adc297d5d92105)

## Build week plan

| Day | Goal |
|---|---|
| 1 | Split contract and its tests on testnet (done) |
| 2 | Product listing and passkey sign-in |
| 3 | USDC checkout; the download unlocks from the sale record |
| 4 | Affiliate links and co-creator shares |
| 5 | Creator dashboard: sales, balance, cash-out |
| 6 | First creators list real products; first small sales on mainnet |
| 7 | Fixes from users; demo and numbers for the showcase |

## Business model

A percentage of each sale, taken by the contract at checkout and set below what creator platforms charge today.

## After the buildathon

- Card checkout for buyers without crypto
- Larger naira cash-out through a payout partner
- Creators in Ghana and Kenya

## License

MIT
