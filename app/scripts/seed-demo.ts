// Stocks a deployed Paperstall with a small demo shop, through the site itself,
// so a first visit doesn't find an empty shelf:
//
// 1. A creator makes a passkey wallet (a virtual passkey in a headless browser),
//    lists three products made for the demo and names the shop "demo".
// 2. A buyer takes test USDC from the site's faucet and buys one of them, and
//    the download is checked byte for byte.
//
//   APP_URL=https://paperstall.onrender.com pnpm seed:demo
//
// The products are real: synthesized drum one-shots (built here), an invoice
// template (scripts/demo/invoice.html) and a checklist (scripts/demo/checklist.md),
// all CC0. The creator's passkey is saved to .data-seed/creator.json (git-ignored)
// so the shop can be managed again later; the script refuses to run twice.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";

const APP = (process.env.APP_URL ?? "").replace(/\/$/, "");
const SAVED = ".data-seed/creator.json";
const LONG = 180_000;
const here = (name: string) => new URL(`./demo/${name}`, import.meta.url);

// ---- the drum pack: 16-bit 44.1 kHz mono WAVs, deterministic ----

const RATE = 44_100;

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Renders `seconds` of sound sample by sample, then scales it to a -1 dB peak. */
function render(seconds: number, sample: (t: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = sample(i / RATE);
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  // A 3 ms fade at the end, so nothing clicks.
  const fade = Math.round(0.003 * RATE);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.89 * Math.min(1, (out.length - i) / fade);
  return out;
}

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** White noise through a one-pole filter: "high" keeps the top, "low" the bottom. */
function noise(seed: number, cutoff: number, kind: "high" | "low") {
  const next = rng(seed);
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let low = 0;
  return () => {
    const x = next() * 2 - 1;
    low += a * (x - low);
    return kind === "low" ? low : x - low;
  };
}

function kick(start: number, end: number, decay: number, seconds: number) {
  let phase = 0;
  const click = noise(1, 3000, "high");
  return render(seconds, (t) => {
    const f = end + (start - end) * Math.exp(-t * 28);
    phase += (2 * Math.PI * f) / RATE;
    return Math.sin(phase) * Math.exp(-t / decay) + click() * 0.25 * Math.exp(-t * 300);
  });
}

function snare(tone: number, decay: number, seed: number) {
  const n = noise(seed, 1800, "high");
  return render(0.45, (t) => 0.55 * Math.sin(2 * Math.PI * tone * t) * Math.exp(-t * 30) + n() * Math.exp(-t / decay));
}

function hat(decay: number, seed: number) {
  const n = noise(seed, 7000, "high");
  return render(Math.min(0.6, decay * 6), (t) => n() * Math.exp(-t / decay));
}

function clap() {
  const n = noise(7, 1200, "high");
  return render(0.4, (t) => {
    const bursts = [0, 0.011, 0.023].reduce((s, at) => s + (t >= at ? Math.exp(-(t - at) * 180) : 0), 0);
    return n() * (bursts + 0.6 * Math.exp(-t / 0.09));
  });
}

function shaker() {
  const n = noise(9, 5000, "high");
  return render(0.25, (t) => n() * Math.min(1, t / 0.025) * Math.exp(-t / 0.06));
}

function tom(freq: number) {
  let phase = 0;
  return render(0.6, (t) => {
    phase += (2 * Math.PI * freq * (1 + 0.5 * Math.exp(-t * 20))) / RATE;
    return Math.sin(phase) * Math.exp(-t / 0.22);
  });
}

function rim() {
  return render(0.15, (t) => (Math.sin(2 * Math.PI * 1700 * t) * 0.6 + Math.sin(2 * Math.PI * 460 * t)) * Math.exp(-t * 80));
}

/** A zip file (deflate), written by hand to avoid a dependency. */
function zip(files: { name: string; data: Buffer }[]): Buffer {
  const date = ((2026 - 1980) << 9) | (11 << 5) | 14;
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const body = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(f.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(f.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(head, name, body);
    central.push(entry, name);
    offset += head.length + name.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}

export function drumPack(): Buffer {
  const sounds: [string, Float32Array][] = [
    ["kick-deep", kick(120, 42, 0.32, 0.8)],
    ["kick-punch", kick(170, 55, 0.16, 0.5)],
    ["kick-short", kick(210, 62, 0.08, 0.35)],
    ["snare-tight", snare(195, 0.09, 3)],
    ["snare-wide", snare(170, 0.2, 4)],
    ["hat-closed", hat(0.035, 5)],
    ["hat-half", hat(0.09, 6)],
    ["hat-open", hat(0.28, 8)],
    ["clap", clap()],
    ["shaker", shaker()],
    ["tom-high", tom(210)],
    ["tom-low", tom(120)],
  ];
  const dir = "drum-one-shots-vol-1";
  const readme = [
    "Drum one-shots, vol. 1",
    "",
    "Twelve drum sounds as 16-bit, 44.1 kHz mono WAV files, synthesized from",
    "scratch (no samples of other recordings) for the Paperstall demo shop.",
    "",
    ...sounds.map(([name, s]) => `  ${name}.wav  ${(s.length / RATE).toFixed(2)} s`),
    "",
    "Licence: CC0 1.0. Use them in anything, commercial or not, no credit needed.",
    "https://creativecommons.org/publicdomain/zero/1.0/",
    "",
  ].join("\n");
  return zip([
    { name: `${dir}/README.txt`, data: Buffer.from(readme) },
    ...sounds.map(([name, s]) => ({ name: `${dir}/${name}.wav`, data: wav(s) })),
  ]);
}

// ---- the site ----

const PRODUCTS = [
  {
    title: "Drum one-shots, vol. 1",
    description:
      "Twelve drum sounds (three kicks, two snares, three hats, a clap, a shaker and two toms) as 16-bit, 44.1 kHz WAV files. " +
      "Synthesized for Paperstall's demo shop and released under CC0, so use them in anything.\n\n" +
      "Demo listing: buy it with test USDC from the faucet to try the checkout.",
    file: { name: "drum-one-shots-vol-1.zip", mimeType: "application/zip", buffer: drumPack() },
    price: "2",
    affiliate: "10",
  },
  {
    title: "Freelance invoice template (USD and naira)",
    description:
      "A one-page invoice you fill in and print from any browser: your details and the client's, line items in dollars, " +
      "a naira column at the rate you type, and how to pay you in USDC on Stellar. One HTML file, nothing to install. CC0.\n\n" +
      "Demo listing: buy it with test USDC from the faucet to try the checkout.",
    file: { name: "invoice-template.html", mimeType: "text/html", buffer: readFileSync(here("invoice.html")) },
    price: "1",
    affiliate: "0",
  },
  {
    title: "Selling digital products for USDC: a checklist",
    description:
      "Twelve steps from a finished file to your first sale and cash-out: packaging the download, pricing in dollars, " +
      "splits with collaborators, affiliate links and cashing out on a schedule. Plain Markdown, CC0.\n\n" +
      "Demo listing: buy it with test USDC from the faucet to try the checkout.",
    file: { name: "usdc-sellers-checklist.md", mimeType: "text/markdown", buffer: readFileSync(here("checklist.md")) },
    price: "0.5",
    affiliate: "0",
  },
];

type Person = { page: Page; context: BrowserContext; cdp: CDPSession; authenticatorId: string };

async function person(browser: Browser): Promise<Person> {
  const context = await browser.newContext();
  const page = await context.newPage();
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

async function failWith(page: Page, what: string): Promise<never> {
  const err = await page.getByTestId("error").first().textContent({ timeout: 1000 }).catch(() => null);
  throw new Error(`${what}${err ? `: ${err}` : ""}`);
}

async function main() {
  if (!APP) throw new Error("set APP_URL, e.g. APP_URL=https://paperstall.onrender.com");
  if (existsSync(SAVED)) throw new Error(`${SAVED} exists: this site was already seeded`);
  for (let i = 0; i < 180 && !(await fetch(`${APP}/api/config`).then((r) => r.ok, () => false)); i++) {
    await new Promise((r) => setTimeout(r, 1000)); // a free host may be waking up
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    console.log("== the demo creator lists three products");
    const creator = await person(browser);
    const page = creator.page;
    await page.goto(`${APP}/sell`);
    await page.getByRole("button", { name: "Create my wallet" }).click();
    await page.locator("input[name=title]").waitFor({ timeout: LONG }).catch(() => failWith(page, "wallet not created"));
    const wallet = (await page.getByTestId("wallet").getAttribute("title"))!;
    console.log(`creator wallet ${wallet}`);

    const save = async (extra: object) => {
      const { credentials } = await creator.cdp.send("WebAuthn.getCredentials", { authenticatorId: creator.authenticatorId });
      mkdirSync(".data-seed", { recursive: true });
      writeFileSync(SAVED, JSON.stringify({ app: APP, wallet, credentials, ...extra }, null, 2), { mode: 0o600 });
    };
    await save({});

    const ids: string[] = [];
    for (const p of PRODUCTS) {
      if (ids.length) {
        await page.goto(`${APP}/sell`);
        await page.locator("input[name=title]").waitFor({ timeout: LONG });
      }
      await page.locator("input[name=title]").fill(p.title);
      await page.locator("textarea[name=description]").fill(p.description);
      await page.locator("input[name=file]").setInputFiles(p.file);
      await page.getByLabel("Price in USDC").fill(p.price);
      await page.getByLabel("Affiliate share, %").fill(p.affiliate);
      await page.getByRole("button", { name: "List it" }).click();
      await page.waitForURL(/\/p\/\d+$/, { timeout: LONG }).catch(() => failWith(page, `listing "${p.title}" failed`));
      ids.push(page.url().split("/").pop()!);
      console.log(`listed ${ids.at(-1)}: ${p.title}`);
    }

    await page.goto(`${APP}/dashboard`);
    await page.locator("input[name=name]").waitFor({ timeout: LONG }).catch(() => failWith(page, "dashboard not shown"));
    await page.locator("input[name=name]").fill("Paperstall demo shop");
    await page.locator("input[name=handle]").fill("demo");
    await page.locator("input[name=bio]").fill("Sample products made for trying the store with test USDC. All files are real and CC0.");
    await page.getByTestId("save-profile").click();
    await page.getByRole("link", { name: "Open your shop" }).waitFor({ timeout: 60_000 }).catch(() => failWith(page, "profile not saved"));
    await save({ products: ids, handle: "demo" });
    console.log(`shop ${APP}/c/demo`);

    console.log("== a buyer pays with test USDC and downloads");
    const buyer = (await person(browser)).page;
    await buyer.goto(`${APP}/p/${ids[0]}`);
    await buyer.getByTestId("buy").click();
    await buyer.getByTestId("topup").waitFor({ timeout: LONG }).catch(() => failWith(buyer, "no top-up prompt"));
    await buyer.getByTestId("faucet").click();
    await buyer.getByTestId("balance").waitFor({ timeout: 120_000 }).catch(() => failWith(buyer, "faucet failed"));
    await buyer.getByTestId("buy").click();
    await buyer.getByTestId("download").waitFor({ timeout: LONG }).catch(() => failWith(buyer, "purchase failed"));
    const got = await buyer.request.get(`${APP}${await buyer.getByTestId("download").getAttribute("href")}`);
    const same =
      createHash("sha256").update(await got.body()).digest("hex") ===
      createHash("sha256").update(PRODUCTS[0].file.buffer).digest("hex");
    if (!same) throw new Error("the downloaded file differs from the upload");
    console.log("bought and downloaded the drum pack; the file matches");
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
