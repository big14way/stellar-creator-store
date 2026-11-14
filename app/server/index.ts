// The store's server: fee sponsor, sign-in, product details and files,
// downloads, and a testnet USDC faucet. Prices, splits and sales live in the
// contract; this server never holds anyone's money.

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Address, rpc, scValToNative, Transaction, type xdr } from "@stellar/stellar-sdk";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getProduct, hasPurchased, type ChainProduct } from "../src/chain";
import { INDEXER_URL, NETWORK, NETWORK_PASSPHRASE, RPC_URL, STORE_ID, USDC_ID } from "../src/config";
import { newChallenge, passkeyRefusal, stellarAuth, type PasskeyAssertion } from "./auth";
import { birthOf, mergeLookup } from "./births";
import { openDb, type Profile, type ProductRow } from "./db";
import { faucet as makeFaucet } from "./faucet";
import { diskFiles, sqlFiles } from "./files";
import { decode, feeBumpRefusal, refusal, storeCall, walletSigners } from "./policy";
import { sessions } from "./session";
import { sponsor as makeSponsor } from "./sponsor";
import { connect } from "./sql";

const PORT = Number(process.env.PORT ?? 8790);
const DATA_DIR = process.env.DATA_DIR ?? ".data";
const PRODUCTION = process.env.NODE_ENV === "production";
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB ?? 50);
const MAX_FILE = MAX_FILE_MB * 1024 * 1024;
const MAX_COVER = 5 * 1024 * 1024;
const FAUCET_AMOUNT = 10_0000000n; // 10 USDC
const HOUR = 60 * 60 * 1000;
const CHALLENGE_TTL = 5 * 60 * 1000;

// Where the web app is served from. Passkeys are bound to these origins.
const ORIGINS = (process.env.PUBLIC_URL ?? "http://localhost:5173,http://localhost:8790")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);
const RP_IDS = [...new Set(ORIGINS.map((o) => new URL(o).hostname))];
// Moderation: listings the operator took off the shelf and shop pages. The
// contract can't be overruled, so sales and existing buyers' downloads still work.
const HIDDEN = new Set(
  (process.env.HIDDEN_PRODUCTS ?? "").split(",").filter((s) => s.trim()).map(Number).filter(Number.isSafeInteger),
);
const onShelf = (p: { id: number; active: boolean }) => p.active && !HIDDEN.has(p.id);

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

const sql = await connect(DATA_DIR);
const db = await openDb(sql);
// Files go in the database when there is one to share, so they survive the host's restarts.
const files = sql.dialect === "postgres" ? sqlFiles(sql) : diskFiles(DATA_DIR);
const sponsor = makeSponsor(required("SPONSOR_SECRET"));
const faucet = process.env.FAUCET_SECRET ? makeFaucet(process.env.FAUCET_SECRET) : null;
const session = sessions(sessionSecret, PRODUCTION);
const stellarSignIn = stellarAuth(sessionSecret, new URL(ORIGINS[0]).host);

// ---- helpers ----

/** Per client IP (and optionally a key), fixed windows, kept in the database. */
function allow(c: Context, bucket: string, limit: number, windowMs: number): Promise<boolean> {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || getConnInfo(c).remote.address || "unknown";
  return db.allow(`${bucket}:${ip}`, limit, windowMs);
}

const isSmartWallet = (s: unknown): s is string => typeof s === "string" && /^C[A-Z2-7]{55}$/.test(s);
const isWallet = (s: unknown): s is string => typeof s === "string" && /^[CG][A-Z2-7]{55}$/.test(s);
const isHandle = (s: string) => /^[a-z0-9_]{3,24}$/.test(s);
const isOwner = async (c: Context, wallet: string) => (await session.proven(c)).includes(wallet);

function creatorOf(p: Profile | undefined) {
  return p ? { name: p.name, handle: p.handle } : null;
}

