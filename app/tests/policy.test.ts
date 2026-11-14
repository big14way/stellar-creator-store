// What the fee sponsor will and won't pay for.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { decode, feeBumpRefusal, refusal, walletSigners, type Decoded } from "../server/policy";

const STORE = StrKey.encodeContract(Buffer.alloc(32, 1));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 2));
const USDC = StrKey.encodeContract(Buffer.alloc(32, 4));
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

const check = (call: Decoded) => refusal(call, SPONSOR, STORE, WALLET_WASM, USDC);

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

test("refuses listing for a plain account", () => {
  const list = invoke(STORE, "create_product", [Address.fromString(PERSON).toScVal(), nativeToScVal(5n, { type: "i128" })]);
  assert.match(check({ func: list, auth: [signedBy(PERSON)] })!, /smart wallets/);
});

test("sponsors paying out a held share to anyone, since it only ever pays the named address", () => {
  const claim = invoke(STORE, "claim", [Address.fromString(PERSON).toScVal()]);
  assert.equal(check({ func: claim, auth: [] }), null);
});

const transfer = (from: string, to: string) =>
  invoke(USDC, "transfer", [Address.fromString(from).toScVal(), Address.fromString(to).toScVal(), nativeToScVal(5n, { type: "i128" })]);

test("sponsors a smart wallet sending its own USDC (cash-out to an anchor)", () => {
  assert.equal(check({ func: transfer(WALLET, PERSON), auth: [signedBy(WALLET)] }), null);
});

test("refuses USDC transfers not signed by the sending smart wallet", () => {
  assert.match(check({ func: transfer(PERSON, WALLET), auth: [signedBy(PERSON)] })!, /smart wallets/);
  assert.match(check({ func: transfer(WALLET, PERSON), auth: [] })!, /must sign/);
  assert.match(check({ func: transfer(WALLET, PERSON), auth: [signedBy(OTHER)] })!, /must sign/);
  assert.match(check({ func: invoke(USDC, "approve", [Address.fromString(WALLET).toScVal()]), auth: [signedBy(WALLET)] })!, /only buy/);
});

test("refuses any other contract or function", () => {
  assert.match(check({ func: buy(WALLET, OTHER), auth: [signedBy(WALLET)] })!, /only buy, create_product/);
  // a transfer on any token other than USDC
  const otherToken = invoke(OTHER, "transfer", transfer(WALLET, PERSON).invokeContract().args());
  assert.match(check({ func: otherToken, auth: [signedBy(WALLET)] })!, /only buy/);
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

// ---- Stellar wallets (G...): their own signed transaction, wrapped in our fee bump ----

const buyer = Keypair.random();

function signedTx(
  { source = buyer, func = buy(buyer.publicKey()), auth = [sourceAccountAuth], ops = 1, resourceFee = 100_000 }: {
    source?: Keypair;
    func?: xdr.HostFunction;
    auth?: xdr.SorobanAuthorizationEntry[];
    ops?: number;
    resourceFee?: number;
  } = {},
) {
  const builder = new TransactionBuilder(new Account(source.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET });
  for (let i = 0; i < ops; i++) builder.addOperation(Operation.invokeHostFunction({ func, auth }));
  const tx = builder.setSorobanData(new SorobanDataBuilder().setResourceFee(resourceFee).build()).setTimeout(60).build();
  tx.sign(source);
  return tx;
}

test("fee-bumps a Stellar wallet buying for itself", () => {
  assert.equal(feeBumpRefusal(signedTx(), SPONSOR, STORE), null);
  assert.equal(feeBumpRefusal(signedTx({ auth: [signedBy(buyer.publicKey())] }), SPONSOR, STORE), null);
  const claim = invoke(STORE, "claim", [Address.fromString(buyer.publicKey()).toScVal()]);
  assert.equal(feeBumpRefusal(signedTx({ func: claim, auth: [] }), SPONSOR, STORE), null);
});

test("refuses to fee-bump anything else", () => {
  assert.match(feeBumpRefusal(signedTx({ func: buy(PERSON) }), SPONSOR, STORE)!, /for itself/);
  assert.match(feeBumpRefusal(signedTx({ func: buy(buyer.publicKey(), OTHER) }), SPONSOR, STORE)!, /only buy and claim/);
  assert.match(feeBumpRefusal(signedTx({ func: buy(buyer.publicKey(), STORE, "create_product") }), SPONSOR, STORE)!, /only buy and claim/);
  assert.match(feeBumpRefusal(signedTx({ ops: 2 }), SPONSOR, STORE)!, /exactly one/);
  assert.match(feeBumpRefusal(signedTx({ auth: [signedBy(PERSON)] }), SPONSOR, STORE)!, /only the wallet itself/);
  assert.match(feeBumpRefusal(signedTx({ resourceFee: 6_000_000 }), SPONSOR, STORE)!, /cap/);
});

test("never fee-bumps the sponsor's own transactions", () => {
  const sponsorKey = Keypair.random();
  const tx = signedTx({ source: sponsorKey, func: buy(sponsorKey.publicKey()) });
  assert.match(feeBumpRefusal(tx, sponsorKey.publicKey(), STORE)!, /sponsor/);
});
