// Product details live off-chain; prices, splits and sales live in the contract.

import type { Sql } from "./sql";

export type Draft = {
  id: string;
  creator: string;
  title: string;
  description: string;
  file_key: string;
  file_name: string;
  file_type: string;
  file_size: number;
  cover_key: string | null;
  cover_type: string | null;
  created_at: number;
};

export type ProductRow = Omit<Draft, "id"> & { id: number };

export type Profile = { wallet: string; name: string; bio: string; handle: string | null; updated_at: number };

export type SaleRow = {
  product_id: number;
  buyer: string;
  tx_hash: string;
  created_at: number;
  price: string | null;
  title: string;
  creator: string;
};

export type Birth = { credential_id: string; contract_id: string; tx_hash: string; ledger: number; wasm_hash: string };

export type PurchaseRow = ProductRow & { buyer: string; tx_hash: string; bought_at: number; paid: string | null };

const COLUMNS = "id, creator, title, description, file_key, file_name, file_type, file_size, cover_key, cover_type, created_at";

async function migrate(sql: Sql) {
  const blob = sql.dialect === "postgres" ? "bytea" : "blob";
  const statements = [
    `create table if not exists drafts (
      id text primary key, creator text not null, title text not null, description text not null,
      file_key text not null, file_name text not null, file_type text not null, file_size bigint not null,
      cover_key text, cover_type text, created_at bigint not null)`,
    `create table if not exists products (
      id bigint primary key, creator text not null, title text not null, description text not null,
      file_key text not null, file_name text not null, file_type text not null, file_size bigint not null,
      cover_key text, cover_type text, created_at bigint not null)`,
    "create index if not exists products_by_creator on products (creator)",
    `create table if not exists purchases (
      product_id bigint not null, buyer text not null, tx_hash text not null, created_at bigint not null,
      price text, primary key (product_id, buyer))`,
    "create index if not exists purchases_by_buyer on purchases (buyer)",
    `create table if not exists profiles (
      wallet text primary key, name text not null, bio text not null, handle text unique, updated_at bigint not null)`,
    `create table if not exists blobs (key text primary key, bytes ${blob} not null, size bigint not null)`,
    "create table if not exists rate (key text primary key, start bigint not null, count bigint not null)",
    "create table if not exists nonces (nonce text primary key, expires bigint not null)",
    // Passkey wallets created through our sponsor: what an indexer would report as their birth.
    `create table if not exists births (
      credential_id text not null, contract_id text not null, tx_hash text not null, ledger bigint not null,
      wasm_hash text not null, primary key (credential_id, contract_id))`,
  ];
  for (const s of statements) await sql.exec(s);
  // Databases from before purchases kept the price paid.
  if (sql.dialect === "sqlite") await sql.exec("alter table purchases add column price text").catch(() => {});
}

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export async function openDb(sql: Sql) {
  await migrate(sql);
  await sql.run("delete from rate where start < ?", [Date.now() - 24 * 60 * 60 * 1000]);
  await sql.run("delete from nonces where expires < ?", [Date.now()]);

  return {
    sql,

    addDraft: (d: Draft) =>
      sql.run(`insert into drafts (${COLUMNS}) values (${placeholders(11)})`, [
        d.id, d.creator, d.title, d.description, d.file_key, d.file_name, d.file_type, d.file_size,
        d.cover_key, d.cover_type, d.created_at,
      ]),
    draft: (id: string) => sql.get<Draft>("select * from drafts where id = ?", [id]),

    /** Moves a draft to the published product with this on-chain id. */
    async publish(draft: Draft, productId: number): Promise<ProductRow> {
      const row: ProductRow = { ...draft, id: productId, created_at: Date.now() };
      await sql.run(`insert into products (${COLUMNS}) values (${placeholders(11)})`, [
        row.id, row.creator, row.title, row.description, row.file_key, row.file_name, row.file_type, row.file_size,
        row.cover_key, row.cover_type, row.created_at,
      ]);
      await sql.run("delete from drafts where id = ?", [draft.id]);
      return row;
    },
    product: (id: number) => sql.get<ProductRow>("select * from products where id = ?", [id]),
    productsBy: (creator: string) => sql.all<ProductRow>("select * from products where creator = ? order by id desc", [creator]),
    latest: (n: number) => sql.all<ProductRow>("select * from products order by id desc limit ?", [n]),
    updateDetails: (id: number, title: string, description: string) =>
      sql.run("update products set title = ?, description = ? where id = ?", [title, description, id]),

    addPurchase: (productId: number, buyer: string, txHash: string, price: string | null) =>
      sql.run(
        `insert into purchases (product_id, buyer, tx_hash, created_at, price) values (?, ?, ?, ?, ?)
         on conflict (product_id, buyer) do nothing`,
        [productId, buyer, txHash, Date.now(), price],
      ),
    purchaseTx: async (productId: number, buyer: string) =>
      (await sql.get<{ tx_hash: string }>("select tx_hash from purchases where product_id = ? and buyer = ?", [productId, buyer]))
        ?.tx_hash ?? null,
    /** Products these wallets bought through the store, newest first. */
    purchasesBy: (buyers: string[]): Promise<PurchaseRow[]> =>
      buyers.length === 0
        ? Promise.resolve([])
        : sql.all<PurchaseRow>(
            `select p.*, s.buyer, s.tx_hash, s.created_at as bought_at, s.price as paid
             from purchases s join products p on p.id = s.product_id
             where s.buyer in (${placeholders(buyers.length)}) order by s.created_at desc`,
            buyers,
          ),
    recentSales: (n: number, creator?: string) =>
      sql.all<SaleRow>(
        `select s.product_id, s.buyer, s.tx_hash, s.created_at, s.price, p.title, p.creator
         from purchases s join products p on p.id = s.product_id
         ${creator ? "where p.creator = ?" : ""} order by s.created_at desc limit ?`,
        creator ? [creator, n] : [n],
      ),

    profile: (wallet: string) => sql.get<Profile>("select * from profiles where wallet = ?", [wallet]),
    profileByHandle: (handle: string) => sql.get<Profile>("select * from profiles where handle = ?", [handle]),
    profiles: (wallets: string[]): Promise<Profile[]> =>
      wallets.length === 0
        ? Promise.resolve([])
        : sql.all<Profile>(`select * from profiles where wallet in (${placeholders(wallets.length)})`, wallets),
    saveProfile: (p: Profile) =>
      sql.run(
        `insert into profiles (wallet, name, bio, handle, updated_at) values (?, ?, ?, ?, ?)
         on conflict (wallet) do update set name = excluded.name, bio = excluded.bio, handle = excluded.handle,
         updated_at = excluded.updated_at`,
        [p.wallet, p.name, p.bio, p.handle, p.updated_at],
      ),

    /**
     * Counts a hit in a fixed window and says whether it is within the limit.
     * Kept in the database so limits survive restarts.
     */
    async allow(key: string, limit: number, windowMs: number): Promise<boolean> {
      const now = Date.now();
      const stale = now - windowMs;
      const row = await sql.get<{ count: number }>(
        `insert into rate (key, start, count) values (?, ?, 1)
         on conflict (key) do update set
           count = case when rate.start <= ? then 1 else rate.count + 1 end,
           start = case when rate.start <= ? then ? else rate.start end
         returning count`,
        [key, now, stale, stale, now],
      );
      return Number(row?.count ?? 1) <= limit;
    },

    addBirth: (b: Birth) =>
      sql.run(
        `insert into births (credential_id, contract_id, tx_hash, ledger, wasm_hash) values (?, ?, ?, ?, ?)
         on conflict (credential_id, contract_id) do nothing`,
        [b.credential_id, b.contract_id, b.tx_hash, b.ledger, b.wasm_hash],
      ),
    births: (credentialId: string) => sql.all<Birth>("select * from births where credential_id = ?", [credentialId]),

    /** A one-time sign-in challenge. */
    addNonce: (nonce: string, ttlMs: number) => sql.run("insert into nonces (nonce, expires) values (?, ?)", [nonce, Date.now() + ttlMs]),
    /** True once per nonce, while it is unexpired. */
    useNonce: async (nonce: string) => (await sql.run("delete from nonces where nonce = ? and expires > ?", [nonce, Date.now()])) === 1,
  };
}

export type Db = Awaited<ReturnType<typeof openDb>>;
