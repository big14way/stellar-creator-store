// Cash out through a Stellar anchor, from a passkey wallet:
//
// 1. SEP-1: read the anchor's stellar.toml.
// 2. SEP-45: sign in with the passkey wallet (a contract account) by signing
//    the anchor's authorization entry.
// 3. SEP-24: open the anchor's own form (bank details, KYC), then pay it the
//    USDC with a token transfer the store sponsors. A memo ID travels inside a
//    muxed (M...) address, since contract payments carry no transaction memo.

import { Account, Address, MuxedAccount, rpc, scValToNative, StellarToml, xdr } from "@stellar/stellar-sdk";
import { buildDirectTokenTransfer } from "smart-account-kit";
import { ANCHOR_DOMAIN, NETWORK_PASSPHRASE, RPC_URL, USDC_CODE, USDC_ID, USDC_ISSUER } from "./config";
import { explain, getKit } from "./wallet";

type AnchorToml = {
  WEB_AUTH_FOR_CONTRACTS_ENDPOINT?: string;
  WEB_AUTH_CONTRACT_ID?: string;
  TRANSFER_SERVER_SEP0024?: string;
};

export type AnchorTx = {
  id: string;
  status: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: "text" | "id" | "hash";
  more_info_url?: string;
  message?: string;
  stellar_transaction_id?: string;
};

/** Plain words for SEP-24 statuses. */
export const STATUS_TEXT: Record<string, string> = {
  incomplete: "Waiting for you to finish the anchor's form",
  pending_user_transfer_start: "Ready for your USDC",
  pending_user_transfer_complete: "USDC received by the anchor",
  pending_anchor: "The anchor is processing it",
  pending_stellar: "Settling on Stellar",
  pending_external: "On its way to the bank",
  pending_trust: "Waiting on a trustline",
  pending_user: "The anchor needs something from you",
  completed: "Paid out",
  refunded: "Refunded",
  expired: "Expired",
  error: "The anchor reported an error",
  no_market: "No market for this pair",
  too_small: "Below the anchor's minimum",
  too_large: "Above the anchor's maximum",
};

let tomlCache: Promise<AnchorToml> | null = null;
function anchorToml(): Promise<AnchorToml> {
  if (!ANCHOR_DOMAIN) return Promise.reject(new Error("No cash-out anchor is set up on this network yet."));
  tomlCache ??= StellarToml.Resolver.resolve(ANCHOR_DOMAIN) as Promise<AnchorToml>;
  tomlCache.catch(() => (tomlCache = null));
  return tomlCache;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`${ANCHOR_DOMAIN}: ${body.error ?? res.status}`);
  return body;
}

/** SEP-45: signs in to the anchor with the passkey wallet. Returns the anchor's session token. */
export async function anchorSignIn(wallet: string): Promise<string> {
  const { endpoint, body } = await signAnchorChallenge(wallet);
  const { token } = await json<{ token: string }>(
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The spec's name, and the camelCase one the SDF test anchor uses.
      body: JSON.stringify({ authorization_entries: body, authorizationEntries: body }),
    }),
  );
  return token;
}

