// The whole store on testnet, in real browsers with virtual passkeys:
//
// 1. A creator creates a passkey wallet and lists a file for 3 USDC with a
//    20% co-creator (whose wallet can't receive USDC yet) and a 10% affiliate.
// 2. A buyer opens it through an affiliate's link, creates a passkey wallet,
//    takes test USDC from the faucet, pays and downloads.
// 3. A second buyer pays from a Stellar wallet (a G... account, as Freighter
//    or LOBSTR would hold): funds it, adds USDC, pays; we pay the fee.
// 4. The creator signs in on a second device with the same passkey, sees the
//    sales, pays out the co-creator's held share, pauses and resumes the
//    product, and names their shop.
// 5. The first buyer opens their library on another device.
//
// Checks the downloaded bytes, the download link's rules, and every payout
// on chain. No passkey wallet ever holds XLM: the server's sponsor pays.
//
// Needs the stellar CLI. Creates or tops up testnet identities cs-sponsor,
// cs-faucet and cs-affiliate, and a fresh co-creator each run.
//
// APP_URL=https://paperstall.onrender.com runs the same checks against a
// deployed site instead of starting one (its own faucet must hold test USDC).
// There the listing is named as a test and paused at the end, so it leaves
// the public shelf.

import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { STORE_ID, USDC_ID } from "../src/config";

const NATIVE_XLM_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC_ASSET = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ONE = 10_000_000n;
const HOSTED = !!process.env.APP_URL;
const APP = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""); // WebAuthn needs a domain, not an IP
const TITLE = `${HOSTED ? "Test run: " : ""}Lagos Nights beat pack`;
const DATA_DIR = ".data-test";
const LONG = 180_000;
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const children: ChildProcess[] = [];
// Each child leads its own process group, so stopping it also stops what pnpm started (vite, tsx).
const stop = () =>
  children.forEach((c) => {
    try {
      process.kill(-c.pid!, "SIGTERM");
    } catch {}
  });
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

/** The stellar CLI, retried when testnet times out (every call here is safe to repeat). */
function cli(...args: string[]): string {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (err) {
      const text = String((err as { stderr?: string }).stderr ?? err);
      if (attempt >= 4 || !/timeout|timed out|503|502|connection/i.test(text)) throw err;
      execFileSync("sleep", [String(attempt * 3)]);
    }
  }
}
const addr = (name: string) => cli("keys", "address", name);
const read = (id: string, ...args: string[]) =>
  cli("contract", "invoke", "--id", id, "--source", "cs-sponsor", "--network", "testnet", "--send=no", "--", ...args).replace(/"/g, "");
const balance = (token: string, who: string) => BigInt(read(token, "balance", "--id", who));

function ensureKey(name: string) {
  try {
    addr(name);
  } catch {
    cli("keys", "generate", name, "--network", "testnet", "--fund");
  }
}

function ensureUsdc(name: string, min: bigint) {
  cli("tx", "new", "change-trust", "--source", name, "--line", USDC_ASSET, "--network", "testnet");
  if (min === 0n || balance(USDC_ID, addr(name)) >= min) return;
  cli(
    "tx", "new", "path-payment-strict-receive", "--source", name, "--network", "testnet",
    "--send-asset", "native", "--send-max", (2_000n * ONE).toString(), "--destination", addr(name),
    "--dest-asset", USDC_ASSET, "--dest-amount", (min * 2n).toString(),
  );
}

function start(cmd: string, args: string[], env: Record<string, string> = {}) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const tag = args.at(-1);
  child.stdout?.on("data", (d) => process.stdout.write(`  [${tag}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`  [${tag}] ${d}`));
  children.push(child);
}

async function waitFor(url: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${url}`);
}

let failures = 0;
let checks = 0;
let openBrowser: Browser | null = null;
function check(ok: boolean, what: string) {
  checks++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type Person = { page: Page; context: BrowserContext; cdp: CDPSession; authenticatorId: string };

/** A page in its own browser context, with its own virtual passkey authenticator. */
async function person(browser: Browser, name: string, setup?: (c: BrowserContext) => Promise<void>): Promise<Person> {
  const context = await browser.newContext();
  if (setup) await setup(context);
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`  [${name}] ${m.text()}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { page, context, cdp, authenticatorId };
}

/** The same person on another device: a new browser with only their passkey (as when passkeys sync). */
async function sameOnAnotherDevice(browser: Browser, from: Person, name: string): Promise<Person> {
  const other = await person(browser, name);
  const { credentials } = await from.cdp.send("WebAuthn.getCredentials", { authenticatorId: from.authenticatorId });
  for (const credential of credentials) {
    await other.cdp.send("WebAuthn.addCredential", { authenticatorId: other.authenticatorId, credential });
  }
  return other;
}

async function failWith(page: Page, what: string): Promise<never> {
  const err = await page.getByTestId("error").first().textContent({ timeout: 1000 }).catch(() => null);
  const step = await page.getByTestId("step").textContent({ timeout: 1000 }).catch(() => null);
  throw new Error(`${what}${err ? `: ${err}` : ""}${step ? ` (at: ${step})` : ""}`);
}

async function portFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/`);
    return false;
  } catch {
    return true;
  }
}

