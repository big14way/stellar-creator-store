import { ArrowRight, Copy, Fingerprint, Tag } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Product } from "../api";
import { formatUsdc, owedTo, usdcBalance } from "../chain";
import { Eyebrow, fileKind, Receipt, Status, TagButton, TagLink } from "../ui";
import { short, useWallet } from "../useWallet";
import { callStore } from "../wallet";

export function Dashboard() {
  const { wallet, restoring, signIn, signOut } = useWallet();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [held, setHeld] = useState<bigint>(0n);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async (w: string) => {
    const [ps, b, h] = await Promise.all([api.products(w), usdcBalance(w).catch(() => 0n), owedTo(w).catch(() => 0n)]);
    setProducts(ps);
    setBalance(b);
    setHeld(h);
  }, []);

  useEffect(() => {
    if (wallet) load(wallet).catch((e) => setError(String(e)));
  }, [wallet, load]);

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
          <p className="lead">Sign in with your passkey to see your balance, sales and products.</p>
          <div className="actions">
            <TagButton onClick={() => signIn().catch((e) => setError(String(e)))} icon={<Fingerprint size={16} />}>
              Sign in
            </TagButton>
            <Link href="/sell" className="ghost">
              New here? Start selling
            </Link>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </section>
    );
  }

  async function claim() {
    setBusy("Confirm with your passkey");
    setError(null);
    try {
      await callStore("claim", { to: wallet! });
      await load(wallet!);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const list = products ?? [];
  const sales = list.reduce((n, p) => n + p.sales, 0);
  const gross = list.reduce((sum, p) => sum + BigInt(p.price) * BigInt(p.sales), 0n);

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
                  {sales}
                </span>
                <span className="muted">${formatUsdc(gross)} at today's prices</span>
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
                  <button className="ghost" onClick={claim} disabled={!!busy} style={{ marginTop: 8 }}>
                    Claim it now
                  </button>
                </div>
              </Receipt>
            )}
          </div>
          <div style={{ marginTop: 22 }}>
            {busy && <Status>{busy}</Status>}
            {error && <p className="error">{error}</p>}
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
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="hide-sm">Type</th>
                    <th className="num">Price</th>
                    <th className="num">Sales</th>
                    <th className="num">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/p/${p.id}`} className="t-title">
                          {p.title}
                        </Link>
                        {!p.active && <span className="pill">Paused</span>}
                      </td>
                      <td className="hide-sm mono">{fileKind(p.file.name)}</td>
                      <td className="num">${formatUsdc(BigInt(p.price))}</td>
                      <td className="num">{p.sales}</td>
                      <td className="num">
                        <button
                          className="text-link"
                          onClick={() =>
                            navigator.clipboard.writeText(`${window.location.origin}/p/${p.id}`).then(() => setCopied(p.id))
                          }
                        >
                          <Copy size={14} /> {copied === p.id ? "Copied" : "Copy"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint" style={{ marginTop: 24 }}>
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
