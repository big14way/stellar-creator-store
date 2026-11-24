import { Copy, Download, Fingerprint, ShoppingBag, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { api, fileSize, shopPath, type Access, type Config, type Product, type Sale } from "../api";
import { formatUsdc, formatUsdcUp, usdcBalance } from "../chain";
import { accountState, addUsdc, buyWithStellar, friendbot, type AccountState } from "../stellarWallet";
import { kindOf } from "../kinds";
import { AddMoney } from "../AddMoney";
import { Headline, Reveal } from "../motion";
import {
  explorerTx,
  Eyebrow,
  fileKind,
  Local,
  ProductBox,
  ProductCard,
  RatesCredit,
  Receipt,
  SaleCard,
  Spec,
  Status,
  TagAnchor,
  TagButton,
} from "../ui";
import { short, useWallet } from "../useWallet";
import { callStore } from "../wallet";

const isAddress = (s: string | null): s is string => !!s && /^[GC][A-Z2-7]{55}$/.test(s);

export function ProductPage({ id }: { id: string }) {
  const { wallet, stellar, restoring, create, signIn, connectStellar, disconnectStellar, refreshProven } = useWallet();
  const [product, setProduct] = useState<Product | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [shelf, setShelf] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);

  const ref = new URLSearchParams(window.location.search).get("ref");

  useEffect(() => {
    setProduct(null);
    setNotFound(false);
    api
      .product(id)
      .then(setProduct)
      .catch(() => setNotFound(true));
    api.config().then(setConfig).catch(() => {});
    api.products().then(setShelf).catch(() => setShelf([]));
    api.sales().then(setSales).catch(() => setSales([]));
  }, [id]);

  // Whether this browser already owns it: again whenever a wallet signs in or changes.
  useEffect(() => {
    let current = true;
    setAccess(null);
    api
      .access(id)
      .then((a) => current && setAccess(a))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [id, wallet, stellar]);

  const refreshBalance = useCallback(async (w: string) => {
    const b = await usdcBalance(w).catch(() => 0n);
    setBalance(b);
    return b;
  }, []);

  const refreshAccount = useCallback(async (g: string) => {
    const state = await accountState(g).catch(() => null);
    setAccount(state);
    return state;
  }, []);

  useEffect(() => {
    if (wallet) refreshBalance(wallet);
  }, [wallet, refreshBalance]);

  useEffect(() => {
    if (stellar) refreshAccount(stellar);
    else setAccount(null);
  }, [stellar, refreshAccount]);

  if (notFound) {
    return (
      <section className="band dark">
        <div className="container">
          <h1>This product isn't on the shelf.</h1>
          <Link href="/" className="text-link">
            Back to the store
          </Link>
        </div>
      </section>
    );
  }
  if (!product) {
    return (
      <section className="band dark product-top">
        <div className="container">
          <Status>Loading product</Status>
        </div>
      </section>
    );
  }

  const price = BigInt(product.price);
  const productId = BigInt(product.id);
  const mine = product.creator === wallet || product.creator === stellar;
  // The contract ignores an affiliate who is the buyer or the creator, so the page does too.
  const affiliate =
    isAddress(ref) && product.affiliateBps > 0 && ref !== product.creator && ref !== wallet && ref !== stellar ? ref : undefined;
  const shortOf = wallet && balance !== null && balance < price ? price - balance : null;
  const owned = access?.download ?? null;
  const cut = (bps: number) => (price * BigInt(bps)) / 10_000n;
  const coBps = product.shares.reduce((n, s) => n + s.bps, 0);
  const creatorGets = price - cut(product.feeBps) - cut(coBps) - (affiliate ? cut(product.affiliateBps) : 0n);
  const testnet = config?.faucet ?? false;

  async function run(label: string, fn: () => Promise<unknown>) {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function unlocked() {
    setBusy("Unlocking your download");
    await refreshProven();
    setAccess(await api.access(product!.id));
    setProduct((p) => (p ? { ...p, sales: p.sales + 1 } : p));
  }

  const payWithPasskey = () =>
    run(wallet ? "Checking your balance" : "Creating your wallet with a passkey", async () => {
      let w = wallet;
      if (!w) w = await create("Buyer");
      const b = await refreshBalance(w);
      if (b < price) return; // the top-up panel shows what's missing
      setBusy("Confirm with your passkey");
      await callStore("buy", { buyer: w, product_id: productId, affiliate });
      await unlocked();
      refreshBalance(w);
    });

  const payWithStellar = () =>
    run("Approve the payment in your wallet", async () => {
      await buyWithStellar(stellar!, productId, affiliate);
      await unlocked();
      refreshAccount(stellar!);
    });

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(() => setCopied(what));
  }

  const earner = wallet ?? stellar;
  const shareLink = earner ? `${window.location.origin}/p/${product.id}?ref=${earner}` : null;
  const downloadUrl = owned ? `${window.location.origin}${owned}` : null;
  const by = product.creatorProfile?.name ?? short(product.creator);

  const stellarPanel = !stellar ? (
    <div className="pay-alt">
      <button className="ghost" onClick={() => run("Choose your wallet", connectStellar)} disabled={!!busy} data-testid="stellar-connect">
        <Wallet size={14} /> Pay with a Stellar wallet
      </button>
      <span className="hint">Freighter, LOBSTR, xBull, Albedo and more. We pay the network fee.</span>
    </div>
  ) : (
    <div className="panel" data-testid="stellar-panel">
      <p className="mono muted" style={{ margin: 0 }}>
        Stellar wallet {short(stellar)} ·{" "}
        <button className="text-link" onClick={disconnectStellar}>
          use another
        </button>
      </p>
      {account === null ? (
        <Status>Checking the account</Status>
      ) : !account.exists ? (
        <>
          <p>This account isn't on the {config?.network ?? "network"} yet.</p>
          {testnet && (
            <button
              className="ghost"
              data-testid="stellar-fund"
              disabled={!!busy}
              onClick={() => run("Asking Friendbot for test XLM", async () => (await friendbot(stellar), refreshAccount(stellar)))}
            >
              Fund it with Friendbot
            </button>
          )}
        </>
      ) : account.usdc === null ? (
        <>
          <p>Your wallet needs to hold USDC before it can pay. Adding it costs 0.00001 XLM and keeps 0.5 XLM in reserve.</p>
          <button
            className="ghost"
            data-testid="stellar-trust"
            disabled={!!busy}
            onClick={() => run("Approve adding USDC in your wallet", async () => (await addUsdc(stellar), refreshAccount(stellar)))}
          >
            Add USDC to this wallet
          </button>
        </>
      ) : account.usdc < price ? (
        <>
          <p>
            This wallet has <strong>${formatUsdc(account.usdc)}</strong> USDC. Add ${formatUsdcUp(price - account.usdc)} to buy
            this.
          </p>
          {testnet && (
            <button
              className="ghost"
              data-testid="stellar-faucet"
              disabled={!!busy}
              onClick={() => run("Sending you 10 test USDC", async () => (await api.faucet(stellar), refreshAccount(stellar)))}
            >
              Get 10 test USDC
            </button>
          )}
        </>
      ) : (
        <div className="actions" style={{ marginTop: 0 }}>
          <TagButton onClick={payWithStellar} disabled={!!busy} data-testid="pay-stellar" icon={<ShoppingBag size={16} />}>
            Pay ${formatUsdc(price)}
          </TagButton>
          <span className="hint">From your ${formatUsdc(account.usdc)} USDC. We cover the network fee.</span>
        </div>
      )}
    </div>
  );

  const kind = kindOf(product.kind);
  const more = [
    ...shelf.filter((p) => p.id !== product.id && p.kind === product.kind),
    ...shelf.filter((p) => p.id !== product.id && p.kind !== product.kind),
  ].slice(0, 3);
  const receipts = sales.filter((s) => s.productId === product.id);

  return (
    <>
      <section className="band dark lined product-top">
        <div className="container product-grid">
          <div className="product-box-col">
            <ProductBox product={product} big />
          </div>
          <div>
            <p className="crumbs mono">
              <Link href="/">Home</Link>
              <span className="sep">●</span>
              <Link href={shopPath(product.creator, product.creatorProfile)}>{by}</Link>
              <span className="sep">●</span>
              <span className="here">{product.title}</span>
            </p>
            <Headline as="h1" lines={[product.title]} className="product-title" />
            <p className="product-meta mono">
              {kind.one} · {fileKind(product.file.name)} · {fileSize(product.file.size)} · by{" "}
              <Link href={shopPath(product.creator, product.creatorProfile)}>{by}</Link>
            </p>
            {product.description && <p className="lead description">{product.description}</p>}
            <p className="price" data-testid="price">
              ${formatUsdc(price)}
            </p>
            <p className="statline mono">
              Instant download · {product.sales} sold · Paid in USDC · <Local usdc={price} />
            </p>

            <div className="buy-panel">
              {owned ? (
                <Receipt className="owned-receipt">
                  <div className="receipt-head" data-testid="owned">
                    <span>Receipt · paid ${formatUsdc(price)}</span>
                    {access?.txHash ? (
                      <a className="verified" href={explorerTx(access.txHash)} target="_blank" rel="noreferrer">
                        Verified on Stellar
                      </a>
                    ) : (
                      <span className="verified">Paid</span>
                    )}
                  </div>
                  <div className="receipt-title">{product.file.name}</div>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <TagAnchor href={owned} data-testid="download" icon={<Download size={16} />}>
                      Download
                    </TagAnchor>
                    <button className="ghost" onClick={() => copy(downloadUrl!, "download")}>
                      <Copy size={14} /> {copied === "download" ? "Copied" : "Copy link"}
                    </button>
                  </div>
                  <p className="hint" style={{ marginTop: 14 }}>
                    This private link works on any device. Keep it, or find it later in your{" "}
                    <Link href="/library">library</Link>: <code data-testid="download-link">{downloadUrl}</code>
                  </p>
                </Receipt>
              ) : mine ? (
                <div className="panel" data-testid="own-product">
                  <p>
                    This is your product. Change its price, pause it or see its sales on your{" "}
                    <Link href="/dashboard">dashboard</Link>.
                  </p>
                </div>
              ) : !product.active ? (
                <div className="panel">
                  <p>The creator has paused sales of this product.</p>
                </div>
              ) : (
                <>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <TagButton
                      onClick={payWithPasskey}
                      disabled={!!busy || restoring}
                      data-testid="buy"
                      icon={wallet ? <ShoppingBag size={16} /> : <Fingerprint size={16} />}
                    >
                      {wallet ? `Pay $${formatUsdc(price)}` : "Buy with a passkey"}
                    </TagButton>
                    {!wallet && !restoring && (
                      <button className="ghost" onClick={() => run("Confirm with your passkey", signIn)} disabled={!!busy}>
                        I have a passkey wallet
                      </button>
                    )}
                  </div>
                  {!wallet && (
                    <p className="hint" style={{ marginTop: 10 }}>
                      Your fingerprint or face makes a wallet in seconds. No app, no seed phrase, no XLM.
                    </p>
                  )}
                  {shortOf !== null && (
                    <div className="panel" data-testid="topup">
                      <p>
                        Your wallet has <strong>${formatUsdc(balance!)}</strong>. Add ${formatUsdcUp(shortOf)} USDC to buy
                        this. Send USDC on Stellar to:
                      </p>
                      <code className="address">{wallet}</code>
                      <div className="actions" style={{ marginTop: 0 }}>
                        <button className="ghost" onClick={() => copy(wallet!, "address")}>
                          <Copy size={14} /> {copied === "address" ? "Copied" : "Copy address"}
                        </button>
                        {testnet && (
                          <button
                            className="ghost"
                            disabled={!!busy}
                            data-testid="faucet"
                            onClick={() => run("Sending you 10 test USDC", async () => (await api.faucet(wallet!), refreshBalance(wallet!)))}
                          >
                            Get 10 test USDC
                          </button>
                        )}
                      </div>
                      <AddMoney wallet={wallet!} short={shortOf} onAdded={() => refreshBalance(wallet!)} />
                    </div>
                  )}
                  {wallet && balance !== null && shortOf === null && (
                    <p className="hint" data-testid="balance">
                      Wallet {short(wallet)}: ${formatUsdc(balance)} USDC. We cover the network fee.
                    </p>
                  )}
                  <div className="or">or</div>
                  {stellarPanel}
                </>
              )}
              {busy && <Status testId="busy">{busy}</Status>}
              {error && (
                <p className="error" data-testid="error">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="band cream product-details">
        <div className="container product-grid">
          <div />
          <div>
            <Reveal className="detail-block">
              <span className="mono detail-label">What's inside</span>
              <div className="inside-chips">
                <span className="chip-tag dot">{product.file.name}</span>
                <span className="chip-tag dot">{fileSize(product.file.size)}</span>
                <span className="chip-tag dot">{kind.one}</span>
                <span className="chip-tag dot">Yours to keep</span>
              </div>
            </Reveal>
            <Reveal className="detail-block" delay={100}>
              <span className="mono detail-label">Where your ${formatUsdc(price)} goes</span>
              <Spec
                rows={[
                  ...product.shares.map((s, i) => ({
                    label: `Co-creator ${i + 1}`,
                    value: `$${formatUsdc(cut(s.bps))}`,
                    note: `${s.bps / 100}% · ${short(s.to)}`,
                  })),
                  ...(product.affiliateBps > 0
                    ? [
                        {
                          label: "Affiliate",
                          value: affiliate ? `$${formatUsdc(cut(product.affiliateBps))}` : "$0.00",
                          note: affiliate
                            ? `${product.affiliateBps / 100}% to ${short(affiliate)}, who sent you here`
                            : `${product.affiliateBps / 100}% when someone refers the buyer`,
                        },
                      ]
                    : []),
                  { label: "Platform fee", value: `$${formatUsdc(cut(product.feeBps))}`, note: `${product.feeBps / 100}%` },
                  { label: "Network fee", value: "$0.00", note: "paid by the store" },
                  { label: "Creator", value: `$${formatUsdc(creatorGets)}`, note: by, total: true },
                ]}
              />
            </Reveal>
            <Reveal className="works-line" delay={150}>
              <span className="mono">Pay with</span>
              <strong>Passkey + Stellar wallets</strong>
              <span className="hint">
                The contract pays everyone in the same transaction as your purchase. Naira and cedi amounts are mid-market
                estimates · <RatesCredit />
              </span>
            </Reveal>

            {product.affiliateBps > 0 && !mine && (
              <Reveal className="share-card">
                <Eyebrow>Share and earn</Eyebrow>
                <h3>Earn ${formatUsdc(cut(product.affiliateBps))} for every sale you send.</h3>
                <p>{product.affiliateBps / 100}% of each sale through your link lands in your wallet the moment it happens.</p>
                {shareLink ? (
                  <div className="panel">
                    <code>{shareLink}</code>
                    <button className="text-link" onClick={() => copy(shareLink, "share")}>
                      <Copy size={14} /> {copied === "share" ? "Copied" : "Copy your link"}
                    </button>
                  </div>
                ) : (
                  <p className="hint">Create a passkey wallet or connect a Stellar wallet above to get your link.</p>
                )}
              </Reveal>
            )}
          </div>
        </div>

        {more.length > 0 && (
          <div className="container more">
            <div className="bar">
              <span className="eyebrow">More from the shelf</span>
              <Link href="/shop" className="text-link">
                All products →
              </Link>
            </div>
            <div className="grid">
              {more.map((p, i) => (
                <Reveal key={p.id} delay={i * 90}>
                  <ProductCard product={p} />
                </Reveal>
              ))}
            </div>
          </div>
        )}
      </section>

      {receipts.length > 0 && (
        <section className="band dark lined receipts">
          <div className="container">
            <div className="section-head">
              <div>
                <Reveal>
                  <Eyebrow>Receipts</Eyebrow>
                </Reveal>
                <Headline lines={["Bought by", "real wallets."]} />
              </div>
              <Reveal delay={200} className="head-side">
                <p className="lead">Each card is a purchase of this product, recorded on Stellar testnet.</p>
              </Reveal>
            </div>
          </div>
          <div className="wall">
            {receipts.map((s, i) => (
              <SaleCard key={s.txHash} sale={s} index={i} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
