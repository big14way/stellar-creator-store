// End-to-end on testnet: a buyer creates a passkey wallet in a real browser,
// receives USDC, and buys a product from the store. Chrome's virtual
// authenticator stands in for Touch ID / Face ID, so the WebAuthn signature is
// real and is verified on-chain by the wallet contract.
//
// Checks: the sale is recorded, the creator is paid, and the buyer's wallet
// never held or spent any XLM (the relayer paid every fee).
//
// Needs the stellar CLI with the testnet identities from
// scripts/testnet-e2e.sh (cs-creator, cs-buyer with USDC).

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chromium } from "playwright";
import { STORE_ID, USDC_ID } from "../src/config";

const NATIVE_XLM_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const ONE = 10_000_000n;
const PRICE = 5n * ONE;
const APP = "http://localhost:5173"; // WebAuthn needs a domain, not an IP

const children: ChildProcess[] = [];
const stop = () => children.forEach((c) => c.kill());
process.on("exit", stop);

function cli(...args: string[]): string {
  return execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const addr = (name: string) => cli("keys", "address", name);
const read = (id: string, ...args: string[]) =>
  cli("contract", "invoke", "--id", id, "--source", "cs-creator", "--network", "testnet", "--send=no", "--", ...args).replace(
    /"/g,
    "",
  );
const balance = (token: string, who: string) => BigInt(read(token, "balance", "--id", who));

function ensureKey(name: string) {
  try {
    addr(name);
  } catch {
    cli("keys", "generate", name, "--network", "testnet", "--fund");
  }
}

function start(cmd: string, args: string[], env: Record<string, string> = {}) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d) => process.stdout.write(`  [${args.at(-1)}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`  [${args.at(-1)}] ${d}`));
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

function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log("== setup");
  ensureKey("cs-sponsor");
  const sponsorSecret = cli("keys", "show", "cs-sponsor");
  start("pnpm", ["relayer"], { SPONSOR_SECRET: sponsorSecret });
  start("pnpm", ["dev"]);
  await waitFor(`${APP}/api/relay/info`);
  await waitFor(APP);

  const creator = addr("cs-creator");
  const product = cli(
    "contract", "invoke", "--id", STORE_ID, "--source", "cs-creator", "--network", "testnet", "--",
    "create_product", "--creator", creator, "--price", PRICE.toString(), "--shares", "[]", "--affiliate_bps", "0",
  );
  console.log(`product ${product}: 5 USDC, 5% platform fee`);

  console.log("== browser with a virtual passkey");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`  [page] ${m.text()}`));
  const cdp = await page.context().newCDPSession(page);
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

  await page.goto(APP);
  await page.getByRole("button", { name: "Create wallet with a passkey" }).click();
  const walletEl = page.getByTestId("wallet");
  await walletEl.waitFor({ timeout: 180_000 }).catch(async () => {
    console.log(`status: ${await page.getByTestId("status").textContent()}`);
    throw new Error("wallet was not created");
  });
  const wallet = (await walletEl.textContent())!.trim();
  console.log(`wallet ${wallet}`);

  console.log("== buyer receives 6 USDC (no XLM)");
  const funder = addr("cs-buyer");
  if (balance(USDC_ID, funder) < 6n * ONE) {
    // Top up the funding account by swapping testnet XLM for USDC on the DEX.
    cli(
      "tx", "new", "path-payment-strict-receive", "--source", "cs-buyer", "--network", "testnet",
      "--send-asset", "native", "--send-max", (600n * ONE).toString(), "--destination", funder,
      "--dest-asset", "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", "--dest-amount", (20n * ONE).toString(),
    );
  }
  cli(
    "contract", "invoke", "--id", USDC_ID, "--source", "cs-buyer", "--network", "testnet", "--",
    "transfer", "--from", addr("cs-buyer"), "--to", wallet, "--amount", (6n * ONE).toString(),
  );
  const creatorBefore = balance(USDC_ID, creator);

  console.log("== buy with the passkey");
  await page.getByTestId("product").fill(product);
  await page.getByTestId("buy").click();
  const status = page.getByTestId("status");
  await page.waitForFunction(
    () => ["ok", "error"].includes(document.querySelector("[data-testid=status]")?.getAttribute("data-kind") ?? ""),
    undefined,
    { timeout: 180_000 },
  );
  console.log(`status: ${await status.textContent()}`);
  const sale = (await page.getByTestId("sale").textContent().catch(() => null))?.trim();
  if (sale) console.log(`sale tx ${sale}`);
  await browser.close();

  console.log("== checks");
  check(read(STORE_ID, "has_purchased", "--product_id", product, "--buyer", wallet) === "true", "receipt recorded for the wallet");
  check(balance(USDC_ID, wallet) === ONE, "wallet paid exactly 5 USDC (1 left)");
  check(balance(USDC_ID, creator) - creatorBefore === (PRICE * 95n) / 100n, "creator received 4.75 USDC");
  check(balance(NATIVE_XLM_ID, wallet) === 0n, "wallet holds no XLM: every fee was sponsored");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(stop);
