import { Copy, Download, Fingerprint, ShoppingBag } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { api, fileSize, type Access, type Product } from "../api";
import { formatUsdc, usdcBalance } from "../chain";
import { explorerTx, Eyebrow, fileKind, ProductBox, Receipt, Spec, Status, TagButton } from "../ui";
import { short, useWallet } from "../useWallet";
import { callStore } from "../wallet";

const isAddress = (s: string | null): s is string => !!s && /^[GC][A-Z2-7]{55}$/.test(s);

export function ProductPage({ id }: { id: string }) {
  const { wallet, restoring, create, signIn } = useWallet();
  const [product, setProduct] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
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
  }, [id]);

  const refreshBalance = useCallback(async (w: string) => {
    const b = await usdcBalance(w).catch(() => 0n);
    setBalance(b);
    return b;
  }, []);

  useEffect(() => {
    if (wallet) refreshBalance(wallet);
  }, [wallet, refreshBalance]);

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

  async function pay() {
    setError(null);
    try {
      let w = wallet;
      if (!w) {
        setBusy("Creating your wallet with a passkey");
        w = await create("Buyer");
      }
      const b = await refreshBalance(w);
      if (b < price) {
        setBusy(null);
        return; // the top-up panel shows what's missing
      }
      setBusy("Confirm with your passkey");
      await callStore("buy", { buyer: w, product_id: BigInt(id), affiliate });
      setBusy("Unlocking your download");
      setAccess(await api.access(id));
      refreshBalance(w);
      setProduct({ ...product!, sales: product!.sales + 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function testUsdc() {
    if (!wallet) return;
    setError(null);
    setBusy("Sending you 10 test USDC");
    try {
      await api.faucet(wallet);
      await refreshBalance(wallet);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(() => setCopied(what));
  }

  const shareLink = wallet ? `${window.location.origin}/p/${id}?ref=${wallet}` : null;
  const downloadUrl = owned ? `${window.location.origin}${owned}` : null;

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
              <Link href="/#shelf">Products</Link>
              <span className="sep">●</span>
              {product.title}
            </p>
            <h1>{product.title}</h1>
            <p className="product-meta mono">
              {fileKind(product.file.name)} · {fileSize(product.file.size)} · {product.sales} sold
            </p>
            {product.description && <p className="lead">{product.description}</p>}
            <p className="price" data-testid="price">
              ${formatUsdc(price)}
            </p>
            <p className="statline mono">Instant download · Paid in USDC · No XLM needed</p>

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
                    This private link works on any device. Keep it:{" "}
                    <code data-testid="download-link">{downloadUrl}</code>
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
                      onClick={pay}
                      disabled={!!busy || restoring}
                      data-testid="buy"
                      icon={wallet ? <ShoppingBag size={16} /> : <Fingerprint size={16} />}
                    >
                      {wallet ? `Pay $${formatUsdc(price)}` : "Buy with a passkey"}
                    </TagButton>
                    {!wallet && !restoring && (
                      <button className="ghost" onClick={() => signIn().catch(() => {})} disabled={!!busy}>
                        I have a wallet
                      </button>
                    )}
                  </div>
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
                        <button className="ghost" onClick={testUsdc} disabled={!!busy} data-testid="faucet">
                          Get 10 test USDC
                        </button>
                      </div>
                    </div>
                  )}
                  {wallet && balance !== null && shortOf === null && (
                    <p className="hint" data-testid="balance">
                      Wallet {short(wallet)}: ${formatUsdc(balance)} USDC. We cover the network fee.
                    </p>
                  )}
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
                  note: short(product.creator),
                  total: true,
                },
              ]}
            />
            <p className="hint" style={{ marginTop: 14 }}>
              The contract pays everyone in the same transaction as your purchase.
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
                <p className="hint">Create a wallet with a passkey to get your link.</p>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
