// A passkey wallet's "birth" (the transaction that created it), recorded when
// our sponsor submits it, and served in the smart-account indexer's format.
//
// On a new device, smart-account-kit finds a wallet through an indexer and
// then verifies the creation transaction on chain itself. The public indexer
// can take a long time to record a new wallet's birth, so a creator who just
// made a wallet couldn't sign in on their phone. We answer lookups for wallets
// born through us and pass everything else to the public indexer; the kit
// still checks every claim against the chain, so it needs no trust in us.

import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type { Birth } from "./db";

/** The wallet a successful createContractV2 made, and the passkey credential it was made for. */
export function birthOf(func: xdr.HostFunction, returnValue: xdr.ScVal | undefined, txHash: string, ledger: number): Birth | null {
  if (func.switch() !== xdr.HostFunctionType.hostFunctionTypeCreateContractV2() || !returnValue) return null;
  const args = func.createContractV2();
  const exec = args.executable();
  if (exec.switch() !== xdr.ContractExecutableType.contractExecutableWasm()) return null;
  const contract = scValToNative(returnValue);
  if (typeof contract !== "string" || !contract.startsWith("C")) return null;
  // The constructor's signer key data is the passkey's public key (65 bytes) followed by its credential id.
  const keyData = findKeyData(args.constructorArgs().map((a) => scValToNative(a)));
  if (!keyData) return null;
  return {
    credential_id: keyData.subarray(65).toString("hex"),
    contract_id: contract,
    tx_hash: txHash,
    ledger,
    wasm_hash: exec.wasmHash().toString("hex"),
  };
}

function findKeyData(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value.length > 65 && value[0] === 0x04 ? value : null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findKeyData(v);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const found = findKeyData(v);
      if (found) return found;
    }
  }
  return null;
}

type Candidate = Record<string, unknown> & { contract_id: string; incomplete?: boolean };
type Lookup = {
  credentialId: string;
  contracts: Candidate[];
  count: number;
  schema: number;
  complete: boolean;
  incompleteReasons?: string[];
  indexed_through_ledger: number;
};

/** Fills in what the public indexer hasn't recorded yet from our own births. */
export function mergeLookup(credentialId: string, upstream: Lookup | null, ours: Birth[], latestLedger: number): Lookup | null {
  if (ours.length === 0) return upstream;
  const byContract = new Map<string, Candidate>((upstream?.contracts ?? []).map((c) => [c.contract_id, c]));
  for (const b of ours) {
    const known = byContract.get(b.contract_id);
    if (known && known.incomplete === false) continue;
    byContract.set(b.contract_id, {
      contract_id: b.contract_id,
      context_rule_count: 1,
      external_signer_count: 1,
      delegated_signer_count: 0,
      native_signer_count: 0,
      first_seen_ledger: b.ledger,
      last_seen_ledger: b.ledger,
      context_rule_ids: [0],
      birth_wasm_hash: b.wasm_hash,
      creation_transaction_hash: b.tx_hash,
      creation_ledger: b.ledger,
      current_wasm_hash: b.wasm_hash,
      derived_address: true,
      collision: false,
      incomplete: false,
    });
  }
  const contracts = [...byContract.values()];
  const complete = contracts.every((c) => c.incomplete === false);
  return {
    credentialId,
    contracts,
    count: contracts.length,
    schema: 2,
    complete,
    ...(complete ? {} : { incompleteReasons: ["index_behind"] }),
    indexed_through_ledger: Math.max(upstream?.indexed_through_ledger ?? 0, latestLedger),
  };
}
