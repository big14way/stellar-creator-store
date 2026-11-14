// The store's server: fee sponsor, product details and files, downloads,
// and a testnet USDC faucet. Prices, splits and sales live in the contract.

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Address, scValToNative } from "@stellar/stellar-sdk";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getProduct, hasPurchased, type ChainProduct } from "../src/chain";
import { STORE_ID } from "../src/config";
import { openDb, type ProductRow } from "./db";
import { faucet as makeFaucet } from "./faucet";
import { openFiles } from "./files";
import { decode, refusal, storeCall, walletSigners } from "./policy";
import { sessions } from "./session";
import { sponsor as makeSponsor } from "./sponsor";

const PORT = Number(process.env.PORT ?? 8790);
const DATA_DIR = process.env.DATA_DIR ?? ".data";
const PRODUCTION = process.env.NODE_ENV === "production";
const MAX_FILE = 50 * 1024 * 1024;
const MAX_COVER = 5 * 1024 * 1024;
const FAUCET_AMOUNT = 10_0000000n; // 10 USDC

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

const sessionSecret =
  process.env.SESSION_SECRET ??
  (() => {
    if (PRODUCTION) required("SESSION_SECRET");
    console.warn("SESSION_SECRET not set: using a random one, so sign-ins reset on restart");
    return randomBytes(32).toString("hex");
  })();

const db = openDb(DATA_DIR);
const files = openFiles(DATA_DIR);
const sponsor = makeSponsor(required("SPONSOR_SECRET"));
const faucet = process.env.FAUCET_SECRET ? makeFaucet(process.env.FAUCET_SECRET) : null;
const session = sessions(sessionSecret, PRODUCTION);

// ---- rate limits (per client IP, fixed windows, in memory) ----

const windows = new Map<string, { start: number; count: number }>();
function allow(c: Context, bucket: string, limit: number, windowMs: number): boolean {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || getConnInfo(c).remote.address || "unknown";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= limit;
}
const HOUR = 60 * 60 * 1000;

// ---- helpers ----

const isWallet = (s: unknown): s is string => typeof s === "string" && /^C[A-Z2-7]{55}$/.test(s);

function publicProduct(row: ProductRow, chain: ChainProduct) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creator: chain.creator,
    price: chain.price.toString(),
    feeBps: chain.fee_bps,
    shares: chain.shares.map((s) => ({ to: s.to, bps: s.bps })),
    affiliateBps: chain.affiliate_bps,
    active: chain.active,
    sales: chain.sales,
    file: { name: row.file_name, size: row.file_size, type: row.file_type },
    cover: row.cover_key ? `/api/products/${row.id}/cover` : null,
  };
}

async function withChain(rows: ProductRow[]) {
  const chains = await Promise.all(rows.map((r) => getProduct(r.id)));
  return rows.flatMap((r, i) => (chains[i] ? [publicProduct(r, chains[i]!)] : []));
}

const app = new Hono();

// ---- fee sponsor (the smart-account-kit posts { func, auth } here) ----

app.get("/api/relay/info", (c) => c.json({ sponsor: sponsor.address, store: STORE_ID }));

