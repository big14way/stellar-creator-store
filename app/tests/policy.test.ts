// What the fee sponsor will and won't pay for.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { decode, refusal, walletSigners, type Decoded } from "../server/policy";

const STORE = StrKey.encodeContract(Buffer.alloc(32, 1));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 2));
const WALLET = StrKey.encodeContract(Buffer.alloc(32, 3));
const WALLET_WASM = "ab".repeat(32);
const SPONSOR = Keypair.random().publicKey();
const PERSON = Keypair.random().publicKey();

function invoke(contract: string, fn: string, args: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(contract).toScAddress(),
      functionName: fn,
      args,
    }),
  );
}

const buy = (buyer: string, contract = STORE, fn = "buy") =>
  invoke(contract, fn, [Address.fromString(buyer).toScVal(), nativeToScVal(1n, { type: "u64" }), xdr.ScVal.scvVoid()]);

function deploy(executable: xdr.ContractExecutable): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeCreateContractV2(
    new xdr.CreateContractArgsV2({
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(PERSON).toScAddress(),
          salt: Buffer.alloc(32, 9),
        }),
      ),
      executable,
      constructorArgs: [],
    }),
  );
}

const root = new xdr.SorobanAuthorizedInvocation({
  function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(STORE).toScAddress(),
      functionName: "buy",
      args: [],
    }),
  ),
  subInvocations: [],
});

function signedBy(signer: string, v2 = false): xdr.SorobanAuthorizationEntry {
  const creds = new xdr.SorobanAddressCredentials({
    address: Address.fromString(signer).toScAddress(),
    nonce: xdr.Int64.fromString("1"),
    signatureExpirationLedger: 100,
    signature: xdr.ScVal.scvVoid(),
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: v2
      ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(creds)
      : xdr.SorobanCredentials.sorobanCredentialsAddress(creds),
    rootInvocation: root,
  });
}

const sourceAccountAuth = new xdr.SorobanAuthorizationEntry({
  credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
  rootInvocation: root,
});

const check = (call: Decoded) => refusal(call, SPONSOR, STORE, WALLET_WASM);

test("sponsors a smart wallet buying from our store", () => {
  assert.equal(check({ func: buy(WALLET), auth: [signedBy(WALLET)] }), null);
  assert.equal(check({ func: buy(WALLET), auth: [signedBy(WALLET, true)] }), null);
});

test("sponsors deploying a wallet from the approved code only", () => {
  const ok = deploy(xdr.ContractExecutable.contractExecutableWasm(Buffer.from(WALLET_WASM, "hex")));
  assert.equal(check({ func: ok, auth: [signedBy(PERSON)] }), null);

  const other = deploy(xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 7)));
  assert.match(check({ func: other, auth: [signedBy(PERSON)] })!, /approved wallet code/);

  const asset = deploy(xdr.ContractExecutable.contractExecutableStellarAsset());
  assert.match(check({ func: asset, auth: [signedBy(PERSON)] })!, /wallet code/);
});

test("sponsors creators listing, editing and claiming from a smart wallet", () => {
  const list = invoke(STORE, "create_product", [Address.fromString(WALLET).toScVal(), nativeToScVal(5n, { type: "i128" })]);
  assert.equal(check({ func: list, auth: [signedBy(WALLET)] }), null);

  const edit = invoke(STORE, "update_product", [nativeToScVal(1n, { type: "u64" })]);
  assert.equal(check({ func: edit, auth: [signedBy(WALLET)] }), null);
  assert.match(check({ func: edit, auth: [] })!, /no authorization/);

  // claim pays only the named wallet, so it needs no signature
  const claim = invoke(STORE, "claim", [Address.fromString(WALLET).toScVal()]);
  assert.equal(check({ func: claim, auth: [] }), null);
});

test("refuses listing or claiming for a plain account", () => {
  const list = invoke(STORE, "create_product", [Address.fromString(PERSON).toScVal(), nativeToScVal(5n, { type: "i128" })]);
  assert.match(check({ func: list, auth: [signedBy(PERSON)] })!, /smart wallets/);
  const claim = invoke(STORE, "claim", [Address.fromString(SPONSOR).toScVal()]);
  assert.match(check({ func: claim, auth: [] })!, /smart wallets/);
});

test("refuses any other contract or function", () => {
  assert.match(check({ func: buy(WALLET, OTHER), auth: [signedBy(WALLET)] })!, /only buy, create_product/);
  assert.match(check({ func: buy(WALLET, STORE, "set_fee"), auth: [signedBy(WALLET)] })!, /only buy, create_product/);
  assert.match(check({ func: buy(WALLET, STORE, "upgrade"), auth: [signedBy(WALLET)] })!, /only buy, create_product/);
});

test("lists the smart wallets that signed", () => {
  assert.deepEqual(walletSigners([signedBy(WALLET), signedBy(PERSON, true)]), [WALLET]);
});

test("refuses a buyer that is a plain account, so the sponsor can never be the buyer", () => {
  assert.match(check({ func: buy(PERSON), auth: [signedBy(PERSON)] })!, /smart wallets/);
  assert.match(check({ func: buy(SPONSOR), auth: [signedBy(WALLET)] })!, /smart wallets/);
});

test("refuses authorization the sponsor would grant just by paying the fee", () => {
  assert.match(check({ func: buy(WALLET), auth: [sourceAccountAuth] })!, /signed address/);
  assert.match(check({ func: buy(WALLET), auth: [signedBy(WALLET), sourceAccountAuth] })!, /signed address/);
  assert.match(check({ func: buy(WALLET), auth: [signedBy(SPONSOR)] })!, /never authorizes/);
});

test("refuses a call with no signatures", () => {
  assert.match(check({ func: buy(WALLET), auth: [] })!, /no authorization/);
});

test("decode accepts the kit's { func, auth } and rejects anything else", () => {
  const func = buy(WALLET).toXDR("base64");
  const auth = [signedBy(WALLET).toXDR("base64")];
  const decoded = decode({ func, auth });
  assert.ok(typeof decoded !== "string");
  assert.equal(check(decoded), null);

  assert.equal(typeof decode(null), "string");
  assert.equal(typeof decode({ func }), "string");
  assert.equal(typeof decode({ func, auth: [1] }), "string");
  assert.equal(typeof decode({ func: "not xdr", auth: [] }), "string");
});
