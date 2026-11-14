import { contract, rpc, scValToNative } from "@stellar/stellar-sdk";
import { IndexedDBStorage, SmartAccountKit } from "smart-account-kit";
import { ACCOUNT_WASM_HASH, NETWORK_PASSPHRASE, RPC_URL, STORE_ID, WEBAUTHN_VERIFIER } from "./config";

let kit: SmartAccountKit | null = null;

/** One passkey wallet client per page. Fees go through our server's sponsor. */
export function getKit(): SmartAccountKit {
  kit ??= new SmartAccountKit({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    accountWasmHash: ACCOUNT_WASM_HASH,
    webauthnVerifierAddress: WEBAUTHN_VERIFIER,
    relayerUrl: `${window.location.origin}/api/relay`,
    storage: new IndexedDBStorage(),
    rpName: "Creator Store",
  });
  return kit;
}

let storeClient: Promise<contract.Client> | null = null;

/** The store contract's generated client. Simulation uses the sponsor as a placeholder source. */
function store(): Promise<contract.Client> {
  storeClient ??= fetch("/api/relay/info")
    .then((r) => r.json() as Promise<{ sponsor: string }>)
    .then(({ sponsor }) =>
      contract.Client.from({
        contractId: STORE_ID,
        networkPassphrase: NETWORK_PASSPHRASE,
        rpcUrl: RPC_URL,
        publicKey: sponsor,
      }),
    );
  storeClient.catch(() => (storeClient = null));
  return storeClient;
}

type StoreArgs = {
  buy: { buyer: string; product_id: bigint; affiliate?: string };
  create_product: { creator: string; price: bigint; shares: { to: string; bps: number }[]; affiliate_bps: number };
  update_product: { product_id: bigint; price: bigint; active: boolean };
  claim: { to: string };
};

/** Signs a store call with the connected passkey and submits it with the fee sponsored. */
export async function callStore<F extends keyof StoreArgs>(fn: F, args: StoreArgs[F]): Promise<{ hash: string; result: unknown }> {
  const client = (await store()) as unknown as Record<F, (a: StoreArgs[F]) => Promise<contract.AssembledTransaction<unknown>>>;
  let tx: contract.AssembledTransaction<unknown>;
  try {
    tx = await client[fn](args);
  } catch (err) {
    throw new Error(explain(err instanceof Error ? err.message : String(err)));
  }
  const res = await getKit().signAndSubmit(tx);
  if (!res.success) throw new Error(explain(res.error.message));
  const hash = res.hash!;
  const done = await new rpc.Server(RPC_URL).pollTransaction(hash, { attempts: 20, sleepStrategy: () => 1000 });
  const result = done.status === rpc.Api.GetTransactionStatus.SUCCESS && done.returnValue ? scValToNative(done.returnValue) : null;
  return { hash, result };
}

const CONTRACT_ERRORS: Record<string, string> = {
  "#2": "The price must be more than zero.",
  "#3": "A product can have at most 5 co-creators.",
  "#4": "Each co-creator needs a share above 0%, and can't be you or appear twice.",
  "#5": "The shares add up to more than 100%.",
  "#6": "That product doesn't exist.",
  "#7": "This product is paused by its creator.",
  "#8": "You already own this product.",
  "#9": "Nothing to claim.",
};

/** Turns a contract or token error into a sentence a buyer can act on. */
export function explain(message: string): string {
  const store = /Error\(Contract, (#\d+)\)/.exec(message);
  if (store && message.includes(STORE_ID) && CONTRACT_ERRORS[store[1]]) return CONTRACT_ERRORS[store[1]];
  if (/balance|#10\b|insufficient/i.test(message)) return "Not enough USDC in your wallet.";
  if (/NotAllowedError|cancel/i.test(message)) return "Passkey request was cancelled.";
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}
