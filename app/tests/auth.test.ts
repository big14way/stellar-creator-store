// Sign-in checks: passkey assertions against the wallet's on-chain signer,
// and SEP-10 style challenges for Stellar wallets.

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { Keypair, Networks, Transaction } from "@stellar/stellar-sdk";
import { passkeyRefusal, stellarAuth, type Signer } from "../server/auth";
import { WEBAUTHN_VERIFIER } from "../src/config";

const ORIGIN = "https://paperstall.example";
const RP_ID = "paperstall.example";
const WALLET = "C".padEnd(56, "A");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

function passkey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  const credentialId = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  const signer: Signer = ["External", WEBAUTHN_VERIFIER, Buffer.concat([point, credentialId])];

  function assert_(opts: { challenge: string; origin?: string; rpId?: string; flags?: number; type?: string }) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: opts.type ?? "webauthn.get", challenge: opts.challenge, origin: opts.origin ?? ORIGIN }),
    );
    const authData = Buffer.concat([sha256(opts.rpId ?? RP_ID), Buffer.from([opts.flags ?? 0x05]), Buffer.alloc(4)]);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), { key: privateKey, dsaEncoding: "der" });
    return {
      id: credentialId.toString("base64url"),
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  }
  return { signer, assertion: assert_ };
}

const expect = (challenge: string) => ({ challenge, origins: [ORIGIN], rpIds: [RP_ID] });

test("accepts a passkey assertion signed by the wallet's on-chain signer", async () => {
  const key = passkey();
  const why = await passkeyRefusal(key.assertion({ challenge: "abc" }), WALLET, expect("abc"), async () => [key.signer]);
  assert.equal(why, null);
});

test("refuses a passkey assertion for the wrong challenge, origin, site or without verification", async () => {
  const key = passkey();
  const signers = async () => [key.signer];
  assert.match((await passkeyRefusal(key.assertion({ challenge: "old" }), WALLET, expect("abc"), signers))!, /challenge/);
  assert.match((await passkeyRefusal(key.assertion({ challenge: "abc", origin: "https://evil.example" }), WALLET, expect("abc"), signers))!, /origin/);
  assert.match((await passkeyRefusal(key.assertion({ challenge: "abc", rpId: "evil.example" }), WALLET, expect("abc"), signers))!, /relying party/);
  assert.match((await passkeyRefusal(key.assertion({ challenge: "abc", flags: 0x01 }), WALLET, expect("abc"), signers))!, /verified/);
  assert.match((await passkeyRefusal(key.assertion({ challenge: "abc", type: "webauthn.create" }), WALLET, expect("abc"), signers))!, /sign-in/);
});

test("refuses a passkey that doesn't sign for the wallet", async () => {
  const mine = passkey();
  const theirs = passkey();
  // the wallet lists someone else's passkey under the same credential id
  const why = await passkeyRefusal(mine.assertion({ challenge: "abc" }), WALLET, expect("abc"), async () => [theirs.signer]);
  assert.match(why!, /signature/);
  const none = await passkeyRefusal(mine.assertion({ challenge: "abc" }), WALLET, expect("abc"), async () => []);
  assert.match(none!, /does not sign/);
});

test("refuses a tampered passkey signature", async () => {
  const key = passkey();
  const assertion = key.assertion({ challenge: "abc" });
  const sig = Buffer.from(assertion.response.signature, "base64url");
  sig[sig.length - 1] ^= 1;
  assertion.response.signature = sig.toString("base64url");
  assert.ok(await passkeyRefusal(assertion, WALLET, expect("abc"), async () => [key.signer]));
});

test("Stellar wallet sign-in: accepts the account's signature, refuses anyone else's", () => {
  const auth = stellarAuth("secret", "paperstall.example");
  const account = Keypair.random();
  const { xdr, hash } = auth.challenge(account.publicKey());

  const tx = new Transaction(xdr, Networks.TESTNET);
  assert.equal(tx.sequence, "0", "a challenge can never be submitted");
  tx.sign(account);
  assert.deepEqual(auth.verifySigned(tx.toXDR()), { account: account.publicKey(), hash });

  const forged = new Transaction(xdr, Networks.TESTNET);
  forged.sign(Keypair.random());
  assert.throws(() => auth.verifySigned(forged.toXDR()));
  assert.throws(() => stellarAuth("other secret", "paperstall.example").verifySigned(tx.toXDR()));
});
