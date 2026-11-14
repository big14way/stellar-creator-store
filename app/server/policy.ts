// What the fee sponsor will pay for. Pure functions, so they can be tested
// without a network or a key.

import { Address, xdr } from "@stellar/stellar-sdk";
import { ACCOUNT_WASM_HASH, STORE_ID } from "../src/config";

export type Decoded = { func: xdr.HostFunction; auth: xdr.SorobanAuthorizationEntry[] };

export function decode(body: unknown): Decoded | string {
  if (!body || typeof body !== "object") return "expected { func, auth }";
  const { func, auth } = body as { func?: unknown; auth?: unknown };
  if (typeof func !== "string" || !Array.isArray(auth) || !auth.every((a) => typeof a === "string")) {
    return "expected { func: string, auth: string[] }";
  }
  try {
    return {
      func: xdr.HostFunction.fromXDR(func, "base64"),
      auth: auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")),
    };
  } catch {
    return "func or auth is not valid XDR";
  }
}

/** Store functions we pay fees for, and which argument must be a smart wallet. */
const STORE_CALLS: Record<string, { walletArg?: number; needsAuth: boolean }> = {
  buy: { walletArg: 0, needsAuth: true }, // buyer
  create_product: { walletArg: 0, needsAuth: true }, // creator
  update_product: { needsAuth: true }, // the contract checks it is the creator
  claim: { walletArg: 0, needsAuth: false }, // pays only `to`; no signature needed
};

/** Why this call will not be sponsored, or null if it will. */
export function refusal(
  { func, auth }: Decoded,
  sponsorAddress: string,
  store = STORE_ID,
  walletWasmHash = ACCOUNT_WASM_HASH,
): string | null {
  for (const entry of auth) {
    const signer = addressSigner(entry);
    if (!signer) return "only signed address authorization is sponsored";
    if (signer === sponsorAddress) return "the sponsor never authorizes calls";
  }

  switch (func.switch()) {
    case xdr.HostFunctionType.hostFunctionTypeInvokeContract(): {
      const call = func.invokeContract();
      const contract = Address.fromScAddress(call.contractAddress()).toString();
      const fn = call.functionName().toString();
      const rule = contract === store ? STORE_CALLS[fn] : undefined;
      if (!rule) return `only ${Object.keys(STORE_CALLS).join(", ")} on ${store} are sponsored`;
      if (rule.needsAuth && auth.length === 0) return "no authorization entries";
      if (rule.walletArg !== undefined) {
        const arg = call.args()[rule.walletArg];
        const wallet = arg ? Address.fromScVal(arg).toString() : "";
        if (!wallet.startsWith("C")) return "only smart wallets are sponsored";
      }
      return null;
    }
    case xdr.HostFunctionType.hostFunctionTypeCreateContractV2(): {
      if (auth.length === 0) return "no authorization entries";
      const exec = func.createContractV2().executable();
      if (exec.switch() !== xdr.ContractExecutableType.contractExecutableWasm()) {
        return "only wallet code can be deployed";
      }
      if (exec.wasmHash().toString("hex") !== walletWasmHash) return "only the approved wallet code is sponsored";
      return null;
    }
    default:
      return "unsupported host function";
  }
}

/** Smart wallets that signed these entries. A successful transaction proves the submitter holds their passkeys. */
export function walletSigners(auth: xdr.SorobanAuthorizationEntry[]): string[] {
  return auth.map(addressSigner).filter((a): a is string => !!a && a.startsWith("C"));
}

/** The store function and its decoded wallet argument, for bookkeeping after success. */
export function storeCall(func: xdr.HostFunction): { fn: string; args: xdr.ScVal[] } | null {
  if (func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) return null;
  const call = func.invokeContract();
  return { fn: call.functionName().toString(), args: call.args() };
}

/**
 * The address that signed this entry, for address credentials (V1 or V2).
 * Null for source-account credentials, which the transaction source (our
 * sponsor) would implicitly grant, and for delegated credentials.
 */
function addressSigner(entry: xdr.SorobanAuthorizationEntry): string | null {
  const creds = entry.credentials();
  switch (creds.switch()) {
    case xdr.SorobanCredentialsType.sorobanCredentialsAddress():
      return Address.fromScAddress(creds.address().address()).toString();
    case xdr.SorobanCredentialsType.sorobanCredentialsAddressV2():
      return Address.fromScAddress(creds.addressV2().address()).toString();
    default:
      return null;
  }
}
