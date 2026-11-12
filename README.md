# Creator Store on Stellar

**Sell digital products to buyers anywhere. Get paid in dollars on Stellar the moment a sale happens.**

Built for the Stellar Buildathon for Builder's Circle members in Nigeria and Ghana.

> Status: design stage. This README is the plan; the code lands during the build week.

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

## Build week plan

| Day | Goal |
|---|---|
| 1 | Split contract and its tests on testnet |
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
