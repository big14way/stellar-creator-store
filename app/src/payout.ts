import { Account, MuxedAccount, StrKey } from "@stellar/stellar-sdk";
import { HORIZON_URL, NETWORK, USDC_ISSUER } from "./config";

/**
 * Where a creator's USDC goes when they cash out: a classic Stellar account they hold the keys
 * to (LOBSTR, Freighter), or an exchange's deposit account with its number memo folded into an
 * M-address. Passkey wallets can only attach a memo that way, so text memos are refused.
 */
export type Payout = {
  /** What the transfer is sent to: the G-address, or the M-address when there is a memo. */
  address: string;
  /** The classic account that receives the USDC (the G-address under an M-address). */
  account: string;
  /** The exchange's memo ID, when there is one. */
  memoId: string | null;
};

const U64_MAX = 18446744073709551615n;

/** Reads what a creator typed: a G-address, a G-address and an exchange's number memo, or an M-address. */
export function parsePayout(addressInput: string, memoInput = ""): Payout | { error: string } {
  const address = addressInput.trim().toUpperCase();
  const memo = memoInput.trim();
  if (!address) return { error: "Enter a Stellar address." };
  if (StrKey.isValidContract(address)) {
    return { error: "That is a smart-wallet address (C…). Use a classic Stellar address (G…) from LOBSTR, Freighter or your exchange." };
  }
  if (StrKey.isValidMed25519PublicKey(address)) {
    if (memo) return { error: "This M… address already carries its memo. Leave the memo empty." };
    const muxed = MuxedAccount.fromAddress(address, "0");
    return { address, account: muxed.baseAccount().accountId(), memoId: muxed.id() };
  }
  if (!StrKey.isValidEd25519PublicKey(address)) return { error: "That is not a Stellar address. It starts with G and is 56 characters long." };
  if (!memo) return { address, account: address, memoId: null };
  if (!/^\d{1,20}$/.test(memo) || BigInt(memo) > U64_MAX) {
    return {
      error:
        "This memo has letters in it or is too long. A passkey wallet can only attach a number memo. Send to your own G wallet first, then on to the exchange with this memo.",
    };
  }
  const id = BigInt(memo).toString();
  return { address: new MuxedAccount(new Account(address, "0"), id).accountId(), account: address, memoId: id };
}

export type PayoutCheck = { ok: true } | { ok: false; problem: string };

type HorizonAccount = { balances: { asset_code?: string; asset_issuer?: string; is_authorized?: boolean }[] };

/** Asks Stellar whether the account exists and can hold Circle's USDC, so a payout won't bounce. */
export async function checkPayout(account: string, get: typeof fetch = fetch): Promise<PayoutCheck> {
  const res = await get(`${HORIZON_URL}/accounts/${account}`);
  if (res.status === 404) {
    return {
      ok: false,
      problem:
        NETWORK === "testnet"
          ? "This account does not exist on Stellar testnet yet. Fund it with Friendbot first."
          : "This account does not exist on Stellar yet. It needs at least 1 XLM before it can receive USDC.",
    };
  }
  if (!res.ok) throw new Error(`could not reach Stellar (${res.status})`);
  const { balances } = (await res.json()) as HorizonAccount;
  const usdc = balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER);
  if (!usdc) {
    return {
      ok: false,
      problem: "This account does not hold USDC yet. Add USDC (issued by Circle) in your wallet app first, or the payment would fail.",
    };
  }
  if (usdc.is_authorized === false) return { ok: false, problem: "Circle has not authorised USDC on this account." };
  return { ok: true };
}
