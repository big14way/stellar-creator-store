// Read-only contract calls by simulation. Used by both the browser and the server.

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL, STORE_ID, USDC_DECIMALS, USDC_ID } from "./config";

const server = new rpc.Server(RPC_URL);
// Simulation needs a source but never touches it.
const NOBODY = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");

export async function read<T>(contractId: string, fn: string, ...args: xdr.ScVal[]): Promise<T> {
  const tx = new TransactionBuilder(NOBODY, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result!.retval) as T;
}

export const u64 = (n: bigint | number | string) => nativeToScVal(BigInt(n), { type: "u64" });
export const address = (a: string) => Address.fromString(a).toScVal();

export type Share = { to: string; bps: number };
export type ChainProduct = {
  creator: string;
  price: bigint;
  fee_bps: number;
  shares: Share[];
  affiliate_bps: number;
  active: boolean;
  sales: number;
};

/** The product as the contract stores it, or null if there is no such product. */
export async function getProduct(id: bigint | number | string): Promise<ChainProduct | null> {
  try {
    return await read<ChainProduct>(STORE_ID, "product", u64(id));
  } catch (err) {
    if (String(err).includes("Error(Contract, #6)")) return null; // ProductNotFound
    throw err;
  }
}

export const hasPurchased = (id: bigint | number | string, buyer: string) =>
  read<boolean>(STORE_ID, "has_purchased", u64(id), address(buyer));

export const owedTo = (who: string) => read<bigint>(STORE_ID, "owed", address(who));

export const usdcBalance = (who: string) => read<bigint>(USDC_ID, "balance", address(who));

/** 123_456_789n -> "12.35" */
export function formatUsdc(amount: bigint, digits = 2): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const unit = 10n ** BigInt(USDC_DECIMALS - digits);
  const rounded = (abs + unit / 2n) / unit;
  const base = 10n ** BigInt(digits);
  const frac = (rounded % base).toString().padStart(digits, "0");
  return `${negative ? "-" : ""}${rounded / base}${digits > 0 ? `.${frac}` : ""}`;
}

/** "12.5" -> 125_000_000n. Throws on anything that is not a plain positive amount. */
export function parseUsdc(text: string): bigint {
  const m = /^\s*(\d+)(?:\.(\d{1,7}))?\s*$/.exec(text);
  if (!m) throw new Error("Enter an amount like 12 or 12.50");
  const frac = (m[2] ?? "").padEnd(USDC_DECIMALS, "0");
  return BigInt(m[1]) * 10n ** BigInt(USDC_DECIMALS) + BigInt(frac);
}
