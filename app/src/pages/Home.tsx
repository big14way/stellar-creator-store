import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Product } from "../api";
import { formatUsdc } from "../chain";

export function Home() {
  const [products, setProducts] = useState<Product[] | null>(null);
  useEffect(() => {
    api.products().then(setProducts).catch(() => setProducts([]));
  }, []);

  return (
    <>
      <section className="hero">
        <h1>Sell digital products. Get paid in dollars the moment a sale happens.</h1>
        <p>
          Templates, ebooks, courses, beats. Buyers anywhere pay in USDC; a contract pays you, your co-creators and
          your affiliates in the same second. No payout queue, no weekend wait.
        </p>
        <Link href="/sell" className="button primary">
          Start selling
        </Link>
      </section>

      <section>
        <h2>Latest products</h2>
        {products === null ? (
          <p className="muted">Loading…</p>
        ) : products.length === 0 ? (
          <p className="muted">Nothing listed yet. Be the first.</p>
        ) : (
          <div className="grid">
            {products.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`} className="card">
                {p.cover ? <img src={p.cover} alt="" /> : <div className="cover-placeholder">{p.title.slice(0, 1)}</div>}
                <div className="card-body">
                  <strong>{p.title}</strong>
                  <span>${formatUsdc(BigInt(p.price))}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
