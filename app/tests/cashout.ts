// Cash-out on testnet, in a real browser with a virtual passkey:
//
// A creator with a passkey wallet and 10 test USDC signs in to the SDF test
// anchor with the passkey (SEP-45), opens a USDC withdrawal (SEP-24), fills in
// the anchor's own form, and sends the USDC to the anchor from the dashboard.
// The anchor's memo ID travels in a muxed (M...) address. The test then
// follows the anchor's status until it has seen the payment.
//
// Needs the stellar CLI with testnet identities cs-sponsor and cs-faucet
// (pnpm test:e2e creates them).

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { USDC_ID } from "../src/config";

const APP = "http://localhost:5173";
const DATA_DIR = ".data-cashout";
const LONG = 180_000;
const ONE = 10_000_000n;

const children: ChildProcess[] = [];
const stop = () =>
  children.forEach((c) => {
    try {
      process.kill(-c.pid!, "SIGTERM");
    } catch {}
  });
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

const cli = (...args: string[]) => execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const balance = (who: string) =>
  BigInt(cli("contract", "invoke", "--id", USDC_ID, "--source", "cs-sponsor", "--network", "testnet", "--send=no", "--", "balance", "--id", who).replace(/"/g, ""));

function start(args: string[], env: Record<string, string> = {}) {
  const child = spawn("pnpm", args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout?.on("data", (d) => process.stdout.write(`  [${args[0]}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`  [${args[0]}] ${d}`));
  children.push(child);
}

async function waitFor(url: string) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${url}`);
}

let failures = 0;
let openBrowser: import("playwright").Browser | null = null;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

async function fail(page: Page, what: string): Promise<never> {
  const err = await page.locator(".error").first().textContent({ timeout: 1000 }).catch(() => null);
  throw new Error(`${what}${err ? `: ${err}` : ""}`);
}

async function main() {
  // Keep the faucet stocked: buy test USDC with its test XLM on the testnet DEX.
  const faucetAccount = cli("keys", "address", "cs-faucet");
  if (balance(faucetAccount) < 20n * ONE) {
    cli(
      "tx", "new", "path-payment-strict-receive", "--source", "cs-faucet", "--network", "testnet",
      "--send-asset", "native", "--send-max", (3_000n * ONE).toString(), "--destination", faucetAccount,
      "--dest-asset", "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", "--dest-amount", (50n * ONE).toString(),
    );
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
  start(["api"], {
    SPONSOR_SECRET: cli("keys", "show", "cs-sponsor"),
    FAUCET_SECRET: cli("keys", "show", "cs-faucet"),
    SESSION_SECRET: randomBytes(32).toString("hex"),
    DATA_DIR,
  });
  start(["dev"]);
  await waitFor(`${APP}/api/config`);
  await waitFor(APP);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  openBrowser = browser;
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`  [page] ${m.text().slice(0, 300)}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  console.log("== a creator with 10 USDC");
  await page.goto(`${APP}/sell`);
  await page.getByRole("button", { name: "Create my wallet" }).click();
  await page.locator("input[name=title]").waitFor({ timeout: LONG }).catch(() => fail(page, "wallet not created"));
  const wallet = (await page.getByTestId("wallet").getAttribute("title"))!;
  const faucet = await page.request.post(`${APP}/api/faucet`, { data: { wallet } });
  check(faucet.ok(), "faucet sent 10 test USDC");

  console.log("== cash out 5 USDC through the test anchor");
  await page.goto(`${APP}/dashboard`);
  const cashout = page.getByTestId("cashout");
  await cashout.getByLabel("Amount in USDC").fill("5");
  await page.getByTestId("cashout-start").click();
  const form = await page.getByTestId("cashout-form").getAttribute("href", { timeout: LONG }).catch(() => fail(page, "anchor sign-in failed"));
  check(!!form, "signed in to the anchor with the passkey (SEP-45) and opened a withdrawal (SEP-24)");

  const anchorPage = await context.newPage();
  await anchorPage.goto(form!);
  await anchorPage.waitForLoadState("networkidle");
  await anchorPage.locator("#amount").waitFor({ timeout: 60_000 });
  const fields: [string, string][] = [
    ["#amount", "5"],
    ["#name", "Ada"],
    ["#surname", "Obi"],
    ["#email", "ada@example.com"],
    ["#bank", "Test Bank"],
    ["#account", "0123456789"],
  ];
  let submitted = false;
  for (let attempt = 0; attempt < 3 && !submitted; attempt++) {
    for (const [field, value] of fields) {
      if ((await anchorPage.locator(field).inputValue().catch(() => value)) !== value) await anchorPage.locator(field).fill(value);
    }
    await anchorPage.getByRole("button", { name: "Submit" }).click();
    submitted = await anchorPage
      .getByText("pending_user_transfer_start")
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!submitted) throw new Error(`the anchor's form did not submit: ${(await anchorPage.innerText("body")).slice(0, 400)}`);
  await anchorPage.close();

  await page.getByTestId("cashout-pay").waitFor({ timeout: 60_000 }).catch(() => fail(page, "the dashboard did not see the anchor ready"));
  const before = balance(wallet);
  await page.getByTestId("cashout-pay").click();
  await page.getByRole("link", { name: "View the payment" }).waitFor({ timeout: LONG }).catch(() => fail(page, "payment to the anchor failed"));
  check(before - balance(wallet) === 5n * ONE, "5 USDC left the passkey wallet for the anchor, fee sponsored");

  // The anchor watches for the payment to its muxed address and moves on.
  const moved = await page
    .getByTestId("cashout-status")
    .filter({ hasNotText: /Ready for your USDC/ })
    .waitFor({ timeout: LONG })
    .then(() => true)
    .catch(() => false);
  const status = await page.getByTestId("cashout-status").textContent();
  console.log(`anchor status: ${status}`);
  check(moved, "the anchor saw the payment from the contract wallet");

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
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
