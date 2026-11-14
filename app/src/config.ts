// Public network configuration. Nothing here is secret.
//
// Testnet by default. For mainnet, build and run with NETWORK=mainnet
// (VITE_NETWORK=mainnet for the web app), plus the store you deployed and a
// mainnet RPC: STORE_ID / VITE_STORE_ID and RPC_URL / VITE_RPC_URL.

import { Asset } from "@stellar/stellar-sdk";

/** A setting from the server's environment, or the web app's VITE_ build variables. */
function setting(name: string): string | undefined {
  const fromServer = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const fromBuild = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[`VITE_${name}`];
  return fromServer || fromBuild || undefined;
}

type Network = {
  passphrase: string;
  rpc: string;
  /** The public smart-account indexer (smart-account-kit's default for the network). */
  indexer: string;
  horizon: string;
  explorer: string;
  friendbot: string | null;
  usdcIssuer: string;
  store: string;
  /** OpenZeppelin stellar-accounts v0.8.0 WebAuthn verifier. */
  webauthnVerifier: string;
  /** The anchor for cash-out, or null for none. */
  anchor: string | null;
};

const NETWORKS: Record<"testnet" | "mainnet", Network> = {
  testnet: {
    passphrase: "Test SDF Network ; September 2015",
    rpc: "https://soroban-testnet.stellar.org",
    indexer: "https://testnet.mercurydata.app/rest/smart-account-indexer",
    horizon: "https://horizon-testnet.stellar.org",
    explorer: "https://stellar.expert/explorer/testnet",
    friendbot: "https://friendbot.stellar.org",
    // Circle's testnet USDC (issuer from centre.io's stellar.toml).
    usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    // Our store contract on testnet (see the README).
    store: "CD6MR5EWSIJ6GOMKZ6UUP53SECPCMU6LRA7PW3XYBUMGCM3AQ5YAA3ZU",
    // smart-account-kit docs/deployments-protocol-27-2026-07-09.md, testnet.
    webauthnVerifier: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
    // The SDF test anchor: SEP-45 sign-in for contract accounts, SEP-24 USDC withdrawals, simulated payout.
    anchor: "testanchor.stellar.org",
  },
  mainnet: {
    passphrase: "Public Global Stellar Network ; September 2015",
    rpc: "",
    indexer: "https://mainnet.mercurydata.app/rest/smart-account-indexer",
    horizon: "https://horizon.stellar.org",
    explorer: "https://stellar.expert/explorer/public",
    friendbot: null,
    // Circle's USDC (issuer from centre.io's stellar.toml).
    usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    store: "",
    // smart-account-kit docs/deployments-stellar-accounts-0.8-2026-10-25.md, mainnet.
    webauthnVerifier: "CB7HENHJ7NF34I5FFXQK7D5I3WWQRGB5O5XO77D3NXMT7LM7LOKRQ5YR",
    // No naira anchor accepts contract (passkey) accounts yet; see the README.
    anchor: null,
  },
};

export const NETWORK = setting("NETWORK") === "mainnet" ? "mainnet" : "testnet";
const net = NETWORKS[NETWORK];

export const RPC_URL = setting("RPC_URL") ?? net.rpc;
export const HORIZON_URL = net.horizon;
export const INDEXER_URL = net.indexer;
export const NETWORK_PASSPHRASE = net.passphrase;
export const EXPLORER = net.explorer;
export const FRIENDBOT_URL = net.friendbot;

// OpenZeppelin smart account (stellar-accounts v0.8.0), the same code hash on
// both networks. Source: stellar/smart-account-kit,
// docs/deployments-stellar-accounts-0.8-2026-10-25.md.
export const ACCOUNT_WASM_HASH = "c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1";
export const WEBAUTHN_VERIFIER = net.webauthnVerifier;

export const STORE_ID = setting("STORE_ID") ?? net.store;

export const USDC_CODE = "USDC";
export const USDC_ISSUER = net.usdcIssuer;
/** USDC's Stellar Asset Contract, derived from the asset and the network. */
export const USDC_ID = new Asset(USDC_CODE, USDC_ISSUER).contractId(NETWORK_PASSPHRASE);
export const USDC_DECIMALS = 7;

export const ANCHOR_DOMAIN = setting("ANCHOR_DOMAIN") ?? net.anchor;

if (!RPC_URL || !STORE_ID) {
  throw new Error(`Set RPC_URL and STORE_ID for ${NETWORK} (VITE_RPC_URL and VITE_STORE_ID for the web app).`);
}
