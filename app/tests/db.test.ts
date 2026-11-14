// The off-chain store: rate limits, one-time challenges, profiles, purchases.
// Runs on SQLite, and also on Postgres when TEST_DATABASE_URL is set (the
// hosted setup).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb } from "../server/db";
import { sqlFiles } from "../server/files";
import { postgres, sqlite, type Sql } from "../server/sql";

const W = (n: number) => `C${String(n).padStart(55, "A")}`;
const PG = process.env.TEST_DATABASE_URL;

/** Opens the same empty database twice over: a fresh store, and a way to reopen it as after a restart. */
type Backend = { name: string; place: () => Promise<() => Promise<Sql>> };

const backends: Backend[] = [
  {
    name: "sqlite",
    place: async () => {
      const dir = mkdtempSync(join(tmpdir(), "paperstall-"));
      return async () => sqlite(dir);
    },
  },
  ...(PG
    ? [
        {
          name: "postgres",
          place: async () => {
            const schema = `t_${randomBytes(6).toString("hex")}`;
            const admin = await postgres(PG);
            await admin.exec(`create schema ${schema}`);
            await admin.close();
            const url = `${PG}${PG.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
            return () => postgres(url);
          },
        },
      ]
    : []),
];

for (const backend of backends) {
const fresh = async () => openDb(await (await backend.place())());
const it = (name: string, fn: () => Promise<void>) => test(`${backend.name}: ${name}`, fn);

it("rate limits count per window and survive reopening the database", async () => {
  const open = await backend.place();
  const db = await openDb(await open());
  assert.equal(await db.allow("k", 2, 60_000), true);
  assert.equal(await db.allow("k", 2, 60_000), true);
  assert.equal(await db.allow("k", 2, 60_000), false);
  const again = await openDb(await open());
  assert.equal(await again.allow("k", 2, 60_000), false, "a restart does not reset the limit");
  assert.equal(await again.allow("other", 2, 60_000), true);
  await db.sql.close();
  await again.sql.close();
});

it("a sign-in challenge works once, and not after it expires", async () => {
  const db = await fresh();
  await db.addNonce("n1", 60_000);
  assert.equal(await db.useNonce("n1"), true);
  assert.equal(await db.useNonce("n1"), false);
  await db.addNonce("n2", -1);
  assert.equal(await db.useNonce("n2"), false);
  assert.equal(await db.useNonce("never-issued"), false);
  await db.sql.close();
});

it("shop handles are unique", async () => {
  const db = await fresh();
  await db.saveProfile({ wallet: W(1), name: "Ada", bio: "", handle: "ada", updated_at: 1 });
  await assert.rejects(db.saveProfile({ wallet: W(2), name: "Not Ada", bio: "", handle: "ada", updated_at: 1 }));
  assert.equal((await db.profileByHandle("ada"))?.wallet, W(1));
  await db.saveProfile({ wallet: W(1), name: "Ada O.", bio: "Beats", handle: "adabeats", updated_at: 2 });
  assert.equal((await db.profile(W(1)))?.name, "Ada O.");
  assert.equal(await db.profileByHandle("ada"), undefined);
  await db.sql.close();
});

it("publishing a draft and recording a purchase", async () => {
  const db = await fresh();
  const files = sqlFiles(db.sql);
  const key = await files.save(new Uint8Array([1, 2, 3]));
  assert.deepEqual(Array.from((await files.body(key)) as Uint8Array), [1, 2, 3]);

  const draft = {
    id: "d1", creator: W(1), title: "Beat pack", description: "", file_key: key, file_name: "a.zip",
    file_type: "application/zip", file_size: 3, cover_key: null, cover_type: null, created_at: 1,
  };
  await db.addDraft(draft);
  await db.publish((await db.draft("d1"))!, 7);
  assert.equal(await db.draft("d1"), undefined);
  assert.equal((await db.product(7))?.title, "Beat pack");

  await db.addPurchase(7, W(2), "hash1", "30000000");
  await db.addPurchase(7, W(2), "hash2", "30000000"); // a repeat is ignored
  assert.equal(await db.purchaseTx(7, W(2)), "hash1");
  assert.deepEqual((await db.purchasesBy([W(2)])).map((p) => [p.id, p.tx_hash, p.paid]), [[7, "hash1", "30000000"]]);
  assert.equal((await db.recentSales(10, W(1))).length, 1);
  assert.equal((await db.recentSales(10, W(3))).length, 0);
  await db.sql.close();
});
}
