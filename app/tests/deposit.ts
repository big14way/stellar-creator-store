// Add money on testnet, in a real browser with a virtual passkey, against a
// deployed site:
//
// A buyer opens a product, makes a passkey wallet (it is empty), and presses
// "Add money by bank or card". The page signs in to the SDF test anchor with
// the passkey (SEP-45) and opens a USDC deposit (SEP-24). The test fills in
// the anchor's own form; the anchor plays the bank and sends test USDC to the
// contract wallet. The page follows the deposit until the USDC lands.
//
//   APP_URL=https://paperstallhq.vercel.app PRODUCT=30 pnpm exec tsx tests/deposit.ts

import { chromium, type Page } from "playwright";
import { usdcBalance } from "../src/chain";

const APP = (process.env.APP_URL ?? "").replace(/\/$/, "");
const PRODUCT = process.env.PRODUCT ?? "";
const LONG = 240_000;

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

async function fail(page: Page, what: string): Promise<never> {
  const err = await page.locator(".error").first().textContent({ timeout: 1000 }).catch(() => null);
  throw new Error(`${what}${err ? `: ${err}` : ""}`);
}

/** Fills in the test anchor's deposit form, whatever fields it asks for this time. */
async function fillAnchorForm(anchor: Page) {
  const values: Record<string, string> = {
    amount: "5", name: "Ada", first_name: "Ada", surname: "Obi", last_name: "Obi",
    email: "ada@example.com", email_address: "ada@example.com", bank: "Test Bank", account: "0123456789",
  };
  await anchor.locator("input").first().waitFor({ timeout: 60_000 });
  const fields = await anchor.locator("input").evaluateAll((els) =>
    els.map((e) => `${(e as HTMLInputElement).id}|${(e as HTMLInputElement).name}|${(e as HTMLInputElement).type}`),
  );
  console.log(`anchor form fields: ${fields.join(", ")}`);
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const input of await anchor.locator("input:visible").all()) {
      const id = (await input.getAttribute("id")) ?? (await input.getAttribute("name")) ?? "";
      const value = values[id] ?? (id ? "test" : null);
      if (value && (await input.inputValue().catch(() => value)) !== value) await input.fill(value);
    }
    await anchor.getByRole("button", { name: /submit|continue|confirm/i }).first().click();
    const moved = await anchor
      .getByText(/pending_|completed/i)
      .first()
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (moved) return;
  }
  throw new Error(`the anchor's form did not submit: ${(await anchor.innerText("body")).slice(0, 500)}`);
}

async function main() {
  if (!APP || !PRODUCT) throw new Error("set APP_URL and PRODUCT (an active product id on that site)");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (m) => m.type() === "error" && console.log(`  [page] ${m.text().slice(0, 300)}`));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });

    console.log("== a buyer with an empty passkey wallet");
    await page.goto(`${APP}/p/${PRODUCT}`);
    await page.getByTestId("buy").click();
    await page.getByTestId("topup").waitFor({ timeout: LONG }).catch(() => fail(page, "no top-up prompt"));
    const wallet = (await page.getByTestId("wallet").getAttribute("title"))!;
    console.log(`wallet ${wallet}`);
    const before = await usdcBalance(wallet).catch(() => 0n);

    console.log("== add money through the test anchor");
    await page.getByTestId("add-money-start").click();
    const form = await page.getByTestId("add-money-form").getAttribute("href", { timeout: LONG }).catch(() => fail(page, "anchor sign-in or deposit failed"));
    check(!!form, "signed in to the anchor with the passkey (SEP-45) and opened a deposit (SEP-24)");

    const anchor = await context.newPage();
    await anchor.goto(form!);
    await anchor.waitForLoadState("networkidle");
    await fillAnchorForm(anchor);
    console.log(`anchor page: ${(await anchor.innerText("body")).replace(/\s+/g, " ").slice(0, 200)}`);
    await anchor.close();

    const landed = await page
      .getByTestId("add-money-status")
      .filter({ hasText: "USDC added to your wallet" })
      .waitFor({ timeout: LONG })
      .then(() => true)
      .catch(() => false);
    console.log(`status: ${await page.getByTestId("add-money-status").textContent()}`);
    const problem = await page.getByTestId("add-money-problem").textContent({ timeout: 2000 }).catch(() => null);
    if (problem) console.log(`anchor says: ${problem}`);
    check(landed, "the page followed the deposit until the anchor completed it");
    const after = await usdcBalance(wallet).catch(() => 0n);
    check(after > before, `the anchor's USDC reached the passkey wallet (${after - before} units)`);
    const ready = await page.getByTestId("balance").waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
    check(ready, "the product page sees the new balance and offers to pay");
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
