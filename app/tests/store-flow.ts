// The whole store on testnet, in real browsers with virtual passkeys:
//
// 1. A creator creates a passkey wallet and lists a file for 3 USDC with a
//    10% affiliate share.
// 2. A buyer opens the product through an affiliate's link, creates a passkey
//    wallet, gets test USDC from the faucet, pays and downloads the file.
//
// Checks the downloaded bytes, the download link's rules, and every payout on
// chain. Neither wallet ever holds XLM: the server's sponsor pays all fees.
//
// Needs the stellar CLI. Creates or tops up testnet identities cs-sponsor,
// cs-faucet and cs-affiliate.

import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { STORE_ID, USDC_ID } from "../src/config";

const NATIVE_XLM_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC_ASSET = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ONE = 10_000_000n;
const APP = "http://localhost:5173"; // WebAuthn needs a domain, not an IP
const DATA_DIR = ".data-test";
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

const cli = (...args: string[]) =>
  execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
  if (balance(USDC_ID, addr(name)) >= min) return;
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
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** A page in its own browser context, with its own virtual passkey authenticator. */
async function personWithPasskey(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`  [${name}] ${m.text()}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return page;
}

async function failWith(page: Page, what: string): Promise<never> {
  const err = await page.getByTestId("error").textContent().catch(() => null);
  const step = await page.getByTestId("step").textContent().catch(() => null);
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

async function main() {
  console.log("== setup");
  for (const port of [5173, 8790]) {
    if (!(await portFree(port))) throw new Error(`port ${port} is in use; stop the dev server or server first`);
  }
  for (const name of ["cs-sponsor", "cs-faucet", "cs-affiliate"]) ensureKey(name);
  ensureUsdc("cs-faucet", 30n * ONE);
  ensureUsdc("cs-affiliate", 0n);
  rmSync(DATA_DIR, { recursive: true, force: true });
  start("pnpm", ["api"], {
    SPONSOR_SECRET: cli("keys", "show", "cs-sponsor"),
    FAUCET_SECRET: cli("keys", "show", "cs-faucet"),
    DATA_DIR,
  });
  start("pnpm", ["dev"]);
  await waitFor(`${APP}/api/relay/info`);
  await waitFor(APP);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const fileBytes = randomBytes(300 * 1024);
  const fileHash = createHash("sha256").update(fileBytes).digest("hex");

  console.log("== creator lists a product");
  const creatorPage = await personWithPasskey(browser, "creator");
  await creatorPage.goto(`${APP}/sell`);
  await creatorPage.getByRole("button", { name: "Create my wallet" }).click();
  await creatorPage.locator("input[name=title]").waitFor({ timeout: 180_000 }).catch(() => failWith(creatorPage, "wallet not created"));
  const creator = (await creatorPage.getByTestId("wallet").getAttribute("title"))!;
  console.log(`creator wallet ${creator}`);

  await creatorPage.locator("input[name=title]").fill("Lagos Nights beat pack");
  await creatorPage.locator("textarea[name=description]").fill("Ten afrobeats instrumentals, WAV and stems.");
  await creatorPage.locator("input[name=file]").setInputFiles({ name: "lagos-nights.zip", mimeType: "application/zip", buffer: fileBytes });
  await creatorPage.locator("input[name=cover]").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG_1PX });
  await creatorPage.getByLabel("Price in USDC").fill("3");
  await creatorPage.getByLabel("Affiliate share, %").fill("10");
  await creatorPage.getByRole("button", { name: "List it" }).click();
  await creatorPage.waitForURL(/\/p\/\d+$/, { timeout: 180_000 }).catch(() => failWith(creatorPage, "listing failed"));
  const productId = creatorPage.url().split("/").pop()!;
  console.log(`listed product ${productId}`);
  check((await creatorPage.getByTestId("price").textContent())?.includes("$3.00") ?? false, "product page shows $3.00");

  console.log("== buyer arrives through an affiliate link");
  const affiliate = addr("cs-affiliate");
  const affiliateBefore = balance(USDC_ID, affiliate);
  const buyerPage = await personWithPasskey(browser, "buyer");
  await buyerPage.goto(`${APP}/p/${productId}?ref=${affiliate}`);
  await buyerPage.getByTestId("buy").click();
  await buyerPage.getByTestId("topup").waitFor({ timeout: 180_000 }).catch(() => failWith(buyerPage, "no top-up prompt"));
  const buyer = (await buyerPage.getByTestId("wallet").getAttribute("title"))!;
  console.log(`buyer wallet ${buyer}, empty: asked to add USDC`);

  await buyerPage.getByTestId("faucet").click();
  await buyerPage.getByTestId("balance").waitFor({ timeout: 120_000 }).catch(() => failWith(buyerPage, "faucet failed"));
  console.log(`after faucet: ${await buyerPage.getByTestId("balance").textContent()}`);

  await buyerPage.getByTestId("buy").click();
  await buyerPage.getByTestId("download").waitFor({ timeout: 180_000 }).catch(() => failWith(buyerPage, "purchase failed"));
  const href = (await buyerPage.getByTestId("download").getAttribute("href"))!;
  console.log(`bought; download link ${href.slice(0, 24)}…`);

  console.log("== download");
  const got = await buyerPage.request.get(`${APP}${href}`);
  const gotHash = createHash("sha256").update(await got.body()).digest("hex");
  check(got.status() === 200 && gotHash === fileHash, "buyer downloads exactly the file the creator uploaded");
  check(
    (got.headers()["content-disposition"] ?? "").includes("lagos-nights.zip"),
    "download keeps the original file name",
  );

  const stranger = await (await browser.newContext()).newPage();
  check((await stranger.request.get(`${APP}${href}`)).status() === 200, "the saved link works on another device");
  const strangerAccess = await (await stranger.request.get(`${APP}/api/products/${productId}/access`)).json();
  check(strangerAccess.download === null, "another browser can't get a link without buying");
  const forged = href.replace(/.$/, href.endsWith("A") ? "B" : "A");
  check((await stranger.request.get(`${APP}${forged}`)).status() === 404, "a forged link is refused");

  console.log("== creator dashboard");
  await creatorPage.goto(`${APP}/dashboard`);
  await creatorPage.waitForFunction(() => {
    const text = document.querySelector("[data-testid=balance]")?.textContent;
    return !!text && !text.includes("…");
  });
  check((await creatorPage.getByTestId("balance").textContent()) === "$2.55", "dashboard shows the creator's $2.55");
  check((await creatorPage.getByTestId("sales").textContent()) === "1", "dashboard shows 1 sale");
  await browser.close();

  console.log("== on chain");
  const price = 3n * ONE;
  check(read(STORE_ID, "has_purchased", "--product_id", productId, "--buyer", buyer) === "true", "receipt recorded for the buyer");
  check(balance(USDC_ID, creator) === (price * 85n) / 100n, "creator wallet holds 2.55 USDC (minus 5% fee, 10% affiliate)");
  check(balance(USDC_ID, affiliate) - affiliateBefore === price / 10n, "affiliate received 0.30 USDC");
  check(balance(USDC_ID, buyer) === 7n * ONE, "buyer has 7 of the 10 test USDC left");
  check(balance(NATIVE_XLM_ID, creator) === 0n && balance(NATIVE_XLM_ID, buyer) === 0n, "neither wallet holds XLM: every fee was sponsored");

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(stop);
