import { Copy, Download, Fingerprint, ShoppingBag, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { api, fileSize, shopPath, type Access, type Config, type Product } from "../api";
import { formatUsdc, usdcBalance } from "../chain";
import { accountState, addUsdc, buyWithStellar, friendbot, type AccountState } from "../stellarWallet";
import { explorerTx, Eyebrow, fileKind, Local, ProductBox, RatesCredit, Receipt, Spec, Status, TagButton } from "../ui";
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

  const ref = new URLSearchParams(window.location.search).get("ref");
  const affiliate = isAddress(ref) ? ref : undefined;

  useEffect(() => {
    setProduct(null);
    api
      .product(id)
      .then(setProduct)
      .catch(() => setNotFound(true));
    api
      .access(id)
      .then(setAccess)
      .catch(() => {});
    api.config().then(setConfig).catch(() => {});
  }, [id]);

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
    setAccess(await api.access(id));
    setProduct((p) => (p ? { ...p, sales: p.sales + 1 } : p));
  }

  const payWithPasskey = () =>
    run(wallet ? "Checking your balance" : "Creating your wallet with a passkey", async () => {
      let w = wallet;
      if (!w) w = await create("Buyer");
      const b = await refreshBalance(w);
      if (b < price) return; // the top-up panel shows what's missing
      setBusy("Confirm with your passkey");
      await callStore("buy", { buyer: w, product_id: BigInt(id), affiliate });
      await unlocked();
      refreshBalance(w);
    });

  const payWithStellar = () =>
    run("Approve the payment in your wallet", async () => {
      await buyWithStellar(stellar!, BigInt(id), affiliate);
      await unlocked();
      refreshAccount(stellar!);
    });

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(() => setCopied(what));
  }

  const earner = wallet ?? stellar;
  const shareLink = earner ? `${window.location.origin}/p/${id}?ref=${earner}` : null;
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
            This wallet has <strong>${formatUsdc(account.usdc)}</strong> USDC. Add ${formatUsdc(price - account.usdc)} to buy
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

  return (
    <>
      <section className="band dark lined product-top">
        <div className="container product-grid">
          <div>
            <ProductBox product={product} big />
          </div>
          <div>
            <p className="crumbs mono">
              <Link href="/">Store</Link>
              <span className="sep">●</span>
              <Link href={shopPath(product.creator, product.creatorProfile)}>{by}</Link>
              <span className="sep">●</span>
              {product.title}
            </p>
            <h1>{product.title}</h1>
            <p className="product-meta mono">
              {fileKind(product.file.name)} · {fileSize(product.file.size)} · {product.sales} sold · by{" "}
              <Link href={shopPath(product.creator, product.creatorProfile)} className="text-link">
                {by}
              </Link>
            </p>
            {product.description && <p className="lead description">{product.description}</p>}
            <p className="price" data-testid="price">
              ${formatUsdc(price)}
            </p>
            <p className="statline mono">
              <Local usdc={price} /> · Instant download · Paid in USDC
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
                    <a className="tag" href={owned} data-testid="download">
                      Download
                      <span className="tile" aria-hidden="true">
                        <Download size={16} />
                      </span>
                    </a>
                    <button className="ghost" onClick={() => copy(downloadUrl!, "download")}>
                      <Copy size={14} /> {copied === "download" ? "Copied" : "Copy link"}
                    </button>
                  </div>
                  <p className="hint" style={{ marginTop: 14 }}>
                    This private link works on any device. Keep it, or find it later in your{" "}
                    <Link href="/library">library</Link>: <code data-testid="download-link">{downloadUrl}</code>
                  </p>
                </Receipt>
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
                        Your wallet has <strong>${formatUsdc(balance!)}</strong>. Add ${formatUsdc(shortOf)} USDC to buy
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

      <section className="band cream tight">
        <div className="container two-col">
          <div>
            <Eyebrow>Where your ${formatUsdc(price)} goes</Eyebrow>
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
                {
                  label: "Creator",
                  value: `$${formatUsdc(creatorGets)}`,
                  note: by,
                  total: true,
                },
              ]}
            />
            <p className="hint" style={{ marginTop: 14 }}>
              The contract pays everyone in the same transaction as your purchase. Naira and cedi amounts are mid-market
              estimates · <RatesCredit />
            </p>
          </div>

          {product.affiliateBps > 0 && (
            <div>
              <Eyebrow>Share and earn</Eyebrow>
              <h3 style={{ fontSize: 34, marginTop: 14 }}>
                Earn ${formatUsdc(cut(product.affiliateBps))} for every sale you send.
              </h3>
              <p className="lead">
                {product.affiliateBps / 100}% of each sale through your link lands in your wallet the moment it happens.
              </p>
              {shareLink ? (
                <div className="panel" style={{ borderColor: "var(--rule-light)" }}>
                  <code>{shareLink}</code>
                  <button className="text-link" onClick={() => copy(shareLink, "share")}>
                    <Copy size={14} /> {copied === "share" ? "Copied" : "Copy your link"}
                  </button>
                </div>
              ) : (
                <p className="hint">Create a passkey wallet or connect a Stellar wallet above to get your link.</p>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
