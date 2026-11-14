import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Product } from "../api";
import { formatUsdc, owedTo, usdcBalance } from "../chain";
import { useWallet } from "../useWallet";
import { callStore } from "../wallet";

export function Dashboard() {
  const { wallet, restoring, signIn, signOut } = useWallet();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [held, setHeld] = useState<bigint>(0n);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (w: string) => {
    const [ps, b, h] = await Promise.all([api.products(w), usdcBalance(w).catch(() => 0n), owedTo(w).catch(() => 0n)]);
    setProducts(ps);
    setBalance(b);
    setHeld(h);
  }, []);

  useEffect(() => {
    if (wallet) load(wallet).catch((e) => setError(String(e)));
  }, [wallet, load]);

  if (restoring) return <p className="muted">Loading…</p>;
  if (!wallet) {
    return (
      <section className="narrow">
        <h1>Dashboard</h1>
        <p>Sign in with your passkey to see your sales and earnings.</p>
        <button className="button primary" onClick={() => signIn().catch((e) => setError(String(e)))}>
          Sign in
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  async function claim() {
    setBusy("Confirm with your passkey…");
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

  const revenue = (products ?? []).reduce((sum, p) => sum + BigInt(p.price) * BigInt(p.sales), 0n);

  return (
    <section>
      <h1>Dashboard</h1>
      <div className="stats">
        <div className="stat">
          <span className="muted">Wallet balance</span>
          <strong data-testid="balance">${balance === null ? "…" : formatUsdc(balance)}</strong>
          <span className="hint">USDC. Sales land here the moment they happen.</span>
        </div>
        <div className="stat">
          <span className="muted">Sales</span>
          <strong data-testid="sales">{(products ?? []).reduce((n, p) => n + p.sales, 0)}</strong>
          <span className="hint">${formatUsdc(revenue)} in gross sales</span>
        </div>
        {held > 0n && (
          <div className="stat">
            <span className="muted">Held for you</span>
            <strong>${formatUsdc(held)}</strong>
            <button className="button" onClick={claim} disabled={!!busy}>
              Claim
            </button>
          </div>
        )}
      </div>

      <h2>Your products</h2>
      {products === null ? (
        <p className="muted">Loading…</p>
      ) : products.length === 0 ? (
        <p>
          No products yet. <Link href="/sell">List your first one</Link>.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Price</th>
              <th>Sales</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/p/${p.id}`}>{p.title}</Link>
                  {!p.active && <span className="muted"> (paused)</span>}
                </td>
                <td>${formatUsdc(BigInt(p.price))}</td>
                <td>{p.sales}</td>
                <td>
                  <button
                    className="link-button"
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/p/${p.id}`)}
                  >
                    Copy link
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}
      <p className="hint">
        Wallet <code>{wallet}</code> ·{" "}
        <button className="link-button" onClick={() => signOut()}>
          Sign out
        </button>
      </p>
    </section>
  );
}