app.post("/api/relay", async (c) => {
  if (!allow(c, "relay", 60, HOUR)) return c.json({ success: false, error: "too many requests" }, 429);
  const decoded = decode(await c.req.json().catch(() => null));
  if (typeof decoded === "string") return c.json({ success: false, error: decoded }, 400);

  const why = refusal(decoded, sponsor.address);
  if (why) return c.json({ success: false, error: why }, 403);

  try {
    const result = await sponsor.submit(decoded);
    if (!result.ok) return c.json({ success: false, error: result.error, hash: result.hash }, 422);

    await session.prove(c, walletSigners(decoded.auth));
    const call = storeCall(decoded.func);
    if (call?.fn === "buy") {
      const buyer = Address.fromScVal(call.args[0]).toString();
      const productId = Number(scValToNative(call.args[1]));
      db.addPurchase(productId, buyer, result.hash);
    }
    return c.json({ success: true, hash: result.hash, status: "SUCCESS" });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.get("/api/me", async (c) => c.json({ wallets: await session.proven(c) }));

// ---- listing: upload details and files, list on chain, then publish ----

app.post("/api/drafts", bodyLimit({ maxSize: MAX_FILE + MAX_COVER + 64 * 1024 }), async (c) => {
  if (!allow(c, "drafts", 20, HOUR)) return c.json({ error: "too many uploads, try again later" }, 429);
  const body = await c.req.parseBody();
  const { creator, title, description, file, cover } = body;
  if (!isWallet(creator)) return c.json({ error: "creator must be a smart wallet address" }, 400);
  if (typeof title !== "string" || !title.trim() || title.length > 120) return c.json({ error: "title: 1 to 120 characters" }, 400);
  if (typeof description !== "string" || description.length > 5000) return c.json({ error: "description: up to 5000 characters" }, 400);
  if (!(file instanceof File) || file.size === 0) return c.json({ error: "add the file buyers will download" }, 400);
  if (file.size > MAX_FILE) return c.json({ error: "file is over 50 MB" }, 400);
  if (cover !== undefined && cover !== "" && !(cover instanceof File)) return c.json({ error: "cover must be an image" }, 400);
  const coverFile = cover instanceof File && cover.size > 0 ? cover : null;
  if (coverFile && (!coverFile.type.startsWith("image/") || coverFile.size > MAX_COVER)) {
    return c.json({ error: "cover must be an image under 5 MB" }, 400);
  }

  const id = randomUUID();
  db.addDraft({
    id,
    creator,
    title: title.trim(),
    description: description.trim(),
    file_key: files.save(new Uint8Array(await file.arrayBuffer())),
    file_name: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "download",
    file_type: file.type || "application/octet-stream",
    file_size: file.size,
    cover_key: coverFile ? files.save(new Uint8Array(await coverFile.arrayBuffer())) : null,
    cover_type: coverFile?.type ?? null,
    created_at: Date.now(),
  });
  return c.json({ draftId: id });
});

app.post("/api/drafts/:id/publish", async (c) => {
  const draft = db.draft(c.req.param("id"));
  if (!draft) return c.json({ error: "no such draft" }, 404);
  const { productId } = (await c.req.json().catch(() => ({}))) as { productId?: unknown };
  const id = Number(productId);
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "productId required" }, 400);

  if (!(await session.proven(c)).includes(draft.creator)) {
    return c.json({ error: "sign the listing with this wallet first" }, 403);
  }
  const chain = await getProduct(id);
  if (!chain || chain.creator !== draft.creator) return c.json({ error: "that product is not this wallet's" }, 403);
  if (db.product(id)) return c.json({ error: "product already published" }, 409);

  const row = db.publish(draft.id, id);
  return c.json(publicProduct(row, chain));
});

// ---- products ----

app.get("/api/products", async (c) => {
  const creator = c.req.query("creator");
  const rows = creator ? db.productsBy(creator) : db.latest(24);
  return c.json(await withChain(rows));
});

app.get("/api/products/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = Number.isSafeInteger(id) ? db.product(id) : undefined;
  const chain = row ? await getProduct(id) : null;
  if (!row || !chain) return c.json({ error: "product not found" }, 404);
  return c.json(publicProduct(row, chain));
});

app.get("/api/products/:id/cover", (c) => {
  const row = db.product(Number(c.req.param("id")));
  if (!row?.cover_key) return c.notFound();
  return c.body(files.stream(row.cover_key), 200, {
    "Content-Type": row.cover_type ?? "application/octet-stream",
    "Cache-Control": "public, max-age=86400",
  });
});

/** The download link, if a wallet this browser has proven owns the product. */
app.get("/api/products/:id/access", async (c) => {
  const id = Number(c.req.param("id"));
  if (!db.product(id)) return c.json({ error: "product not found" }, 404);
  for (const wallet of await session.proven(c)) {
    if (await hasPurchased(id, wallet)) {
      return c.json({ buyer: wallet, download: `/d/${session.downloadToken(id, wallet)}` });
    }
  }
  return c.json({ buyer: null, download: null });
});

app.get("/d/:token", async (c) => {
  const grant = session.readDownloadToken(c.req.param("token"));
  const row = grant ? db.product(grant.productId) : undefined;
  if (!grant || !row) return c.text("This download link is not valid.", 404);
  if (!(await hasPurchased(grant.productId, grant.buyer))) return c.text("No purchase found for this link.", 403);
  return c.body(files.stream(row.file_key), 200, {
    "Content-Type": row.file_type,
    "Content-Length": String(row.file_size),
    "Content-Disposition": `attachment; filename="${row.file_name.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-store",
  });
});

// ---- testnet faucet ----

app.post("/api/faucet", async (c) => {
  if (!faucet) return c.json({ error: "no faucet on this network" }, 404);
  const { wallet } = (await c.req.json().catch(() => ({}))) as { wallet?: unknown };
  if (!isWallet(wallet)) return c.json({ error: "wallet must be a smart wallet address" }, 400);
  if (!allow(c, "faucet", 5, HOUR) || !allow(c, `faucet:${wallet}`, 1, HOUR)) {
    return c.json({ error: "test USDC already sent recently, try again in an hour" }, 429);
  }
  const sent = await faucet.send(wallet, FAUCET_AMOUNT);
  return sent.ok ? c.json({ amount: FAUCET_AMOUNT.toString(), hash: sent.hash }) : c.json({ error: sent.error }, 502);
});

// ---- the web app (production build) ----

if (PRODUCTION) {
  const indexHtml = readFileSync("dist/index.html", "utf8");
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", (c) => c.html(indexHtml));
}

serve({ fetch: app.fetch, port: PORT, hostname: PRODUCTION ? "0.0.0.0" : "127.0.0.1" }, () => {
  console.log(`server on :${PORT}, sponsor ${sponsor.address}${faucet ? `, faucet ${faucet.address}` : ""}`);
});
