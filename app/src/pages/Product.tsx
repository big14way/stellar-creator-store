import { useCallback, useEffect, useState } from "react";
import { api, fileSize, type Product } from "../api";
import { formatUsdc, usdcBalance } from "../chain";
import { short, useWallet } from "../useWallet";
import { callStore } from "../wallet";

const isAddress = (s: string | null): s is string => !!s && /^[GC][A-Z2-7]{55}$/.test(s);

export function ProductPage({ id }: { id: string }) {
  const { wallet, restoring, create, signIn } = useWallet();
  const [product, setProduct] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [download, setDownload] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ref = new URLSearchParams(window.location.search).get("ref");
  const affiliate = isAddress(ref) ? ref : undefined;

  useEffect(() => {
    api
      .product(id)
      .then(setProduct)
      .catch(() => setNotFound(true));
    api.access(id).then((a) => setDownload(a.download)).catch(() => {});
  }, [id]);

  const refreshBalance = useCallback(async (w: string) => {
    const b = await usdcBalance(w).catch(() => 0n);
    setBalance(b);
    return b;
  }, []);

  useEffect(() => {
    if (wallet) refreshBalance(wallet);
  }, [wallet, refreshBalance]);

  if (notFound) return <p>This product doesn't exist.</p>;
  if (!product) return <p className="muted">Loading…</p>;

  const price = BigInt(product.price);
  const short_of = wallet && balance !== null && balance < price ? price - balance : null;

  async function pay() {
    setError(null);
    try {
      let w = wallet;
      if (!w) {
        setBusy("Creating your wallet…");
        w = await create("Buyer");
      }
      const b = await refreshBalance(w);
      if (b < price) {
        setBusy(null);
        return; // the top-up panel shows what's missing
      }
      setBusy("Confirm with your passkey…");
      await callStore("buy", { buyer: w, product_id: BigInt(id), affiliate });
      setBusy("Unlocking your download…");
      const access = await api.access(id);
      setDownload(access.download);
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
    setBusy("Sending you 10 test USDC…");
    try {
      await api.faucet(wallet);
      await refreshBalance(wallet);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const shareLink = wallet ? `${window.location.origin}/p/${id}?ref=${wallet}` : null;
  const affiliateEarn = (price * BigInt(product.affiliateBps)) / 10_000n;

  return (
    <article className="product">
      <div className="product-media">
        {product.cover ? <img src={product.cover} alt="" /> : <div className="cover-placeholder big">{product.title.slice(0, 1)}</div>}
      </div>
      <div className="product-info">
        <h1>{product.title}</h1>
        <p className="muted">
          by <span title={product.creator}>{short(product.creator)}</span> · {product.sales} sold
        </p>
        <p className="price" data-testid="price">
          ${formatUsdc(price)} <span className="muted">USDC</span>
        </p>
        {product.description && <p className="description">{product.description}</p>}
        <p className="muted">
          You get: {product.file.name} ({fileSize(product.file.size)})
        </p>

        {download ? (
          <div className="owned" data-testid="owned">
            <a className="button primary" href={download} data-testid="download">
              Download
            </a>
            <p className="hint">
              Your download link works on any device. Save it:{" "}
              <code data-testid="download-link">{`${window.location.origin}${download}`}</code>
            </p>
          </div>
        ) : !product.active ? (
          <p className="muted">The creator has paused sales of this product.</p>
        ) : (
          <div className="buy">
            <button className="button primary" onClick={pay} disabled={!!busy || restoring} data-testid="buy">
              {wallet ? `Pay $${formatUsdc(price)}` : `Buy with a passkey`}
            </button>
            {!wallet && !restoring && (
              <button className="link-button" onClick={() => signIn().catch(() => {})} disabled={!!busy}>
                I already have a wallet
              </button>
            )}
            {short_of !== null && (
              <div className="topup" data-testid="topup">
                <p>
                  Your wallet has ${formatUsdc(balance!)} USDC. Add ${formatUsdc(short_of)} more to buy this. Send USDC on
                  Stellar to:
                </p>
                <code className="address">{wallet}</code>
                <button className="button" onClick={testUsdc} disabled={!!busy} data-testid="faucet">
                  Get 10 test USDC
                </button>
              </div>
            )}
            {wallet && balance !== null && short_of === null && (
              <p className="hint" data-testid="balance">
                Wallet {short(wallet)}: ${formatUsdc(balance)} USDC. No XLM needed; we cover the network fee.
              </p>
            )}
          </div>
        )}
        {busy && (
          <p className="muted" data-testid="busy">
            {busy}
          </p>
        )}
        {error && (
          <p className="error" data-testid="error">
            {error}
          </p>
        )}

        {product.affiliateBps > 0 && (
          <div className="affiliate">
            <strong>
              Earn {product.affiliateBps / 100}% (${formatUsdc(affiliateEarn)}) for every sale you refer
            </strong>
            {shareLink ? (
              <p>
                <code>{shareLink}</code>{" "}
                <button
                  className="link-button"
                  onClick={() => navigator.clipboard.writeText(shareLink).then(() => setCopied(true))}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </p>
            ) : (
              <p className="hint">Create a wallet to get your link. You're paid the moment a sale you referred happens.</p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
