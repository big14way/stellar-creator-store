// Sign-in on any device, without a password.
//
// Passkey wallets: the browser signs our one-time challenge with the passkey.
// We read the wallet's signers from its contract on chain and check the
// signature against the passkey's public key stored there.
//
// Stellar wallets (G...): the wallet signs a SEP-10 style challenge
// transaction that can never be submitted; we check its signature.

import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { Keypair, nativeToScVal, Transaction, WebAuth } from "@stellar/stellar-sdk";
import { read } from "../src/chain";
import { NETWORK_PASSPHRASE, WEBAUTHN_VERIFIER } from "../src/config";

export type PasskeyAssertion = {
  id: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string };
};

const b64url = (s: string) => Buffer.from(s, "base64url");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

export const newChallenge = () => randomBytes(32).toString("base64url");

export type Signer = [tag: string, ...values: unknown[]];

/** The signers on a wallet's default context rule, read from its contract. */
export async function chainSigners(wallet: string): Promise<Signer[]> {
  const rule = await read<{ signers: Signer[] }>(wallet, "get_context_rule", nativeToScVal(0, { type: "u32" }));
  return rule.signers;
}

/**
 * Checks a WebAuthn assertion against the passkeys that sign for `wallet`
 * on chain. Returns null when it is valid, or why it is not.
 */
export async function passkeyRefusal(
  assertion: PasskeyAssertion,
  wallet: string,
  expect: { challenge: string; origins: string[]; rpIds: string[] },
  signersOf: (wallet: string) => Promise<Signer[]> = chainSigners,
): Promise<string | null> {
  let clientData: { type?: string; challenge?: string; origin?: string };
  const clientDataJSON = b64url(assertion.response.clientDataJSON);
  try {
    clientData = JSON.parse(clientDataJSON.toString("utf8"));
  } catch {
    return "clientDataJSON is not JSON";
  }
  if (clientData.type !== "webauthn.get") return "not a sign-in assertion";
  if (clientData.challenge !== expect.challenge) return "wrong challenge";
  if (!clientData.origin || !expect.origins.includes(clientData.origin)) return "origin not allowed";

  const authData = b64url(assertion.response.authenticatorData);
  if (authData.length < 37) return "authenticator data too short";
  const rpId = expect.rpIds.find((id) => sha256(id).equals(authData.subarray(0, 32)));
  if (!rpId) return "wrong relying party";
  if ((authData[32] & 0x01) === 0) return "user was not present";
  if ((authData[32] & 0x04) === 0) return "user was not verified";

  // The wallet's live signers: External(verifier, publicKey || credentialId).
  let signers: Signer[];
  try {
    signers = await signersOf(wallet);
  } catch {
    return "could not read the wallet's signers";
  }
  const credentialId = b64url(assertion.id);
  const signer = signers.find(
    ([tag, verifier, keyData]) =>
      tag === "External" &&
      verifier === WEBAUTHN_VERIFIER &&
      Buffer.isBuffer(keyData) &&
      keyData.length === 65 + credentialId.length &&
      keyData.subarray(65).equals(credentialId),
  );
  if (!signer) return "this passkey does not sign for that wallet";
  const point = (signer[2] as Buffer).subarray(0, 65);
  if (point[0] !== 0x04) return "unsupported public key";

  const key = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") },
    format: "jwk",
  });
  const signed = Buffer.concat([authData, sha256(clientDataJSON)]);
  const ok = verify("sha256", signed, { key, dsaEncoding: "der" }, b64url(assertion.response.signature));
  return ok ? null : "signature does not verify";
}

/** SEP-10 style challenges for classic Stellar accounts. */
export function stellarAuth(secret: string, homeDomain: string) {
  const server = Keypair.fromRawEd25519Seed(sha256(`paperstall-auth:${secret}`));

  /** A challenge transaction for `account` to sign. It has sequence 0, so it can never be submitted. */
  function challenge(account: string): { xdr: string; hash: string } {
    const xdr = WebAuth.buildChallengeTx(server, account, homeDomain, 300, NETWORK_PASSPHRASE, homeDomain);
    const tx = new Transaction(xdr, NETWORK_PASSPHRASE);
    return { xdr, hash: tx.hash().toString("hex") };
  }

  /** The account that signed this challenge, and the challenge's hash; throws if it is not valid. */
  function verifySigned(signedXdr: string): { account: string; hash: string } {
    const { clientAccountID } = WebAuth.readChallengeTx(signedXdr, server.publicKey(), NETWORK_PASSPHRASE, homeDomain, homeDomain);
    WebAuth.verifyChallengeTxSigners(signedXdr, server.publicKey(), NETWORK_PASSPHRASE, [clientAccountID], homeDomain, homeDomain);
    const tx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
    return { account: clientAccountID, hash: tx.hash().toString("hex") };
  }

  return { challenge, verifySigned, serverAccount: server.publicKey() };
}
