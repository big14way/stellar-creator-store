import { startAuthentication, startRegistration, type AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { Address, contract, hash, rpc, scValToNative, StrKey, xdr } from "@stellar/stellar-sdk";
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
    // Our server answers for wallets it created and passes the rest to the public indexer.
    indexerUrl: `${window.location.origin}/api/indexer`,
    storage: new IndexedDBStorage(),
    rpName: "Paperstall",
    webAuthn: { startRegistration, startAuthentication },
  });
  return kit;
}

/** The wallet address a passkey created through the kit lives at (same derivation as the kit). */
export function walletFor(credentialId: string): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(getKit().deployerPublicKey).toScAddress(),
          salt: hash(Buffer.from(base64urlBytes(credentialId))),
        }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}

function base64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

type KitInternals = {
  connectWithCredentials(
    credentialId: string,
    contractId: string,
    proof: { response: AuthenticationResponseJSON; challenge: string },
    allowAuthentication: boolean,
  ): Promise<{ contractId: string }>;
};

/**
 * Signs in with a passkey on any device, with one fingerprint or face prompt:
 * the same assertion proves the wallet to our server (against the signer
 * stored in the wallet's contract) and connects the passkey kit.
 */
export async function passkeySignIn(): Promise<string> {
  const { challenge } = await postJson<{ challenge: string }>("/api/auth/passkey/challenge", {});
  const response = await startAuthentication({
    optionsJSON: { challenge, rpId: window.location.hostname, userVerification: "required", timeout: 120_000 },
  });
  const wallet = walletFor(response.id);
  await postJson("/api/auth/passkey", { wallet, assertion: response });
  // The kit checks the same assertion against the wallet on chain before it will sign with it.
  const kitInternals = getKit() as unknown as KitInternals;
  await kitInternals.connectWithCredentials(response.id, wallet, { response, challenge }, false);
  return wallet;
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data;
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
  if (/NotAllowedError|cancel|declined|rejected/i.test(message)) return "The request was cancelled.";
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}
