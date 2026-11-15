// The sponsor pays the resource fee a Stellar wallet declares, so it must not be far above what the call needs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Account, Keypair, Networks, Operation, SorobanDataBuilder, TransactionBuilder, xdr, type rpc } from "@stellar/stellar-sdk";
import { overpriced } from "../server/sponsor";

function signedWithFee(resourceFee: number) {
  const wallet = Keypair.random();
  const tx = new TransactionBuilder(new Account(wallet.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.alloc(1)), auth: [] }))
    .setSorobanData(new SorobanDataBuilder().setResourceFee(resourceFee).build())
    .setTimeout(60)
    .build();
  tx.sign(wallet);
  return tx;
}

const needs = (fee: number) => ({ minResourceFee: String(fee) }) as rpc.Api.SimulateTransactionSuccessResponse;

test("pays a fee close to what the simulation needs, a little above or below", () => {
  assert.equal(overpriced(signedWithFee(95_000), needs(100_000)), null);
  assert.equal(overpriced(signedWithFee(150_000), needs(100_000)), null);
});

test("refuses a fee far above what the call needs", () => {
  assert.match(overpriced(signedWithFee(5_000_000), needs(100_000))!, /far above/);
});
