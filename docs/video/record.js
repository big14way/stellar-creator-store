#!/usr/bin/env node
// Data-driven screen recorder for the pitch video.
//   node record.js scenes.json [scene,scene]
// Records one clip per scene with Playwright (headed Chromium): fake cursor with click ripples,
// smooth scrolls, camera zooms, typed input, and HTML terminal replays. Writes
// <out>/<scene>.webm and <out>/<scene>.webm.clicks.json (click times in clip seconds, for click SFX).
// Needs `npm i playwright` next to this file (or a PLAYWRIGHT_PATH pointing at a project that has it).
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH ? path.join(process.env.PLAYWRIGHT_PATH, 'node_modules', 'playwright') : 'playwright');

const cfgPath = process.argv[2];
if (!cfgPath) { console.error('usage: node record.js scenes.json [scene,scene]'); process.exit(1); }
const CFG = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const HERE = __dirname;
const BASE = process.env.BASE || CFG.base || 'http://localhost:3000';
const OUTDIR = path.resolve(path.dirname(cfgPath), CFG.out || 'clips');
const RAW = path.join(OUTDIR, '.raw');
const [VW, VH] = CFG.viewport || [1440, 810];
const [OW, OH] = CFG.video || [1920, 1080];
fs.mkdirSync(RAW, { recursive: true });
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;

const INIT = `
(() => {
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg width="30" height="36" viewBox="0 0 30 36"><path d="M2 2 L2 27 L8.5 21 L13 32 L18 30 L13.5 19.5 L22 19.5 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(${VW / 2}px, ${VH * 0.65}px)', transition: 'transform .7s cubic-bezier(.2,.8,.2,1)', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.45))' });
    (document.body || document.documentElement).appendChild(c);
    window.__cur = {
      move(x, y, ms) { c.style.transition = 'transform ' + (ms || 700) + 'ms cubic-bezier(.2,.8,.2,1)'; c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; },
      ripple(x, y) { const r = document.createElement('div'); Object.assign(r.style, { position: 'fixed', left: (x - 22) + 'px', top: (y - 22) + 'px', width: '44px', height: '44px', borderRadius: '50%', border: '3px solid ${CFG.accent || '#7ee2b8'}', zIndex: 2147483646, pointerEvents: 'none', animation: '__rip .55s ease-out forwards' }); (document.body || document.documentElement).appendChild(r); setTimeout(() => r.remove(), 600); },
    };
    const st = document.createElement('style'); st.textContent = '@keyframes __rip { from { transform: scale(.4); opacity: .95 } to { transform: scale(1.9); opacity: 0 } } html { scroll-behavior: auto !important; }'; document.head.appendChild(st);
  };
  if (document.body) mk(); else document.addEventListener('DOMContentLoaded', mk);
  window.__zoom = (cx, cy, s, ms) => { const h = document.documentElement; h.style.transition = 'transform ' + (ms || 900) + 'ms cubic-bezier(.25,.8,.25,1)'; h.style.transformOrigin = (cx + window.scrollX) + 'px ' + (cy + window.scrollY) + 'px'; h.style.transform = 'scale(' + s + ')'; };
  window.__unzoom = (ms) => { const h = document.documentElement; h.style.transition = 'transform ' + (ms || 800) + 'ms cubic-bezier(.25,.8,.25,1)'; h.style.transform = 'scale(1)'; };
  window.__scroll = (to, ms) => new Promise(res => { const from = window.scrollY, d = to - from, t0 = performance.now(); const step = (t) => { const p = Math.min((t - t0) / ms, 1), e = 1 - Math.pow(1 - p, 3); window.scrollTo(0, from + d * e); if (p < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
})();`;

// Values captured by `saveVar` in one scene and substituted as {{name}} in later scenes' step arguments.
const VARS_FILE = path.join(OUTDIR, 'vars.json');
const VARS = fs.existsSync(VARS_FILE) ? JSON.parse(fs.readFileSync(VARS_FILE, 'utf8')) : {};
const sub = (a) => (typeof a === 'string' ? a.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in VARS)) throw new Error('unset var ' + k); return VARS[k]; }) : a);

