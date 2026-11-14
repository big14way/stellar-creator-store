import { ArrowRight, Banknote, Copy, ExternalLink, Fingerprint, Pause, Pencil, Play, Send, Tag } from "lucide-react";
import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { anchorSignIn, sendUsdc, startWithdrawal, STATUS_TEXT, withdrawal, payee, type AnchorTx } from "../anchor";
import { api, shopPath, type Product, type Profile, type Sale } from "../api";
import { formatUsdc, owedTo, parseUsdc, usdcBalance } from "../chain";
import { ANCHOR_DOMAIN } from "../config";
import { ago, explorerTx, Eyebrow, fileKind, Local, RatesCredit, Receipt, Status, TagButton, TagLink } from "../ui";
import { short, useWallet } from "../useWallet";
import { callStore } from "../wallet";

type Held = { to: string; amount: bigint };

export function Dashboard() {
  const { wallet, restoring, signIn, signOut } = useWallet();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [held, setHeld] = useState<bigint>(0n);
  const [coHeld, setCoHeld] = useState<Held[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (w: string) => {
    const [ps, ss, b, h] = await Promise.all([
      api.products(w),
      api.sales(w).catch(() => []),
      usdcBalance(w).catch(() => 0n),
      owedTo(w).catch(() => 0n),
    ]);
    setProducts(ps);
    setSales(ss);
    setBalance(b);
    setHeld(h);
    const coCreators = [...new Set(ps.flatMap((p) => p.shares.map((s) => s.to)))];
    const owed = await Promise.all(coCreators.map((to) => owedTo(to).catch(() => 0n)));
    setCoHeld(coCreators.map((to, i) => ({ to, amount: owed[i] })).filter((h) => h.amount > 0n));
  }, []);

  useEffect(() => {
    if (wallet) load(wallet).catch((e) => setError(String(e)));
  }, [wallet, load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      if (wallet) await load(wallet);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (restoring) {
    return (
      <section className="band dark">
        <div className="container">
          <Status>Loading</Status>
        </div>
      </section>
    );
  }

  if (!wallet) {
    return (
      <section className="band dark lined hero">
        <div className="container">
          <Eyebrow>Dashboard</Eyebrow>
          <h1 className="display">
            Your sales,
            <br />
            <span className="accent">as they land.</span>
          </h1>
          <p className="lead">Sign in with your passkey, on this device or any other where it's saved.</p>
          <div className="actions">
            <TagButton onClick={() => run("Confirm with your passkey", signIn)} disabled={!!busy} icon={<Fingerprint size={16} />}>
              Sign in
            </TagButton>
            <Link href="/sell" className="ghost">
              New here? Start selling
            </Link>
          </div>
          {busy && <Status>{busy}</Status>}
          {error && (
            <p className="error" data-testid="error">
              {error}
            </p>
          )}
        </div>
      </section>
    );
  }

  const list = products ?? [];
  const sold = list.reduce((n, p) => n + p.sales, 0);
  const earned = sales.reduce((sum, s) => sum + (s.price ? BigInt(s.price) : 0n), 0n);

  return (
    <>
      <section className="band dark lined tight">
        <div className="container">
          <Eyebrow>Dashboard · wallet {short(wallet)}</Eyebrow>
          <h1>Your store.</h1>
          <div className="stats" style={{ marginTop: 40 }}>
            <Receipt>
              <div className="receipt-head">
                <span>Wallet balance</span>
                <span className="verified">USDC</span>
              </div>
              <div className="stat">
                <span className="big" data-testid="balance">
                  ${balance === null ? "…" : formatUsdc(balance)}
                </span>
                {balance !== null && <Local usdc={balance} className="muted" />}
                <span className="muted">Sales land here the moment they happen.</span>
              </div>
            </Receipt>
            <Receipt>
              <div className="receipt-head">
                <span>Sales</span>
                <span className="verified">All products</span>
              </div>
              <div className="stat">
                <span className="big" data-testid="sales">
                  {sold}
                </span>
                <span className="muted">${formatUsdc(earned)} paid by buyers through this store</span>
              </div>
            </Receipt>
            {held > 0n && (
              <Receipt>
                <div className="receipt-head">
                  <span>Held for you</span>
                  <span className="verified">Claim</span>
                </div>
                <div className="stat">
                  <span className="big">${formatUsdc(held)}</span>
                  <span className="muted">Shares your wallet couldn't receive at the time of sale.</span>
                  <button
                    className="ghost"
                    onClick={() => run("Paying out your held share", () => callStore("claim", { to: wallet }))}
                    disabled={!!busy}
                    style={{ marginTop: 8 }}
                  >
                    Claim it now
                  </button>
                </div>
              </Receipt>
            )}
          </div>
          {coHeld.length > 0 && (
            <div className="panel" style={{ marginTop: 22 }} data-testid="co-held">
              <p style={{ marginTop: 0 }}>
                <strong>Waiting for co-creators.</strong> These shares couldn't be delivered at the time of sale, usually
                because the wallet had no USDC trustline yet. Once they can receive USDC, pay them out:
              </p>
              {coHeld.map((h) => (
                <div key={h.to} className="co-held-row">
                  <span className="mono">{short(h.to)}</span>
                  <strong>${formatUsdc(h.amount)}</strong>
                  <button
                    className="ghost"
                    disabled={!!busy}
                    onClick={() => run(`Paying ${short(h.to)}`, () => callStore("claim", { to: h.to }))}
                  >
                    Pay out
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 22 }}>
            {busy && <Status>{busy}</Status>}
            {error && (
              <p className="error" data-testid="error">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="band cream tight">
        <div className="container">
          <div className="bar">
            <span className="eyebrow">Your products</span>
            <Link href="/sell" className="text-link">
              List another <ArrowRight size={14} />
            </Link>
          </div>
          {products === null ? (
            <Status>Loading your products</Status>
          ) : list.length === 0 ? (
            <div className="empty">
              <p>Nothing on your shelf yet.</p>
              <TagLink href="/sell" icon={<Tag size={16} />}>
                List your first product
              </TagLink>
            </div>
          ) : (
            <ProductTable products={list} wallet={wallet} busy={!!busy} run={run} />
          )}

          {sales.length > 0 && (
            <>
              <div className="bar" style={{ marginTop: 56 }}>
                <span className="eyebrow">Recent sales</span>
              </div>
              <div className="table-wrap">
                <table className="table" data-testid="sales-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Product</th>
                      <th className="hide-sm">Buyer</th>
                      <th className="num">Paid</th>
                      <th className="num">Proof</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.txHash}>
                        <td className="mono">{ago(s.at)}</td>
                        <td>
                          <Link href={`/p/${s.productId}`} className="t-title">
                            {s.title}
                          </Link>
                        </td>
                        <td className="hide-sm mono">{short(s.buyer)}</td>
                        <td className="num">{s.price ? `$${formatUsdc(BigInt(s.price))}` : "–"}</td>
                        <td className="num">
                          <a className="text-link" href={explorerTx(s.txHash)} target="_blank" rel="noreferrer">
                            Tx <ExternalLink size={12} />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="band dark tight">
        <div className="container two-col">
          {ANCHOR_DOMAIN ? (
            <CashOut wallet={wallet} balance={balance} onDone={() => load(wallet)} />
          ) : (
            <div className="side-card">
              <Eyebrow>Cash out to a bank</Eyebrow>
              <p className="hint">
                No naira anchor on this network accepts passkey wallets yet. Send USDC to your own Stellar wallet or exchange
                and cash out there.
              </p>
            </div>
          )}
          <div>
            <ProfileCard wallet={wallet} />
            <SendUsdc wallet={wallet} balance={balance} onSent={() => load(wallet)} />
          </div>
        </div>
      </section>

      <section className="band cream tight">
        <div className="container">
          <p className="hint">
            Wallet <code>{wallet}</code> ·{" "}
            <button className="text-link" onClick={() => signOut()}>
              Sign out
            </button>
          </p>
        </div>
      </section>
    </>
  );
}

// ---- products: price, pause, details ----

function ProductTable({
  products,
  wallet,
  busy,
  run,
}: {
  products: Product[];
  wallet: string;
  busy: boolean;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { ensureProven } = useWallet();
  const [copied, setCopied] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  async function save(p: Product, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    await run("Saving", async () => {
      let price: bigint;
      try {
        price = parseUsdc(String(form.get("price") ?? ""));
      } catch {
        throw new Error("Enter a price like 5 or 12.50");
      }
      if (price <= 0n) throw new Error("The price must be more than zero.");
      if (price !== BigInt(p.price)) {
        await callStore("update_product", { product_id: BigInt(p.id), price, active: p.active });
      }
      if (title !== p.title || description !== p.description) {
        await ensureProven(wallet);
        await api.updateProduct(p.id, title, description);
      }
      setEditing(null);
    });
  }

  return (
    <div className="table-wrap">
      <table className="table" data-testid="products-table">
        <thead>
          <tr>
            <th>Product</th>
            <th className="hide-sm">Type</th>
            <th className="num">Price</th>
            <th className="num">Sales</th>
            <th className="num">Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <Fragment key={p.id}>
              <tr>
                <td>
                  <Link href={`/p/${p.id}`} className="t-title">
                    {p.title}
                  </Link>
                  {!p.active && <span className="pill">Paused</span>}
                </td>
                <td className="hide-sm mono">{fileKind(p.file.name)}</td>
                <td className="num">${formatUsdc(BigInt(p.price))}</td>
                <td className="num">{p.sales}</td>
                <td className="num row-actions">
                  <button
                    className="text-link"
                    onClick={() =>
                      navigator.clipboard.writeText(`${window.location.origin}/p/${p.id}`).then(() => setCopied(p.id))
                    }
                  >
                    <Copy size={14} /> {copied === p.id ? "Copied" : "Link"}
                  </button>
                  <button className="text-link" onClick={() => setEditing(editing === p.id ? null : p.id)} data-testid={`edit-${p.id}`}>
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    className="text-link"
                    disabled={busy}
                    data-testid={`toggle-${p.id}`}
                    onClick={() =>
                      run(p.active ? "Pausing sales" : "Resuming sales", () =>
                        callStore("update_product", { product_id: BigInt(p.id), price: BigInt(p.price), active: !p.active }),
                      )
                    }
                  >
                    {p.active ? <Pause size={14} /> : <Play size={14} />} {p.active ? "Pause" : "Resume"}
                  </button>
                </td>
              </tr>
              {editing === p.id && (
                <tr className="edit-row">
                  <td colSpan={5}>
                    <form className="form" onSubmit={(e) => save(p, e)}>
                      <div className="field-row">
                        <label>
                          Title
                          <input name="title" defaultValue={p.title} required maxLength={120} />
                        </label>
                        <label>
                          Price in USDC
                          <input name="price" defaultValue={formatUsdc(BigInt(p.price))} inputMode="decimal" required />
                          <span className="hint">Changing the price is a transaction your passkey signs. Shares can't change.</span>
                        </label>
                      </div>
                      <label>
                        Description
                        <textarea name="description" defaultValue={p.description} rows={3} maxLength={5000} />
                      </label>
                      <div className="actions" style={{ marginTop: 0 }}>
                        <button className="ghost" type="submit" disabled={busy}>
                          Save changes
                        </button>
                        <button className="text-link" type="button" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- profile and shop link ----

function ProfileCard({ wallet }: { wallet: string }) {
  const { ensureProven } = useWallet();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .shop(wallet)
      .then((s) => setProfile(s.profile ?? { name: "", bio: "", handle: null }))
      .catch(() => setProfile({ name: "", bio: "", handle: null }));
  }, [wallet]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await ensureProven(wallet);
      const next = await api.saveProfile(wallet, {
        name: String(form.get("name") ?? ""),
        bio: String(form.get("bio") ?? ""),
        handle: String(form.get("handle") ?? "") || null,
      });
      setProfile(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return null;
  const link = `${window.location.origin}${shopPath(wallet, profile.name ? profile : null)}`;
  return (
    <div className="side-card">
      <Eyebrow>Your shop page</Eyebrow>
      <form className="form" onSubmit={save} style={{ marginTop: 14 }}>
        <label>
          Shop name
          <input name="name" defaultValue={profile.name} required maxLength={60} placeholder="Ada's Beat Lab" />
        </label>
        <label>
          Shop link
          <span className="prefixed">
            <span className="mono">/c/</span>
            <input name="handle" defaultValue={profile.handle ?? ""} maxLength={24} placeholder="adabeats" />
          </span>
        </label>
        <label>
          One line about you
          <input name="bio" defaultValue={profile.bio} maxLength={280} placeholder="Afrobeats producer in Lagos" />
        </label>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="ghost" type="submit" disabled={busy} data-testid="save-profile">
            {busy ? "Saving…" : "Save"}
          </button>
          {saved && (
            <a className="text-link" href={link}>
              Open your shop <ArrowRight size={14} />
            </a>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

// ---- send USDC anywhere on Stellar ----

function SendUsdc({ wallet, balance, onSent }: { wallet: string; balance: bigint | null; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      if (!/^[GCM][A-Z2-7]{55,68}$/.test(to.trim())) throw new Error("Enter a Stellar address (G…, C… or M…)");
      const units = parseUsdc(amount);
      if (balance !== null && units > balance) throw new Error("That's more than your balance.");
      setDone(await sendUsdc(wallet, to.trim(), units));
      setAmount("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="side-card">
      <Eyebrow>Send USDC</Eyebrow>
      <p className="hint">To your LOBSTR or exchange wallet, or anyone on Stellar. We pay the network fee.</p>
      <form className="form" onSubmit={send}>
        <label>
          To
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="G… or M… address" />
        </label>
        <label>
          Amount in USDC
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="10" />
        </label>
        <button className="ghost" type="submit" disabled={busy}>
          <Send size={14} /> {busy ? "Confirm with your passkey…" : "Send"}
        </button>
        {done && (
          <a className="text-link" href={explorerTx(done)} target="_blank" rel="noreferrer">
            Sent. View the transaction <ExternalLink size={12} />
          </a>
        )}
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

// ---- cash out through an anchor (SEP-45 sign-in, SEP-24 withdrawal) ----

type Step =
  | { at: "idle" }
  | { at: "form"; token: string; id: string; url: string; tx?: AnchorTx }
  | { at: "paid"; token: string; id: string; hash: string; tx?: AnchorTx };

function CashOut({ wallet, balance, onDone }: { wallet: string; balance: bigint | null; onDone: () => void }) {
  const [amount, setAmount] = useState("5");
  const [step, setStep] = useState<Step>({ at: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  let units: bigint | null = null;
  try {
    units = parseUsdc(amount);
  } catch {}

  // Follow the anchor's status while a withdrawal is open.
  useEffect(() => {
    if (step.at === "idle") return;
    let stopped = false;
    const tick = async () => {
      try {
        const tx = await withdrawal(step.token, step.id);
        if (!stopped) setStep((s) => (s.at !== "idle" && s.id === tx.id ? { ...s, tx } : s));
      } catch {}
    };
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [step.at, step.at !== "idle" ? step.id : null, step.at !== "idle" ? step.token : null]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const start = () =>
    run(`Sign in to ${ANCHOR_DOMAIN} with your passkey`, async () => {
      if (!units || units <= 0n) throw new Error("Enter an amount like 5");
      if (balance !== null && units > balance) throw new Error("That's more than your balance.");
      const token = await anchorSignIn(wallet);
      setBusy("Opening the withdrawal");
      const { id, url } = await startWithdrawal(token, wallet, amount);
      setStep({ at: "form", token, id, url });
    });

  const tx = step.at !== "idle" ? step.tx : undefined;
  const ready = step.at === "form" && tx?.status === "pending_user_transfer_start";

  const pay = () =>
    run("Confirm the payment with your passkey", async () => {
      if (step.at !== "form" || !tx) return;
      const due = parseUsdc(tx.amount_in ?? amount);
      const hash = await sendUsdc(wallet, payee(tx), due);
      setStep({ at: "paid", token: step.token, id: step.id, hash, tx });
      onDone();
    });

  return (
    <div className="side-card cashout" data-testid="cashout">
      <Eyebrow>Cash out to a bank</Eyebrow>
      <h3 style={{ fontSize: 30, margin: "12px 0" }}>Dollars in, naira out.</h3>
      <p className="hint">
        A Stellar anchor pays your bank and takes USDC from your wallet. You sign in to it with your passkey (SEP-45) and
        fill in your bank details on the anchor's own page (SEP-24); Paperstall never sees them.
      </p>
      {step.at === "idle" && (
        <div className="form" style={{ marginTop: 14 }}>
          <label>
            Amount in USDC
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            {units !== null && units > 0n && (
              <span className="hint">
                <Local usdc={units} /> before the anchor's fees
              </span>
            )}
          </label>
          <TagButton onClick={start} disabled={!!busy} icon={<Banknote size={16} />} data-testid="cashout-start">
            Start cash-out
          </TagButton>
        </div>
      )}
      {step.at !== "idle" && (
        <Receipt className="anchor-receipt">
          <div className="receipt-head">
            <span>{ANCHOR_DOMAIN}</span>
            <span className="verified" data-testid="cashout-status">
              {tx ? (STATUS_TEXT[tx.status] ?? tx.status) : "Opening"}
            </span>
          </div>
          {step.at === "form" && !ready && (
            <>
              <p>Fill in the anchor's form, then come back here. This page follows the withdrawal as it moves.</p>
              <a className="tag" href={step.url} target="_blank" rel="noreferrer" data-testid="cashout-form">
                Open the anchor's form
                <span className="tile" aria-hidden="true">
                  <ExternalLink size={16} />
                </span>
              </a>
            </>
          )}
          {ready && tx && (
            <>
              <p>
                The anchor is ready for <strong>${tx.amount_in}</strong> USDC
                {tx.amount_fee ? ` (its fee: $${tx.amount_fee})` : ""}.
              </p>
              <TagButton onClick={pay} disabled={!!busy} icon={<Send size={16} />} data-testid="cashout-pay">
                Send ${tx.amount_in} USDC
              </TagButton>
            </>
          )}
          {step.at === "paid" && (
            <p>
              Sent.{" "}
              <a href={explorerTx(step.hash)} target="_blank" rel="noreferrer">
                View the payment
              </a>
              {tx?.more_info_url && (
                <>
                  {" "}
                  ·{" "}
                  <a href={tx.more_info_url} target="_blank" rel="noreferrer">
                    Anchor's receipt
                  </a>
                </>
              )}
            </p>
          )}
          <button className="text-link" onClick={() => setStep({ at: "idle" })}>
            Start over
          </button>
        </Receipt>
      )}
      {busy && <Status>{busy}</Status>}
      {error && <p className="error">{error}</p>}
      <p className="hint" style={{ marginTop: 14 }}>
        On testnet this is the Stellar Development Foundation's test anchor: the USDC really moves, the bank payout is
        simulated. Estimates are mid-market · <RatesCredit />
      </p>
    </div>
  );
}