function publicProduct(row: ProductRow, chain: ChainProduct, profile?: Profile) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creator: chain.creator,
    creatorProfile: creatorOf(profile),
    price: chain.price.toString(),
    feeBps: chain.fee_bps,
    shares: chain.shares.map((s) => ({ to: s.to, bps: s.bps })),
    affiliateBps: chain.affiliate_bps,
    active: chain.active,
    sales: chain.sales,
    file: { name: row.file_name, size: row.file_size, type: row.file_type },
    cover: row.cover_key ? `/api/products/${row.id}/cover` : null,
    listedAt: row.created_at,
  };
}

async function withChain(rows: ProductRow[]) {
  const [chains, profiles] = await Promise.all([
    Promise.all(rows.map((r) => getProduct(r.id))),
    db.profiles([...new Set(rows.map((r) => r.creator))]),
  ]);
  const byWallet = new Map(profiles.map((p) => [p.wallet, p]));
  return rows.flatMap((r, i) => (chains[i] ? [publicProduct(r, chains[i]!, byWallet.get(r.creator))] : []));
}

/**
 * Whether `wallet` bought the product, from the on-chain receipt. If the
 * receipt can't be read (for example it was archived after a long quiet
 * spell), the purchase this server recorded from the successful transaction
 * stands in for it.
 */
async function owns(productId: number, wallet: string): Promise<boolean> {
  try {
    return await hasPurchased(productId, wallet);
  } catch {
    return (await db.purchaseTx(productId, wallet)) !== null;
  }
}

/** Bookkeeping after a successful `buy`, from either payment path. */
async function recordPurchase(func: xdr.HostFunction, hash: string, returnValue?: xdr.ScVal) {
  const call = storeCall(func);
  if (call?.fn !== "buy") return;
  const buyer = Address.fromScVal(call.args[0]).toString();
  const productId = Number(scValToNative(call.args[1]));
  const receipt = returnValue ? (scValToNative(returnValue) as { price?: bigint }) : null;
  await db.addPurchase(productId, buyer, hash, receipt?.price?.toString() ?? null);
}

const app = new Hono();

app.get("/api/config", (c) =>
  c.json({
    network: NETWORK,
    networkPassphrase: NETWORK_PASSPHRASE,
    store: STORE_ID,
    usdc: USDC_ID,
    sponsor: sponsor.address,
    maxFileMb: MAX_FILE_MB,
    faucet: !!faucet,
  }),
);

// ---- fee sponsor ----

app.get("/api/relay/info", (c) => c.json({ sponsor: sponsor.address, store: STORE_ID }));

