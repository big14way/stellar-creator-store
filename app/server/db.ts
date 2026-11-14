// Product details live off-chain; prices, splits and sales live in the contract.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "store.db"));
  db.exec(`
    create table if not exists drafts (
      id text primary key,
      creator text not null,
      title text not null,
      description text not null,
      file_key text not null,
      file_name text not null,
      file_type text not null,
      file_size integer not null,
      cover_key text,
      cover_type text,
      created_at integer not null
    );
    create table if not exists products (
      id integer primary key,
      creator text not null,
      title text not null,
      description text not null,
      file_key text not null,
      file_name text not null,
      file_type text not null,
      file_size integer not null,
      cover_key text,
      cover_type text,
      created_at integer not null
    );
    create index if not exists products_by_creator on products (creator);
    create table if not exists purchases (
      product_id integer not null,
      buyer text not null,
      tx_hash text not null,
      created_at integer not null,
      price text,
      primary key (product_id, buyer)
    );
  `);
  // Databases created before purchases kept the price paid.
  try {
    db.exec("alter table purchases add column price text");
  } catch {}

  const insertDraft = db.prepare(`insert into drafts values
    (:id, :creator, :title, :description, :file_key, :file_name, :file_type, :file_size, :cover_key, :cover_type, :created_at)`);
  const getDraft = db.prepare("select * from drafts where id = ?");
  const deleteDraft = db.prepare("delete from drafts where id = ?");
  const insertProduct = db.prepare(`insert into products values
    (:id, :creator, :title, :description, :file_key, :file_name, :file_type, :file_size, :cover_key, :cover_type, :created_at)`);
  const getProduct = db.prepare("select * from products where id = ?");
  const productsBy = db.prepare("select * from products where creator = ? order by id desc");
  const latest = db.prepare("select * from products order by id desc limit ?");
  const insertPurchase = db.prepare(
    "insert or ignore into purchases (product_id, buyer, tx_hash, created_at, price) values (?, ?, ?, ?, ?)",
  );
  const getPurchase = db.prepare("select tx_hash from purchases where product_id = ? and buyer = ?");
  const recentSales = db.prepare(`select s.product_id, s.buyer, s.tx_hash, s.created_at, s.price, p.title
    from purchases s join products p on p.id = s.product_id order by s.created_at desc limit ?`);

  return {
    addDraft: (d: Draft) => insertDraft.run(d),
    draft: (id: string) => getDraft.get(id) as Draft | undefined,
    /** Moves a draft to the published product with this on-chain id. */
    publish(draftId: string, productId: number): ProductRow {
      const d = getDraft.get(draftId) as Draft;
      const row: ProductRow = { ...d, id: productId, created_at: Date.now() };
      db.exec("begin");
      try {
        insertProduct.run(row);
        deleteDraft.run(draftId);
        db.exec("commit");
      } catch (err) {
        db.exec("rollback");
        throw err;
      }
      return row;
    },
    product: (id: number) => getProduct.get(id) as ProductRow | undefined,
    productsBy: (creator: string) => productsBy.all(creator) as ProductRow[],
    latest: (n: number) => latest.all(n) as ProductRow[],
    addPurchase: (productId: number, buyer: string, txHash: string, price: string | null) =>
      insertPurchase.run(productId, buyer, txHash, Date.now(), price),
    purchaseTx: (productId: number, buyer: string) =>
      (getPurchase.get(productId, buyer) as { tx_hash: string } | undefined)?.tx_hash ?? null,
    recentSales: (n: number) =>
      recentSales.all(n) as {
        product_id: number;
        buyer: string;
        tx_hash: string;
        created_at: number;
        price: string | null;
        title: string;
      }[],
  };
}

export type Db = ReturnType<typeof openDb>;