// Injected test wallet (EIP-1193 `window.ethereum`) backed by a private key from the environment, signing in
// Node with viem. Only for the project's own app on localhost with the project's own test keys.
function loadViem() {
  const base = process.env.PLAYWRIGHT_PATH ? path.join(process.env.PLAYWRIGHT_PATH, 'node_modules') : null;
  const req = (m) => require(base ? path.join(base, m) : m);
  return { viem: req('viem'), accounts: req('viem/accounts') };
}
async function installWallet(page, w) {
  const { viem, accounts } = loadViem();
  const key = process.env[w.keyEnv || 'TEST_WALLET_KEY'];
  if (!key) throw new Error('wallet: env ' + (w.keyEnv || 'TEST_WALLET_KEY') + ' is not set');
  const account = accounts.privateKeyToAccount(key);
  const chain = viem.defineChain({ id: w.chainId, name: w.chainName || 'chain ' + w.chainId, nativeCurrency: { name: w.symbol || 'ETH', symbol: w.symbol || 'ETH', decimals: 18 }, rpcUrls: { default: { http: [w.rpc] } } });
  const pub = viem.createPublicClient({ chain, transport: viem.http(w.rpc) });
  const wal = viem.createWalletClient({ chain, account, transport: viem.http(w.rpc) });
  const hex = '0x' + w.chainId.toString(16);
  await page.exposeFunction('__walletRequest', async (method, params) => {
    params = params || [];
    switch (method) {
      case 'eth_requestAccounts': case 'eth_accounts': return [account.address];
      case 'eth_chainId': return hex;
      case 'net_version': return String(w.chainId);
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
      case 'wallet_requestPermissions': case 'wallet_getPermissions': return [{ parentCapability: 'eth_accounts' }];
      case 'eth_sendTransaction': {
        const t = params[0];
        // `legacyGas`: chains whose relay rejects EIP-1559 defaults (e.g. Hedera's JSON-RPC relay) get eth_gasPrice.
        const gasPrice = w.legacyGas ? await pub.getGasPrice() : undefined;
        const hash = await wal.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined, gas: t.gas ? BigInt(t.gas) : undefined, gasPrice });
        console.log('  tx', hash);
        return hash;
      }
      case 'personal_sign': return account.signMessage({ message: { raw: params[0] } });
      case 'eth_sign': return account.signMessage({ message: { raw: params[1] } });
      case 'eth_signTypedData_v4': case 'eth_signTypedData': { const td = JSON.parse(params[1]); delete td.types.EIP712Domain; return account.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message: td.message }); }
      default: return pub.request({ method, params });
    }
  });
  await page.addInitScript(({ address, hex }) => {
    const listeners = {};
    const provider = {
      isMetaMask: true, isTestWallet: true, selectedAddress: address, chainId: hex,
      request: ({ method, params }) => window.__walletRequest(method, params),
      on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); }, removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
      enable: () => window.__walletRequest('eth_requestAccounts', []),
    };
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
    const info = { uuid: 'a1b2c3d4-test-wallet', name: 'Test wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'local.testwallet' };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce); announce();
  }, { address: account.address, hex });
  console.log('  wallet', account.address);
}

