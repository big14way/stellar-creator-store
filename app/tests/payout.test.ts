// Payout addresses: what a creator may save, and the Stellar check that stops a payout bouncing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, MuxedAccount } from "@stellar/stellar-sdk";
import { USDC_ISSUER } from "../src/config";
import { checkPayout, parsePayout } from "../src/payout";

const G = Keypair.random().publicKey();

test("a classic G-address is saved as it is", () => {
  assert.deepEqual(parsePayout(`  ${G.toLowerCase()} `), { address: G, account: G, memoId: null });
});

test("an exchange address and a number memo become one M-address that keeps both", () => {
  const p = parsePayout(G, "004242");
  assert.ok(!("error" in p));
  assert.equal(p.account, G);
  assert.equal(p.memoId, "4242");
  assert.ok(p.address.startsWith("M"));
  const back = MuxedAccount.fromAddress(p.address, "0");
  assert.equal(back.baseAccount().accountId(), G);
  assert.equal(back.id(), "4242");
});

test("an M-address is read back into its account and memo", () => {
  const address = parsePayout(G, "18446744073709551615");
  assert.ok(!("error" in address));
  const again = parsePayout(address.address);
  assert.deepEqual(again, { address: address.address, account: G, memoId: "18446744073709551615" });
  assert.match((parsePayout(address.address, "7") as { error: string }).error, /already carries its memo/);
});

test("smart-wallet addresses, text memos, oversized memos and junk are refused with a reason", () => {
  const err = (a: string, m?: string) => (parsePayout(a, m) as { error?: string }).error ?? "";
  assert.match(err("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"), /smart-wallet/);
  assert.match(err(G, "BUSHA-123"), /number memo/);
  assert.match(err(G, "18446744073709551616"), /number memo/);
  assert.match(err("hello"), /not a Stellar address/);
  assert.match(err(""), /Enter a Stellar address/);
});

const horizon = (status: number, body?: unknown) => (async () => new Response(JSON.stringify(body ?? {}), { status })) as typeof fetch;

test("the check refuses an account that does not exist", async () => {
  const c = await checkPayout(G, horizon(404));
  assert.equal(c.ok, false);
  assert.match((c as { problem: string }).problem, /does not exist/);
});

test("the check refuses an account without Circle's USDC, and accepts one with it", async () => {
  const xlmOnly = { balances: [{ asset_type: "native" }] };
  const otherUsdc = { balances: [{ asset_code: "USDC", asset_issuer: Keypair.random().publicKey(), is_authorized: true }] };
  const circle = { balances: [{ asset_code: "USDC", asset_issuer: USDC_ISSUER, is_authorized: true }] };
  assert.match(((await checkPayout(G, horizon(200, xlmOnly))) as { problem: string }).problem, /does not hold USDC/);
  assert.equal((await checkPayout(G, horizon(200, otherUsdc))).ok, false, "a look-alike USDC from another issuer does not count");
  assert.deepEqual(await checkPayout(G, horizon(200, circle)), { ok: true });
});

test("the check says so when Stellar cannot be reached", async () => {
  await assert.rejects(checkPayout(G, horizon(503)), /could not reach Stellar/);
});
