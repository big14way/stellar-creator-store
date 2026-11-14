// Buyers who already have a Stellar wallet (Freighter, LOBSTR, xBull, Albedo,
// Hana, Rabet and others) pay from it through Stellar Wallets Kit. The wallet
// signs the purchase as its own transaction; our server wraps it in a
// fee-bump transaction, so the network fee is ours (see server/policy.ts).

import { Asset, contract, Horizon, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit/types";
import { FRIENDBOT_URL, HORIZON_URL, NETWORK, NETWORK_PASSPHRASE, RPC_URL, STORE_ID, USDC_CODE, USDC_ISSUER } from "./config";
import { explain } from "./wallet";

const KEY = "paperstall.stellar-wallet";

type Remembered = { address: string; walletId: string };

function remembered(): Remembered | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as Remembered | null;
    return value && /^G[A-Z2-7]{55}$/.test(value.address) ? value : null;
  } catch {
    return null;
  }
}

/** A wallet a test harness injects (window.__paperstallTestWallet); never present for real users. */
type TestWallet = { address: string; sign: (xdr: string) => Promise<string> };

function testModule(w: TestWallet): ModuleInterface {
  return {
    moduleType: "HOT_WALLET" as ModuleInterface["moduleType"],
    productId: "paperstall-test",
    productName: "Test wallet",
    productUrl: "https://stellar.org",
    productIcon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    isAvailable: async () => true,
    getAddress: async () => ({ address: w.address }),
    signTransaction: async (xdr: string) => ({ signedTxXdr: await w.sign(xdr), signerAddress: w.address }),
    signAuthEntry: async () => {
      throw new Error("not supported");
    },
    signMessage: async () => {
      throw new Error("not supported");
    },
    getNetwork: async () => ({ network: NETWORK, networkPassphrase: NETWORK_PASSPHRASE }),
  } as ModuleInterface;
}

type Kit = (typeof import("@creit.tech/stellar-wallets-kit/sdk"))["StellarWalletsKit"];
let kitPromise: Promise<Kit> | null = null;

/** Loads the kit on first use, so the store's first paint doesn't wait for every wallet's code. */
function kit(): Promise<Kit> {
  kitPromise ??= (async () => {
    const [{ StellarWalletsKit }, { defaultModules }] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit/sdk"),
      import("@creit.tech/stellar-wallets-kit/modules/utils"),
    ]);
    const test = (window as unknown as { __paperstallTestWallet?: TestWallet }).__paperstallTestWallet;
    const modules = [...(test ? [testModule(test)] : []), ...defaultModules()];
    StellarWalletsKit.init({
      modules,
      network: NETWORK_PASSPHRASE as never,
      selectedWalletId: remembered()?.walletId,
      authModal: { showInstallLabel: true },
    });
    return StellarWalletsKit;
  })();
  kitPromise.catch(() => (kitPromise = null));
  return kitPromise;
}

async function sign(address: string, xdr: string): Promise<string> {
  const k = await kit();
  const saved = remembered();
  if (saved) k.setWallet(saved.walletId);
  try {
    const { signedTxXdr } = await k.signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE, address });
    return signedTxXdr;
  } catch (err) {
    throw new Error(explain(errorText(err)));
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

export const stellarWallets = {
  remembered: () => remembered()?.address ?? null,

  /** Opens the wallet picker. Null if the buyer closed it. */
  async connect(): Promise<string | null> {
    const k = await kit();
    try {
      const { address } = await k.authModal();
      localStorage.setItem(KEY, JSON.stringify({ address, walletId: k.selectedModule.productId }));
      return address;
    } catch (err) {
      const text = errorText(err);
      if (/closed|cancel|reject|dismiss/i.test(text)) return null;
      throw new Error(text);
    }
  },

  forget() {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    kit()
      .then((k) => k.disconnect())
      .catch(() => {});
  },
};

// ---- the account on Stellar ----

const horizon = new Horizon.Server(HORIZON_URL);
const USDC = new Asset(USDC_CODE, USDC_ISSUER);

export type AccountState =
  | { exists: false }
  | { exists: true; xlm: string; usdc: bigint | null /* null: no USDC trustline */ };

export async function accountState(address: string): Promise<AccountState> {
  let account: Horizon.AccountResponse;
  try {
    account = await horizon.loadAccount(address);
  } catch (err) {
    const e = err as { name?: string; response?: { status?: number } };
    if (e.name === "NotFoundError" || e.response?.status === 404) return { exists: false };
    throw err;
  }
  const xlm = account.balances.find((b) => b.asset_type === "native")?.balance ?? "0";
  const line = account.balances.find(
    (b) => "asset_code" in b && b.asset_code === USDC_CODE && "asset_issuer" in b && b.asset_issuer === USDC_ISSUER,
  ) as { balance: string } | undefined;
  return { exists: true, xlm, usdc: line ? toUnits(line.balance) : null };
}

const toUnits = (balance: string) => {
  const [whole, frac = ""] = balance.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0").slice(0, 7));
};

/** Testnet only: creates the account with test XLM. */
export async function friendbot(address: string) {
  if (!FRIENDBOT_URL) throw new Error("Friendbot is only on testnet");
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`);
  if (!res.ok && res.status !== 400) throw new Error("Friendbot could not fund this account");
}

/** Adds a USDC trustline. The wallet pays the 0.00001 XLM fee and holds the 0.5 XLM reserve. */
export async function addUsdc(address: string) {
  const account = await horizon.loadAccount(address);
  const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(300)
    .build();
  const signed = await sign(address, tx.toXDR());
  await horizon.submitTransaction(TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE));
}

// ---- paying and signing in ----

/** Buys a product from a Stellar wallet. The store pays the network fee with a fee bump. */
export async function buyWithStellar(address: string, productId: bigint, affiliate?: string): Promise<{ hash: string }> {
  const client = await contract.Client.from({ contractId: STORE_ID, networkPassphrase: NETWORK_PASSPHRASE, rpcUrl: RPC_URL, publicKey: address });
  let tx: contract.AssembledTransaction<unknown>;
  try {
    tx = await (client as unknown as { buy: (a: object) => Promise<contract.AssembledTransaction<unknown>> }).buy({
      buyer: address,
      product_id: productId,
      affiliate,
    });
  } catch (err) {
    throw new Error(explain(errorText(err)));
  }
  if (tx.simulation && "error" in tx.simulation) throw new Error(explain(String(tx.simulation.error)));
  const signed = await sign(address, tx.built!.toXDR());
  const res = await fetch("/api/relay/fee-bump", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xdr: signed }),
  });
  const body = (await res.json().catch(() => ({}))) as { hash?: string; error?: string };
  if (!res.ok || !body.hash) throw new Error(explain(body.error ?? `payment failed (${res.status})`));
  return { hash: body.hash };
}

/** Proves to our server that this browser controls `address`, with a challenge the wallet signs. */
export async function stellarSignIn(address: string) {
  const res = await fetch("/api/auth/stellar/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: address }),
  });
  const { xdr, error } = (await res.json()) as { xdr?: string; error?: string };
  if (!xdr) throw new Error(error ?? "could not start sign-in");
  const signed = await sign(address, xdr);
  const done = await fetch("/api/auth/stellar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xdr: signed }),
  });
  if (!done.ok) throw new Error(((await done.json().catch(() => ({}))) as { error?: string }).error ?? "sign-in failed");
}
