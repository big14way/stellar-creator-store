// Public testnet configuration. Nothing here is secret.

export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

// OpenZeppelin smart account (stellar-accounts v0.8.0) and its WebAuthn
// verifier, as deployed on testnet. Source: stellar/smart-account-kit,
// docs/deployments-stellar-accounts-0.8-2026-10-25.md and demo/.env.example.
export const ACCOUNT_WASM_HASH =
  "c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1";
export const WEBAUTHN_VERIFIER = "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";

// Our store contract on testnet (see the README's testnet section).
export const STORE_ID = "CD6MR5EWSIJ6GOMKZ6UUP53SECPCMU6LRA7PW3XYBUMGCM3AQ5YAA3ZU";

// Circle's testnet USDC, wrapped as a Stellar Asset Contract.
export const USDC_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const USDC_DECIMALS = 7;