async function xlmOf(account: string): Promise<string> {
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${account}`);
  const body = (await res.json()) as { balances: { asset_type: string; balance: string }[] };
  return body.balances.find((b) => b.asset_type === "native")!.balance;
}

async function main() {
  console.log("== setup");
  if (!HOSTED) {
    for (const port of [5173, 8790]) {
      if (!(await portFree(port))) throw new Error(`port ${port} is in use; stop the dev server or server first`);
    }
  }
  for (const name of ["cs-sponsor", "cs-faucet", "cs-affiliate"]) ensureKey(name);
  if (!HOSTED) ensureUsdc("cs-faucet", 30n * ONE);
  ensureUsdc("cs-affiliate", 0n);
  // A co-creator whose account exists but can't hold USDC yet.
  const coName = `cs-co-${Date.now()}`;
  cli("keys", "generate", coName, "--network", "testnet", "--fund");
  const coCreator = addr(coName);

  if (HOSTED) {
    // A free host may be asleep; the first request wakes it.
    await waitFor(`${APP}/api/config`, 180);
  } else {
    rmSync(DATA_DIR, { recursive: true, force: true });
    start("pnpm", ["api"], {
      SPONSOR_SECRET: cli("keys", "show", "cs-sponsor"),
      FAUCET_SECRET: cli("keys", "show", "cs-faucet"),
      SESSION_SECRET: randomBytes(32).toString("hex"),
      DATA_DIR,
    });
    start("pnpm", ["dev"]);
    await waitFor(`${APP}/api/config`);
    await waitFor(APP);
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  openBrowser = browser;
  const fileBytes = randomBytes(300 * 1024);
  const fileHash = createHash("sha256").update(fileBytes).digest("hex");
  const price = 3n * ONE;

  console.log("== creator lists a product");
  const creatorP = await person(browser, "creator");
  const creatorPage = creatorP.page;
  await creatorPage.goto(`${APP}/sell`);
  await creatorPage.getByRole("button", { name: "Create my wallet" }).click();
  await creatorPage.locator("input[name=title]").waitFor({ timeout: LONG }).catch(() => failWith(creatorPage, "wallet not created"));
  const creator = (await creatorPage.getByTestId("wallet").getAttribute("title"))!;
  console.log(`creator wallet ${creator}`);

  await creatorPage.locator("input[name=title]").fill(TITLE);
  await creatorPage.locator("textarea[name=description]").fill("Ten afrobeats instrumentals, WAV and stems.");
  await creatorPage.locator("input[name=file]").setInputFiles({ name: "lagos-nights.zip", mimeType: "application/zip", buffer: fileBytes });
  await creatorPage.locator("input[name=cover]").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG_1PX });
  await creatorPage.getByLabel("Price in USDC").fill("3");
  await creatorPage.getByLabel("Affiliate share, %").fill("10");
  await creatorPage.getByRole("button", { name: "Add a co-creator" }).click();
  await creatorPage.getByLabel("Co-creator 1 wallet").fill(coCreator);
  await creatorPage.getByLabel("Co-creator 1 share, %").fill("20");
  await creatorPage.getByRole("button", { name: "List it" }).click();
  await creatorPage.waitForURL(/\/p\/\d+$/, { timeout: LONG }).catch(() => failWith(creatorPage, "listing failed"));
  const productId = creatorPage.url().split("/").pop()!;
  console.log(`listed product ${productId}`);
  check((await creatorPage.getByTestId("price").textContent())?.includes("$3.00") ?? false, "product page shows $3.00");

  console.log("== buyer 1: passkey wallet, through an affiliate link");
  const affiliate = addr("cs-affiliate");
  const affiliateBefore = balance(USDC_ID, affiliate);
  const buyerP = await person(browser, "buyer");
  const buyerPage = buyerP.page;
  await buyerPage.goto(`${APP}/p/${productId}?ref=${affiliate}`);
  await buyerPage.getByTestId("buy").click();
  await buyerPage.getByTestId("topup").waitFor({ timeout: LONG }).catch(() => failWith(buyerPage, "no top-up prompt"));
  const buyer = (await buyerPage.getByTestId("wallet").getAttribute("title"))!;
  console.log(`buyer wallet ${buyer}, empty: asked to add USDC`);

  await buyerPage.getByTestId("faucet").click();
  await buyerPage.getByTestId("balance").waitFor({ timeout: 120_000 }).catch(() => failWith(buyerPage, "faucet failed"));
  await buyerPage.getByTestId("buy").click();
  await buyerPage.getByTestId("download").waitFor({ timeout: LONG }).catch(() => failWith(buyerPage, "purchase failed"));
  const href = (await buyerPage.getByTestId("download").getAttribute("href"))!;

  const got = await buyerPage.request.get(`${APP}${href}`);
  const gotHash = createHash("sha256").update(await got.body()).digest("hex");
  check(got.status() === 200 && gotHash === fileHash, "buyer downloads exactly the file the creator uploaded");
  check((got.headers()["content-disposition"] ?? "").includes("lagos-nights.zip"), "download keeps the original file name");

  const stranger = await (await browser.newContext()).newPage();
  check((await stranger.request.get(`${APP}${href}`)).status() === 200, "the saved link works on another device");
  const strangerAccess = await (await stranger.request.get(`${APP}/api/products/${productId}/access`)).json();
  check(strangerAccess.download === null, "another browser can't get a link without buying");
  const forged = href.replace(/.$/, href.endsWith("A") ? "B" : "A");
  check((await stranger.request.get(`${APP}${forged}`)).status() === 404, "a forged link is refused");

  console.log("== buyer 2: a Stellar wallet (G account), fee paid by the store");
  const gKey = Keypair.random();
  const gBuyer = await person(browser, "stellar-buyer", async (context) => {
    await context.exposeFunction("__paperstallSign", (xdr: string) => {
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      tx.sign(gKey);
      return tx.toXDR();
    });
    // A plain string: a compiled function would carry build helpers the page doesn't have.
    await context.addInitScript(
      `window.__paperstallTestWallet = { address: ${JSON.stringify(gKey.publicKey())}, sign: (xdr) => window.__paperstallSign(xdr) };`,
    );
  });
  const gPage = gBuyer.page;
  await gPage.goto(`${APP}/p/${productId}`);
  await gPage.getByTestId("stellar-connect").click();
  await gPage.getByText("Test wallet").first().click({ timeout: 30_000 });
  await gPage.getByTestId("stellar-fund").click({ timeout: 60_000 }).catch(() => failWith(gPage, "no Friendbot step"));
  await gPage.getByTestId("stellar-trust").click({ timeout: 60_000 }).catch(() => failWith(gPage, "no add-USDC step"));
  await gPage.getByTestId("stellar-faucet").click({ timeout: 60_000 }).catch(() => failWith(gPage, "no faucet step"));
  await gPage.getByTestId("pay-stellar").waitFor({ timeout: 120_000 }).catch(() => failWith(gPage, "not ready to pay"));
  const xlmBefore = await xlmOf(gKey.publicKey());
  await gPage.getByTestId("pay-stellar").click();
  await gPage.getByTestId("download").waitFor({ timeout: LONG }).catch(() => failWith(gPage, "Stellar wallet purchase failed"));
  const gHref = (await gPage.getByTestId("download").getAttribute("href"))!;
  const gGot = await gPage.request.get(`${APP}${gHref}`);
  check(
    createHash("sha256").update(await gGot.body()).digest("hex") === fileHash,
    "the Stellar wallet buyer downloads the same file",
  );
  check((await xlmOf(gKey.publicKey())) === xlmBefore, "the Stellar wallet paid no XLM for the purchase: the store fee-bumped it");

  console.log("== creator on a second device");
  const creator2 = await sameOnAnotherDevice(browser, creatorP, "creator-device-2");
  const c2 = creator2.page;
  await c2.goto(`${APP}/dashboard`);
  await c2.getByRole("button", { name: "Sign in" }).last().click();
  await c2
    .waitForFunction(
      () => {
        const text = document.querySelector("[data-testid=balance]")?.textContent;
        return !!text && !text.includes("…");
      },
      null,
      { timeout: LONG },
    )
    .catch(() => failWith(c2, "second-device sign-in failed"));
  check((await c2.getByTestId("wallet").getAttribute("title")) === creator, "the passkey signs in to the same wallet on a new device");
  // 3.00 less 5% fee and 20% co-creator, from both sales; less 10% affiliate on the first
  check((await c2.getByTestId("balance").textContent()) === "$4.20", "dashboard shows the creator's $4.20 from two sales");
  check((await c2.getByTestId("sales").textContent()) === "2", "dashboard shows 2 sales");
  check((await c2.getByTestId("sales-table").locator("tbody tr").count()) === 2, "both sales are listed with their transactions");

  await c2.getByTestId("co-held").waitFor({ timeout: 60_000 }).catch(() => failWith(c2, "held co-creator share not shown"));
  check((await c2.getByTestId("co-held").textContent())?.includes("$1.20") ?? false, "dashboard shows $1.20 held for the co-creator");
  ensureUsdc(coName, 0n); // the co-creator adds a USDC trustline
  await c2.getByTestId("co-held").getByRole("button", { name: "Pay out" }).click();
  await c2.getByTestId("co-held").waitFor({ state: "detached", timeout: LONG }).catch(() => failWith(c2, "pay-out failed"));
  check(balance(USDC_ID, coCreator) === (price * 2n * 20n) / 100n, "co-creator received both 20% shares, 1.20 USDC");

  await c2.getByTestId(`toggle-${productId}`).click();
  await c2.locator(".pill", { hasText: "Paused" }).waitFor({ timeout: LONG }).catch(() => failWith(c2, "pause failed"));
  const paused = await (await c2.request.get(`${APP}/api/products/${productId}`)).json();
  check(paused.active === false, "the creator paused sales on chain");
  const shelf = (await (await c2.request.get(`${APP}/api/products`)).json()) as { id: number }[];
  check(!shelf.some((p) => String(p.id) === productId), "a paused product leaves the public shelf");
  await c2.getByTestId(`toggle-${productId}`).click();
  await c2.locator(".pill", { hasText: "Paused" }).waitFor({ state: "detached", timeout: LONG }).catch(() => failWith(c2, "resume failed"));

  const handle = `ada${Date.now() % 100000}`;
  await c2.locator("input[name=name]").fill("Ada's Beat Lab");
  await c2.locator("input[name=handle]").fill(handle);
  await c2.getByTestId("save-profile").click();
  await c2.getByRole("link", { name: "Open your shop" }).waitFor({ timeout: 60_000 }).catch(() => failWith(c2, "profile not saved"));
  await stranger.goto(`${APP}/c/${handle}`);
  await stranger.getByTestId("shop-name").waitFor();
  check((await stranger.getByTestId("shop-name").textContent()) === "Ada's Beat Lab", "the shop page shows the creator's name");
  check((await stranger.getByText("Lagos Nights beat pack").count()) > 0, "the shop page lists the product");
  if (HOSTED) {
    // Take the test listing off the live shelf (sales and downloads keep working).
    await c2.getByTestId(`toggle-${productId}`).click();
    await c2.locator(".pill", { hasText: "Paused" }).waitFor({ timeout: LONG }).catch(() => failWith(c2, "final pause failed"));
  }

  console.log("== buyer 1's library on another device");
  const buyer2 = await sameOnAnotherDevice(browser, buyerP, "buyer-device-2");
  await buyer2.page.goto(`${APP}/library`);
  await buyer2.page.getByRole("button", { name: "Sign in with a passkey" }).first().click();
  await buyer2.page.getByTestId("library").waitFor({ timeout: LONG }).catch(() => failWith(buyer2.page, "library sign-in failed"));
  const libHref = (await buyer2.page.getByTestId("library-download").first().getAttribute("href"))!;
  const libGot = await buyer2.page.request.get(`${APP}${libHref}`);
  check(createHash("sha256").update(await libGot.body()).digest("hex") === fileHash, "the library downloads the file on a new device");
  await browser.close();

  console.log("== on chain");
  check(read(STORE_ID, "has_purchased", "--product_id", productId, "--buyer", buyer) === "true", "receipt recorded for the passkey buyer");
  check(
    read(STORE_ID, "has_purchased", "--product_id", productId, "--buyer", gKey.publicKey()) === "true",
    "receipt recorded for the Stellar wallet buyer",
  );
  check(balance(USDC_ID, creator) === (price * 65n) / 100n + (price * 75n) / 100n, "creator holds 4.20 USDC");
  check(balance(USDC_ID, affiliate) - affiliateBefore === price / 10n, "affiliate received 0.30 USDC, only for the referred sale");
  check(balance(USDC_ID, buyer) === 7n * ONE, "passkey buyer has 7 of the 10 test USDC left");
  check(balance(USDC_ID, gKey.publicKey()) === 7n * ONE, "Stellar wallet buyer has 7 of the 10 test USDC left");
  check(read(STORE_ID, "owed", "--to", coCreator) === "0", "nothing is left held in the contract");
  check(balance(NATIVE_XLM_ID, creator) === 0n && balance(NATIVE_XLM_ID, buyer) === 0n, "neither passkey wallet holds XLM: every fee was sponsored");

  console.log(failures ? `\n${failures} of ${checks} checks failed` : `\nall ${checks} checks passed`);
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await openBrowser?.close().catch(() => {});
    stop();
    process.exit();
  });