/** Passkey wallets: the smart-account-kit posts { func, auth } here. */
app.post("/api/relay", async (c) => {
  if (!(await allow(c, "relay", 60, HOUR))) return c.json({ success: false, error: "too many requests" }, 429);
  const decoded = decode(await c.req.json().catch(() => null));
  if (typeof decoded === "string") return c.json({ success: false, error: decoded }, 400);

  const why = refusal(decoded, sponsor.address);
  if (why) return c.json({ success: false, error: why }, 403);

  try {
    const result = await sponsor.submit(decoded);
    if (!result.ok) return c.json({ success: false, error: result.error, hash: result.hash }, 422);
    await session.prove(c, walletSigners(decoded.auth));
    await recordPurchase(decoded.func, result.hash, result.returnValue);
    const birth = birthOf(decoded.func, result.returnValue, result.hash, result.ledger);
    if (birth) await db.addBirth(birth);
    return c.json({ success: true, hash: result.hash, status: "SUCCESS" });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/** Stellar wallets (Freighter, LOBSTR, xBull...): a signed transaction we wrap in a fee bump. */
app.post("/api/relay/fee-bump", async (c) => {
  if (!(await allow(c, "relay", 60, HOUR))) return c.json({ error: "too many requests" }, 429);
  const { xdr: envelope } = (await c.req.json().catch(() => ({}))) as { xdr?: unknown };
  let tx: Transaction;
  try {
    const parsed = new Transaction(String(envelope), NETWORK_PASSPHRASE);
    if (!(parsed instanceof Transaction) || parsed.signatures.length === 0) throw new Error();
    tx = parsed;
  } catch {
    return c.json({ error: "expected { xdr } of a signed transaction" }, 400);
  }
  const why = feeBumpRefusal(tx, sponsor.address);
  if (why) return c.json({ error: why }, 403);

  try {
    const result = await sponsor.feeBump(tx);
    if (!result.ok) return c.json({ error: result.error, hash: result.hash }, 422);
    await session.prove(c, [tx.source]);
    const op = tx.operations[0] as { func: xdr.HostFunction };
    await recordPurchase(op.func, result.hash, result.returnValue);
    return c.json({
      hash: result.hash,
      result: result.returnValue ? JSON.parse(JSON.stringify(scValToNative(result.returnValue), (_, v) => (typeof v === "bigint" ? v.toString() : v))) : null,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// ---- smart-account indexer, with the births of wallets made through us (see births.ts) ----

const chain = new rpc.Server(RPC_URL);

app.get("/api/indexer/api/lookup/:credential", async (c) => {
  const credential = c.req.param("credential").toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{2,1024}$/.test(credential)) return c.json({ error: "bad credential id" }, 400);
  const [upstream, ours, latest] = await Promise.all([
    fetch(`${INDEXER_URL}/api/lookup/${credential}`, { signal: AbortSignal.timeout(8000) }).catch(() => null),
    db.births(credential),
    chain
      .getLatestLedger()
      .then((l) => l.sequence)
      .catch(() => 0),
  ]);
  if (ours.length === 0) {
    if (!upstream) return c.json({ error: "indexer unavailable" }, 502);
    return c.body(await upstream.text(), upstream.status as 200, { "Content-Type": "application/json" });
  }
  const body = upstream?.ok ? await upstream.json().catch(() => null) : null;
  return c.json(mergeLookup(credential, body, ours, latest));
});

app.get("/api/indexer/*", async (c) => {
  const path = c.req.path.slice("/api/indexer".length);
  const upstream = await fetch(`${INDEXER_URL}${path}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!upstream) return c.json({ error: "indexer unavailable" }, 502);
  return c.body(await upstream.text(), upstream.status as 200, { "Content-Type": "application/json" });
});

// ---- sign-in ----

app.get("/api/me", async (c) => c.json({ wallets: await session.proven(c) }));

app.post("/api/auth/sign-out", (c) => {
  session.forget(c);
  return c.json({ wallets: [] });
});

app.post("/api/auth/passkey/challenge", async (c) => {
  if (!(await allow(c, "challenge", 60, HOUR))) return c.json({ error: "too many requests" }, 429);
  const challenge = newChallenge();
  await db.addNonce(challenge, CHALLENGE_TTL);
  return c.json({ challenge });
});

app.post("/api/auth/passkey", async (c) => {
  const { wallet, assertion } = (await c.req.json().catch(() => ({}))) as { wallet?: unknown; assertion?: PasskeyAssertion };
  if (!isSmartWallet(wallet) || !assertion?.response?.clientDataJSON) return c.json({ error: "expected { wallet, assertion }" }, 400);
  let challenge = "";
  try {
    challenge = JSON.parse(Buffer.from(assertion.response.clientDataJSON, "base64url").toString("utf8")).challenge ?? "";
  } catch {}
  if (!challenge || !(await db.useNonce(challenge))) return c.json({ error: "sign-in expired, try again" }, 401);
  const why = await passkeyRefusal(assertion, wallet, { challenge, origins: ORIGINS, rpIds: RP_IDS });
  if (why) return c.json({ error: why }, 401);
  return c.json({ wallets: await session.prove(c, [wallet]) });
});

app.post("/api/auth/stellar/challenge", async (c) => {
  if (!(await allow(c, "challenge", 60, HOUR))) return c.json({ error: "too many requests" }, 429);
  const { account } = (await c.req.json().catch(() => ({}))) as { account?: unknown };
  if (typeof account !== "string" || !/^G[A-Z2-7]{55}$/.test(account)) return c.json({ error: "expected { account }" }, 400);
  const { xdr, hash } = stellarSignIn.challenge(account);
  await db.addNonce(hash, CHALLENGE_TTL);
  return c.json({ xdr, networkPassphrase: NETWORK_PASSPHRASE });
});

app.post("/api/auth/stellar", async (c) => {
  const { xdr } = (await c.req.json().catch(() => ({}))) as { xdr?: unknown };
  let signed: { account: string; hash: string };
  try {
    signed = stellarSignIn.verifySigned(String(xdr));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "invalid challenge" }, 401);
  }
  if (!(await db.useNonce(signed.hash))) return c.json({ error: "sign-in expired, try again" }, 401);
  return c.json({ wallets: await session.prove(c, [signed.account]) });
});

// ---- creators: profile and storefront ----

app.put("/api/profile", async (c) => {
  const { wallet, name, bio, handle } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isSmartWallet(wallet)) return c.json({ error: "wallet must be a passkey wallet" }, 400);
  if (!(await isOwner(c, wallet))) return c.json({ error: "sign in with this wallet first" }, 403);
  if (typeof name !== "string" || !name.trim() || name.length > 60) return c.json({ error: "name: 1 to 60 characters" }, 400);
  if (typeof bio !== "string" || bio.length > 280) return c.json({ error: "bio: up to 280 characters" }, 400);
  const h = typeof handle === "string" && handle.trim() ? handle.trim().toLowerCase().replace(/^@/, "") : null;
  if (h && !isHandle(h)) return c.json({ error: "shop link: 3 to 24 letters, numbers or _" }, 400);
  if (h) {
    const taken = await db.profileByHandle(h);
    if (taken && taken.wallet !== wallet) return c.json({ error: `@${h} is taken` }, 409);
  }
  const profile = { wallet, name: name.trim(), bio: bio.trim(), handle: h, updated_at: Date.now() };
  await db.saveProfile(profile);
  return c.json(profile);
});

app.get("/api/creators/:id", async (c) => {
  const id = c.req.param("id");
  const byAddress = /^[CG][A-Z2-7]{55}$/.test(id);
  const profile = byAddress ? await db.profile(id) : await db.profileByHandle(id.toLowerCase().replace(/^@/, ""));
  const wallet = profile?.wallet ?? (byAddress ? id : null);
  if (!wallet) return c.json({ error: "no such shop" }, 404);
  // Paused products stay in the creator's dashboard but leave the shop window.
  const products = (await withChain(await db.productsBy(wallet))).filter(onShelf);
  return c.json({ wallet, profile: profile ? { name: profile.name, bio: profile.bio, handle: profile.handle } : null, products });
});

// ---- listing: upload details and files, list on chain, then publish ----

app.post("/api/drafts", bodyLimit({ maxSize: MAX_FILE + MAX_COVER + 64 * 1024 }), async (c) => {
  if (!(await allow(c, "drafts", 20, HOUR))) return c.json({ error: "too many uploads, try again later" }, 429);
  const body = await c.req.parseBody();
  const { creator, title, description, file, cover } = body;
  if (!isSmartWallet(creator)) return c.json({ error: "creator must be a passkey wallet address" }, 400);
  if (typeof title !== "string" || !title.trim() || title.length > 120) return c.json({ error: "title: 1 to 120 characters" }, 400);
  if (typeof description !== "string" || description.length > 5000) return c.json({ error: "description: up to 5000 characters" }, 400);
  if (!(file instanceof File) || file.size === 0) return c.json({ error: "add the file buyers will download" }, 400);
  if (file.size > MAX_FILE) return c.json({ error: `file is over ${MAX_FILE_MB} MB` }, 400);
  if (cover !== undefined && cover !== "" && !(cover instanceof File)) return c.json({ error: "cover must be an image" }, 400);
  const coverFile = cover instanceof File && cover.size > 0 ? cover : null;
  if (coverFile && (!coverFile.type.startsWith("image/") || coverFile.size > MAX_COVER)) {
    return c.json({ error: "cover must be an image under 5 MB" }, 400);
  }

  const id = randomUUID();
  await db.addDraft({
    id,
    creator,
    title: title.trim(),
    description: description.trim(),
    file_key: await files.save(new Uint8Array(await file.arrayBuffer())),
    file_name: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "download",
    file_type: file.type || "application/octet-stream",
    file_size: file.size,
    cover_key: coverFile ? await files.save(new Uint8Array(await coverFile.arrayBuffer())) : null,
    cover_type: coverFile?.type ?? null,
    created_at: Date.now(),
  });
  return c.json({ draftId: id });
});

app.post("/api/drafts/:id/publish", async (c) => {
  const draft = await db.draft(c.req.param("id"));
  if (!draft) return c.json({ error: "no such draft" }, 404);
  const { productId } = (await c.req.json().catch(() => ({}))) as { productId?: unknown };
  const id = Number(productId);
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "productId required" }, 400);

  if (!(await isOwner(c, draft.creator))) return c.json({ error: "sign the listing with this wallet first" }, 403);
  const chain = await getProduct(id);
  if (!chain || chain.creator !== draft.creator) return c.json({ error: "that product is not this wallet's" }, 403);
  if (await db.product(id)) return c.json({ error: "product already published" }, 409);

  const row = await db.publish(draft, id);
  return c.json(publicProduct(row, chain, await db.profile(row.creator)));
});

/** Title and description; price and pausing are on chain (`update_product`). */
app.patch("/api/products/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = Number.isSafeInteger(id) ? await db.product(id) : undefined;
  if (!row) return c.json({ error: "product not found" }, 404);
  if (!(await isOwner(c, row.creator))) return c.json({ error: "sign in as this product's creator" }, 403);
  const { title, description } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim() || title.length > 120) return c.json({ error: "title: 1 to 120 characters" }, 400);
  if (typeof description !== "string" || description.length > 5000) return c.json({ error: "description: up to 5000 characters" }, 400);
  await db.updateDetails(id, title.trim(), description.trim());
  return c.json({ ok: true });
});

// ---- sales (purchases made through this store; each is on chain) ----

app.get("/api/sales", async (c) => {
  const creator = c.req.query("creator");
  const rows = await db.recentSales(creator ? 50 : 12, isWallet(creator) ? creator : undefined);
  return c.json(
    rows.map((s) => ({
      productId: s.product_id,
      title: s.title,
      price: s.price,
      buyer: s.buyer,
      txHash: s.tx_hash,
      at: s.created_at,
    })),
  );
});

// ---- products ----

app.get("/api/products", async (c) => {
  const creator = c.req.query("creator");
  // The creator's own list (dashboard) includes paused products; the public shelf doesn't.
  if (creator) return c.json(await withChain(await db.productsBy(creator)));
  return c.json((await withChain(await db.latest(48))).filter(onShelf).slice(0, 24));
});

app.get("/api/products/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = Number.isSafeInteger(id) ? await db.product(id) : undefined;
  const chain = row ? await getProduct(id) : null;
  if (!row || !chain) return c.json({ error: "product not found" }, 404);
  return c.json(publicProduct(row, chain, await db.profile(row.creator)));
});

app.get("/api/products/:id/cover", async (c) => {
  const row = await db.product(Number(c.req.param("id")));
  const body = row?.cover_key ? await files.body(row.cover_key) : null;
  if (!row || !body) return c.notFound();
  return c.body(body, 200, {
    "Content-Type": row.cover_type ?? "application/octet-stream",
    "Cache-Control": "public, max-age=86400",
  });
});

/** The download link, if a wallet this browser has proven owns the product. */
app.get("/api/products/:id/access", async (c) => {
  const id = Number(c.req.param("id"));
  if (!(await db.product(id))) return c.json({ error: "product not found" }, 404);
  for (const wallet of await session.proven(c)) {
    if (await owns(id, wallet)) {
      return c.json({
        buyer: wallet,
        download: `/d/${session.downloadToken(id, wallet)}`,
        txHash: await db.purchaseTx(id, wallet),
      });
    }
  }
  return c.json({ buyer: null, download: null, txHash: null });
});

/** Everything the wallets proven in this browser bought, with download links. */
app.get("/api/library", async (c) => {
  const wallets = await session.proven(c);
  const rows = await db.purchasesBy(wallets);
  const owned = await Promise.all(rows.map((r) => owns(r.id, r.buyer)));
  return c.json({
    wallets,
    items: rows
      .filter((_, i) => owned[i])
      .map((r) => ({
        productId: r.id,
        title: r.title,
        file: { name: r.file_name, size: r.file_size },
        cover: r.cover_key ? `/api/products/${r.id}/cover` : null,
        buyer: r.buyer,
        paid: r.paid,
        txHash: r.tx_hash,
        at: r.bought_at,
        download: `/d/${session.downloadToken(r.id, r.buyer)}`,
      })),
  });
});

app.get("/d/:token", async (c) => {
  const grant = session.readDownloadToken(c.req.param("token"));
  const row = grant ? await db.product(grant.productId) : undefined;
  if (!grant || !row) return c.text("This download link is not valid.", 404);
  if (!(await owns(grant.productId, grant.buyer))) return c.text("No purchase found for this link.", 403);
  const body = await files.body(row.file_key);
  if (!body) return c.text("This file is missing. Contact the creator.", 410);
  return c.body(body, 200, {
    "Content-Type": row.file_type,
    "Content-Length": String(row.file_size),
    "Content-Disposition": `attachment; filename="${row.file_name.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-store",
  });
});

// ---- naira and cedi estimates (mid-market, refreshed daily by the source) ----

let rates: { fetched: number; body: { NGN: number; GHS: number; updated: string; source: string } } | null = null;
app.get("/api/rates", async (c) => {
  if (!rates || Date.now() - rates.fetched > 6 * HOUR) {
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5000) });
      const data = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
      if (data.result === "success" && data.rates?.NGN && data.rates?.GHS) {
        rates = {
          fetched: Date.now(),
          body: { NGN: data.rates.NGN, GHS: data.rates.GHS, updated: data.time_last_update_utc ?? "", source: "https://www.exchangerate-api.com" },
        };
      }
    } catch {}
  }
  return rates ? c.json(rates.body, 200, { "Cache-Control": "public, max-age=3600" }) : c.json({ error: "rates unavailable" }, 503);
});

// ---- testnet faucet ----

app.post("/api/faucet", async (c) => {
  if (!faucet) return c.json({ error: "no faucet on this network" }, 404);
  const { wallet } = (await c.req.json().catch(() => ({}))) as { wallet?: unknown };
  if (!isWallet(wallet)) return c.json({ error: "wallet must be a Stellar address" }, 400);
  if (!(await allow(c, "faucet", 5, HOUR)) || !(await db.allow(`faucet:${wallet}`, 1, HOUR))) {
    return c.json({ error: "test USDC already sent recently, try again in an hour" }, 429);
  }
  const sent = await faucet.send(wallet, FAUCET_AMOUNT);
  return sent.ok ? c.json({ amount: FAUCET_AMOUNT.toString(), hash: sent.hash }) : c.json({ error: sent.error }, 502);
});

// ---- the web app (production build) ----

if (PRODUCTION) {
  const indexHtml = readFileSync("dist/index.html", "utf8");
  app.use("/assets/*", serveStatic({ root: "./dist", onFound: (_, c) => c.header("Cache-Control", "public, max-age=31536000, immutable") }));
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", (c) => c.html(indexHtml));
}

serve({ fetch: app.fetch, port: PORT, hostname: PRODUCTION ? "0.0.0.0" : "127.0.0.1" }, () => {
  console.log(
    `server on :${PORT} (${sql.dialect}), sponsor ${sponsor.address}${faucet ? `, faucet ${faucet.address}` : ""}, origins ${ORIGINS.join(" ")}`,
  );
});
