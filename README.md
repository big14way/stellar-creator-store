# Creator Store on Stellar

**Sell digital products to buyers anywhere. Get paid in dollars on Stellar the moment a sale happens.**

Built for the Stellar Buildathon for Builder's Circle members in Nigeria and Ghana.

> Status: on testnet, a creator can list a product and a buyer can pay with a passkey wallet and download it, with Circle's testnet USDC. Next: design pass, naira cash-out, mainnet.

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

## The app

[`app/`](app) is the web app (Vite, React, TypeScript) and its server (Hono on Node), built on Stellar's [smart-account-kit](https://github.com/stellar/smart-account-kit) and OpenZeppelin smart accounts.

- **Sell:** a creator creates a wallet with a passkey (fingerprint or face, no seed phrase), uploads the file and a cover, sets a price, an affiliate share and any co-creators, and signs the listing. The page shows the split before they list.
- **Buy:** the product page takes a buyer from no wallet to paid in a few taps. They pay in USDC only; the wallet never needs XLM.
- **Download:** the purchase unlocks the file at once, plus a private download link that works on any device, as on Gumroad or Selar. The server checks the on-chain receipt before serving it.
- **Affiliates:** anyone with a wallet gets a `?ref=` link and is paid their share the moment a referred sale happens.
- **Dashboard:** balance, sales, products, and claiming any share held for the creator.
- **Testnet faucet:** a "Get 10 test USDC" button, so anyone can try a purchase.

The look is a warm shop at night with cream paper receipts: Gabarito, Manrope and Azeret Mono (Google Fonts, OFL), Lucide icons (ISC), and our own logo, covers and receipts drawn in CSS and SVG. The receipts and the sales ticker show real sales from the store, each linked to its transaction.

### Fees and trust

The server's sponsor account pays every network fee ([`server/sponsor.ts`](app/server/sponsor.ts)). It pays only for creating a passkey wallet from the approved wallet code and for `buy`, `create_product`, `update_product` and `claim` on our store from a smart wallet. It refuses anything the sponsor would authorize just by paying the fee, and caps the fee per transaction ([rules](app/server/policy.ts), [tests](app/tests/policy.test.ts)).

The server knows a browser controls a wallet once that browser has submitted, through the server, a transaction the wallet signed with its passkey and which succeeded on chain. That lets a creator attach details to their own listing and a buyer fetch their own download link.

### Run it

```sh
cd app
pnpm install
pnpm test        # sponsor rules
pnpm test:e2e    # the whole store on testnet, in headless Chromium with virtual passkeys
```

`test:e2e` starts the server and the app. A creator creates a passkey wallet and lists a 300 KB file for 3 USDC with a 10% affiliate share. A buyer opens it through an affiliate link, creates a passkey wallet, takes 10 USDC from the faucet, pays and downloads. It checks:

- the bytes match the upload
- the saved link works in another browser
- a browser that didn't buy gets no link, and a forged link is refused
- the dashboard shows $2.55 and 1 sale
- on chain: creator 2.55, affiliate 0.30, buyer 7 of 10 USDC left, and no XLM in either wallet

All 13 checks passed on 14 Nov 2026.

To try it yourself with your own fingerprint or face:

```sh
SPONSOR_SECRET=$(stellar keys show cs-sponsor) FAUCET_SECRET=$(stellar keys show cs-faucet) pnpm api   # terminal 1
pnpm dev                                                                                            # terminal 2
```

Then open http://localhost:5173.

## Build week plan

| Day | Goal |
|---|---|
| 1 | Split contract and its tests on testnet (done) |
| 2 | Product listing and passkey sign-in (done) |
| 3 | USDC checkout; the download unlocks from the sale record (done) |
| 4 | Affiliate links and co-creator shares (done) |
| 5 | Creator dashboard: sales, balance, cash-out (dashboard done; cash-out next) |
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
