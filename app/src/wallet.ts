import { contract } from "@stellar/stellar-sdk";
import { IndexedDBStorage, SmartAccountKit } from "smart-account-kit";
import { ACCOUNT_WASM_HASH, NETWORK_PASSPHRASE, RPC_URL, STORE_ID, WEBAUTHN_VERIFIER } from "./config";

let kit: SmartAccountKit | null = null;

/** One passkey wallet client per page. Fees go through our relayer. */
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

async function sponsorAddress(): Promise<string> {
  const res = await fetch("/api/relay/info");
  if (!res.ok) throw new Error(`relayer info: ${res.status}`);
  return ((await res.json()) as { sponsor: string }).sponsor;
}

/** Builds and simulates store.buy for the connected wallet. */
export async function buildBuy(buyer: string, productId: bigint, affiliate?: string) {
  const store = await contract.Client.from({
    contractId: STORE_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    // Simulation needs an existing source account; the relayer replaces it.
    publicKey: await sponsorAddress(),
  });
  // The client is generated from the contract's on-chain spec, so its methods are untyped here.
  const typed = store as unknown as {
    buy(args: { buyer: string; product_id: bigint; affiliate?: string }): Promise<contract.AssembledTransaction<unknown>>;
  };
  return typed.buy({ buyer, product_id: productId, affiliate });
}