/** Fetches the anchor's SEP-45 challenge and signs our entry with the passkey. */
export async function signAnchorChallenge(wallet: string): Promise<{ endpoint: string; body: string }> {
  const toml = await anchorToml();
  const domain = ANCHOR_DOMAIN!;
  const endpoint = toml.WEB_AUTH_FOR_CONTRACTS_ENDPOINT;
  if (!endpoint || !toml.WEB_AUTH_CONTRACT_ID) throw new Error(`${ANCHOR_DOMAIN} does not support sign-in for passkey wallets`);

  const url = new URL(endpoint);
  url.searchParams.set("account", wallet);
  url.searchParams.set("home_domain", domain);
  const challenge = await json<{ authorization_entries?: string; authorizationEntries?: string }>(await fetch(url));
  const encoded = challenge.authorization_entries ?? challenge.authorizationEntries;
  if (!encoded) throw new Error("the anchor sent no challenge");
  const entries = xdr.SorobanAuthorizationEntries.fromXDR(encoded, "base64") as xdr.SorobanAuthorizationEntry[];

  // Sign only what we expect: web_auth_verify on the anchor's contract, for this wallet and this anchor.
  const signed: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of entries) {
    const fn = entry.rootInvocation().function();
    if (fn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()) {
      throw new Error("unexpected challenge from the anchor");
    }
    const call = fn.contractFn();
    const contract = Address.fromScAddress(call.contractAddress()).toString();
    if (contract !== toml.WEB_AUTH_CONTRACT_ID || call.functionName().toString() !== "web_auth_verify") {
      throw new Error("unexpected challenge from the anchor");
    }
    const args = (call.args()[0] ? scValToNative(call.args()[0]) : {}) as Record<string, string>;
    if (args.account !== wallet || args.home_domain !== domain) {
      throw new Error("the anchor's challenge is for another account or domain");
    }
    const creds = entry.credentials();
    const isOurs =
      creds.switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress() &&
      Address.fromScAddress(creds.address().address()).toString() === wallet;
    // Sign under the wallet's default rule (id 0). The anchor leaves the expiry
    // at 0 for the client to set; the kit then uses its own (about an hour).
    // (As base64, so the kit's XDR objects never mix with ours.)
    const expiry = isOurs ? creds.address().signatureExpirationLedger() : 0;
    signed.push(
      isOurs
        ? xdr.SorobanAuthorizationEntry.fromXDR(
            await getKit().signAuthEntry(entry.toXDR("base64"), {
              contextRuleIds: [0],
              ...(expiry > 0 ? { expiration: expiry } : {}),
            }),
            "base64",
          )
        : entry,
    );
  }

  return { endpoint, body: encodeEntries(signed) };
}

/**
 * An XDR array of authorization entries: a 4-byte count, then each entry.
 * (The SDK's own encoder for this type throws "value is not array".)
 */
function encodeEntries(entries: xdr.SorobanAuthorizationEntry[]): string {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(entries.length);
  return Buffer.concat([count, ...entries.map((e) => e.toXDR())]).toString("base64");
}

/** SEP-24: starts a USDC withdrawal and returns the anchor's form URL. */
export async function startWithdrawal(token: string, wallet: string, amount: string): Promise<{ id: string; url: string }> {
  const { TRANSFER_SERVER_SEP0024: server } = await anchorToml();
  if (!server) throw new Error(`${ANCHOR_DOMAIN} has no SEP-24 server`);
  return json<{ id: string; url: string }>(
    await fetch(`${server}/transactions/withdraw/interactive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ asset_code: USDC_CODE, asset_issuer: USDC_ISSUER, account: wallet, amount, lang: "en" }),
    }),
  );
}

export async function withdrawal(token: string, id: string): Promise<AnchorTx> {
  const { TRANSFER_SERVER_SEP0024: server } = await anchorToml();
  const { transaction } = await json<{ transaction: AnchorTx }>(
    await fetch(`${server}/transaction?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }),
  );
  return transaction;
}

/** Where to send the USDC: the anchor's account, with a memo ID folded into an M-address. */
export function payee(tx: AnchorTx): string {
  if (!tx.withdraw_anchor_account) throw new Error("the anchor has not given an account to pay yet");
  if (!tx.withdraw_memo) return tx.withdraw_anchor_account;
  if (tx.withdraw_memo_type !== "id") {
    throw new Error(`This anchor wants a ${tx.withdraw_memo_type} memo, which a passkey wallet can't attach. Use an anchor that accepts memo IDs.`);
  }
  return new MuxedAccount(new Account(tx.withdraw_anchor_account, "0"), tx.withdraw_memo).accountId();
}

/** Sends USDC from the passkey wallet (to an anchor, or any address). The store's sponsor pays the network fee. */
export async function sendUsdc(wallet: string, to: string, amountUnits: bigint): Promise<string> {
  const server = new rpc.Server(RPC_URL);
  const tx = await buildDirectTokenTransfer(
    { networkPassphrase: NETWORK_PASSPHRASE, rpc: server, timeoutInSeconds: 60 },
    USDC_ID,
    wallet,
    to,
    amountUnits,
  );
  const res = await getKit().signAndSubmit(tx);
  if (!res.success) throw new Error(explain(res.error.message));
  return res.hash!;
}
