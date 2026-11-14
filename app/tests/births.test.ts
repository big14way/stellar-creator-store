// Wallet births recorded by our sponsor, served in the indexer's format.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { birthOf, mergeLookup } from "../server/births";

const WALLET = StrKey.encodeContract(Buffer.alloc(32, 5));
const VERIFIER = StrKey.encodeContract(Buffer.alloc(32, 6));
const WASM = Buffer.alloc(32, 7);
const credential = Buffer.alloc(20, 0xab);
const keyData = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1), credential]);

function deploy(): xdr.HostFunction {
  const signer = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("External"), Address.fromString(VERIFIER).toScVal(), xdr.ScVal.scvBytes(keyData)]);
  return xdr.HostFunction.hostFunctionTypeCreateContractV2(
    new xdr.CreateContractArgsV2({
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({ address: Address.fromString(Keypair.random().publicKey()).toScAddress(), salt: Buffer.alloc(32) }),
      ),
      executable: xdr.ContractExecutable.contractExecutableWasm(WASM),
      constructorArgs: [xdr.ScVal.scvVec([signer]), nativeToScVal(new Map())],
    }),
  );
}

test("records the wallet and passkey credential a creation made", () => {
  const birth = birthOf(deploy(), Address.fromString(WALLET).toScVal(), "aa".repeat(32), 1234);
  assert.deepEqual(birth, {
    credential_id: credential.toString("hex"),
    contract_id: WALLET,
    tx_hash: "aa".repeat(32),
    ledger: 1234,
    wasm_hash: WASM.toString("hex"),
  });
});

test("ignores anything that isn't a wallet creation", () => {
  const call = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({ contractAddress: Address.fromString(WALLET).toScAddress(), functionName: "buy", args: [] }),
  );
  assert.equal(birthOf(call, xdr.ScVal.scvVoid(), "aa", 1), null);
  assert.equal(birthOf(deploy(), undefined, "aa", 1), null);
});

test("fills in a birth the public indexer hasn't recorded yet", () => {
  const birth = birthOf(deploy(), Address.fromString(WALLET).toScVal(), "bb".repeat(32), 50)!;
  const upstream = {
    credentialId: birth.credential_id,
    contracts: [{ contract_id: WALLET, incomplete: true, incompleteReasons: ["missing_birth"], birth_wasm_hash: null }],
    count: 1,
    schema: 2,
    complete: false,
    indexed_through_ledger: 90,
  };
  const merged = mergeLookup(birth.credential_id, upstream, [birth], 100)!;
  assert.equal(merged.complete, true);
  assert.equal(merged.incompleteReasons, undefined);
  assert.equal(merged.indexed_through_ledger, 100);
  assert.equal(merged.contracts.length, 1);
  assert.equal(merged.contracts[0].creation_transaction_hash, "bb".repeat(32));
  assert.equal(merged.contracts[0].incomplete, false);
});

test("keeps the public indexer's answer when it is already complete, or when we know nothing", () => {
  const complete = {
    credentialId: "ab",
    contracts: [{ contract_id: WALLET, incomplete: false, creation_transaction_hash: "cc" }],
    count: 1,
    schema: 2,
    complete: true,
    indexed_through_ledger: 90,
  };
  const birth = birthOf(deploy(), Address.fromString(WALLET).toScVal(), "bb".repeat(32), 50)!;
  assert.equal(mergeLookup("ab", complete, [birth], 100)!.contracts[0].creation_transaction_hash, "cc");
  assert.equal(mergeLookup("ab", complete, [], 100), complete);
});