async function runScene(browser, sc) {
  // `storageState`: a Playwright session file (e.g. a signed-in user), relative to scenes.json.
  const storageState = sc.storageState ? path.resolve(path.dirname(cfgPath), sc.storageState) : undefined;
  const [vw, vh] = sc.viewport || [VW, VH];  // per-scene viewport, e.g. [1920, 1080] for terminal replays
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: vw >= OW ? 1 : 2, storageState, recordVideo: { dir: RAW, size: { width: OW, height: OH } } });
  const page = await ctx.newPage();
  if (sc.wallet) await installWallet(page, sc.wallet);
  // `passkey`: a virtual WebAuthn authenticator for passkey wallets. `load` adds saved credentials
  // (a file with { credentials: [...] }, relative to scenes.json); `save` writes them after the scene.
  let pk = null;
  if (sc.passkey) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    pk = { cdp, authenticatorId };
    if (sc.passkey.load) {
      const saved = JSON.parse(fs.readFileSync(path.resolve(path.dirname(cfgPath), sc.passkey.load), 'utf8'));
      for (const credential of saved.credentials) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential });
      console.log('  passkey loaded', saved.credentials.length);
    }
  }
  await page.addInitScript(INIT);
  const t0 = Date.now(); const clicks = [];
  let cur = { x: VW / 2, y: VH * 0.65 };
  const now = () => (Date.now() - t0) / 1000;
  const center = async (sel) => {
    let b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('no box for ' + sel);
    if (b.y < 60 || b.y + b.height > VH - 20) {  // off-screen: bring it into the middle of the viewport with a smooth scroll first
      const y = Math.max(0, b.y + (await page.evaluate(() => window.scrollY)) - Math.round(VH / 2 - b.height / 2));
      await page.evaluate(([y, m]) => window.__scroll(y, m), [y, 900]); await page.waitForTimeout(1000);
      b = await page.locator(sel).first().boundingBox();
    }
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
  };
  const ops = {
    goto: async (url, sel) => { await page.goto(/^(https?|file):/.test(url) ? url : BASE + url, { waitUntil: 'commit', timeout: 60000 }); if (sel) await page.waitForSelector(sel, { timeout: 60000 }); },
    waitFor: async (sel, ms = 20000) => { await page.waitForSelector(sel, { timeout: ms }).catch(() => {}); },
    wait: async (ms) => page.waitForTimeout(ms),
    moveTo: async (sel, ms = 700, dx = 0, dy = 0) => { const c = Array.isArray(sel) ? { x: sel[0], y: sel[1] } : await center(sel); cur = { x: c.x + dx, y: c.y + dy }; await page.evaluate(([x, y, m]) => window.__cur && window.__cur.move(x, y, m), [cur.x, cur.y, ms]); await page.mouse.move(cur.x, cur.y, { steps: 12 }); await page.waitForTimeout(ms + 120); },
    moveToFraction: async (sel, fx = 0.5, fy = 0.5, ms = 700) => { const c = await center(sel); cur = { x: c.box.x + c.box.width * fx, y: c.box.y + c.box.height * fy }; await page.evaluate(([x, y, m]) => window.__cur && window.__cur.move(x, y, m), [cur.x, cur.y, ms]); await page.mouse.move(cur.x, cur.y, { steps: 12 }); await page.waitForTimeout(ms + 120); },
    click: async () => { await page.evaluate(([x, y]) => window.__cur && window.__cur.ripple(x, y), [cur.x, cur.y]); clicks.push(+now().toFixed(3)); await page.mouse.click(cur.x, cur.y); await page.waitForTimeout(350); },
    type: async (text, delay = 32) => { await page.keyboard.type(text, { delay }); },
    press: async (key) => { await page.keyboard.press(key); await page.waitForTimeout(120); },
    zoom: async (sel, s = 1.5, ms = 900, hold = 3000, dx = 0, dy = 0) => { const c = await center(sel); await page.evaluate(([x, y, s, m]) => window.__zoom(x, y, s, m), [c.x + dx, c.y + dy, s, ms]); await page.waitForTimeout(ms + hold); },
    zoomPoint: async (x, y, s = 1.5, ms = 900, hold = 3000) => { await page.evaluate(([x, y, s, m]) => window.__zoom(x, y, s, m), [x, y, s, ms]); await page.waitForTimeout(ms + hold); },
    // zoom so that everything right of `excludeSel` is out of frame: anchor near the left edge of `anchorSel`
    zoomExclude: async (anchorSel, excludeSel, maxScale = 2.1, ms = 900, hold = 5000, dy = 200) => { const c = await center(anchorSel); const n = await center(excludeSel).catch(() => null); const ox = c.box.x - 14, right = n ? n.box.x - 22 : VW / 2; const s = Math.min(maxScale, (VW - ox) / (right - ox)); await page.evaluate(([x, y, s, m]) => window.__zoom(x, y, s, m), [ox, c.y + dy, s, ms]); await page.waitForTimeout(ms + hold); },
    unzoom: async (ms = 800) => { await page.evaluate((m) => window.__unzoom(m), ms); await page.waitForTimeout(ms + 200); },
    scrollTo: async (sel, offset = 110, ms = 1400) => { const b = await page.locator(sel).first().boundingBox(); const y = Math.max(0, b.y + (await page.evaluate(() => window.scrollY)) - offset); await page.evaluate(([y, m]) => window.__scroll(y, m), [y, ms]); await page.waitForTimeout(ms + 100); },
    scrollBy: async (dy, ms = 1200) => { const y = await page.evaluate(() => window.scrollY); await page.evaluate(([y, m]) => window.__scroll(y, m), [y + dy, ms]); await page.waitForTimeout(ms + 100); },
    // click an element only if it is on the page (e.g. a "Connect wallet" button that a remembered session may skip)
    clickIfPresent: async (sel, ms = 2500) => { const el = page.locator(sel).first(); if (await el.count() && await el.isVisible().catch(() => false)) { const c = await center(sel); cur = { x: c.x, y: c.y }; await page.evaluate(([x, y, m]) => window.__cur && window.__cur.move(x, y, m), [cur.x, cur.y, 600]); await page.mouse.move(cur.x, cur.y, { steps: 10 }); await page.waitForTimeout(700); await ops.click(); await page.waitForTimeout(ms); } },
    eval: async (js) => { await page.evaluate(js); },
    waitUntil: async (js, ms = 60000) => { await page.waitForFunction(js, null, { timeout: ms, polling: 500 }).catch(() => console.log('  waitUntil timed out:', js.slice(0, 60))); },
    select: async (sel, value) => { await page.locator(sel).first().selectOption(value); await page.waitForTimeout(300); },
    upload: async (sel, file) => { await page.locator(sel).first().setInputFiles(path.resolve(path.dirname(cfgPath), file)); await page.waitForTimeout(400); },
    saveVar: async (name, js) => { VARS[name] = String(await page.evaluate(js)); fs.writeFileSync(VARS_FILE, JSON.stringify(VARS, null, 1)); console.log('  var', name, '=', VARS[name]); },
  };
  console.log('▶', sc.name);
  try {
    if (sc.terminal) {
      const t = sc.terminal;
      const sched = t.lines || JSON.parse(fs.readFileSync(path.resolve(path.dirname(cfgPath), t.schedule), 'utf8'));
      await ops.goto('file://' + path.join(HERE, 'term.html'), '#out');
      await page.evaluate((title) => window.setTitle(title), t.title || sc.name);
      // Terminal replays have no pointer: hide the fake cursor unless the scene asks for it.
      if (!t.cursor) await page.evaluate(() => { const c = document.getElementById('__cur'); if (c) c.style.display = 'none'; });
      await page.waitForTimeout(400);
      await page.evaluate((s) => { window.play(s); }, sched);
      const end = t.end || (sched[sched.length - 1].t + 2.5);
      await page.waitForTimeout(end * 1000);
    } else {
      for (const step of sc.steps) { const [op, ...args] = step; if (!ops[op]) throw new Error('unknown step ' + op); await ops[op](...args.map(sub)); }
    }
  } catch (e) { console.log('  ✗', sc.name, e.message.split('\n')[0]); }
  const dur = now();
  if (pk && sc.passkey.save) {
    const { credentials } = await pk.cdp.send('WebAuthn.getCredentials', { authenticatorId: pk.authenticatorId });
    fs.writeFileSync(path.resolve(path.dirname(cfgPath), sc.passkey.save), JSON.stringify({ credentials }), { mode: 0o600 });
    console.log('  passkey saved', credentials.length);
  }
  const v = page.video(); await ctx.close();
  const dest = path.join(OUTDIR, sc.name + '.webm'); fs.renameSync(await v.path(), dest);
  fs.writeFileSync(dest + '.clicks.json', JSON.stringify(clicks));
  console.log(`  ✓ ${sc.name} ${dur.toFixed(1)}s clicks=${clicks.length}`);
}

(async () => {
  const [WW, WH] = CFG.window || [VW, VH + 90];
  const browser = await chromium.launch({ headless: !!process.env.HEADLESS, args: ['--window-position=0,0', `--window-size=${WW},${WH}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  for (const sc of CFG.scenes) { if (only && !only.has(sc.name)) continue; await runScene(browser, sc); }
  await browser.close();
  fs.rmSync(RAW, { recursive: true, force: true });
})();
