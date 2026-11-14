import { ArrowRight, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Product, type Sale } from "../api";
import { formatUsdc, read } from "../chain";
import { STORE_ID } from "../config";
import { clock, explorerTx, Eyebrow, ProductBox, ProductCard, Receipt, Spec, TagLink, Ticker } from "../ui";

const EXAMPLE = 10_0000000n; // a 10 USDC sale, to show the split

export function Home() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [feeBps, setFeeBps] = useState<number | null>(null);

  useEffect(() => {
    api.products().then(setProducts).catch(() => setProducts([]));
    api.sales().then(setSales).catch(() => setSales([]));
    read<{ fee_bps: number }>(STORE_ID, "config")
      .then((c) => setFeeBps(c.fee_bps))
      .catch(() => setFeeBps(null));
  }, []);

  const shelf = (products ?? []).slice(0, 3);
  const cut = (bps: number) => (EXAMPLE * BigInt(bps)) / 10_000n;
  const fee = feeBps ?? 500;

  return (
    <>
      <section className="band dark lined hero">
        <div className="container hero-grid">
          <div>
            <Eyebrow>For creators in Nigeria and Ghana</Eyebrow>
            <h1 className="display">
              Sell what you make.
              <br />
              <span className="accent">Get paid in dollars.</span>
            </h1>
            <p className="lead">
              Buyers anywhere pay in USDC. A contract on Stellar pays you, your co-creators and your affiliates in the
              same transaction. No payout queue, no weekend wait, no seed phrase.
            </p>
            <div className="actions">
              <TagLink href="/sell" icon={<Store size={16} />}>
                Start selling
              </TagLink>
              <a href="#shelf" className="ghost">
                Browse the shelf
              </a>
            </div>
          </div>

          <div className="hero-side">
            {shelf.length > 0 && (
              <div className="shelf">
                {shelf.map((p) => (
                  <ProductBox key={p.id} product={p} href={`/p/${p.id}`} />
                ))}
              </div>
            )}
            {sales.length > 0 && (
              <Receipt className="tilt">
                <div className="receipt-head">
                  <span>Paperstall · recent sales</span>
                  <span className="verified">On chain</span>
                </div>
                <div className="receipt-rows">
                  {sales.slice(0, 4).map((s) => (
                    <a key={s.txHash} href={explorerTx(s.txHash)} target="_blank" rel="noreferrer">
                      <span>{clock(s.at)}</span>
                      <span className="r-title">{s.title}</span>
                      <span>{s.price ? `$${formatUsdc(BigInt(s.price))}` : ""}</span>
                    </a>
                  ))}
                </div>
                <div className="receipt-foot">Each line links to its transaction on Stellar</div>
              </Receipt>
            )}
          </div>
        </div>
      </section>

      {sales.length > 0 && <Ticker sales={sales} />}

      <section className="band cream">
        <div className="container">
          <div className="section-head">
            <div>
              <Eyebrow>How a sale settles</Eyebrow>
              <h2>
                One payment.
                <br />
                Everyone paid.
              </h2>
            </div>
            <p className="lead">
              No platform balance to withdraw from. Each sale is split by a smart contract and lands in every wallet at
              once.
            </p>
          </div>
          <ol className="rows">
            <li>
              <span className="num">01</span>
              <h3>Buyer pays</h3>
              <div>
                <span className="row-meta">Passkey or Stellar wallet · USDC</span>
                <p>A fingerprint or face makes a wallet, or pay from Freighter, LOBSTR or xBull. The store covers the network fee.</p>
              </div>
            </li>
            <li>
              <span className="num">02</span>
              <h3>The contract splits</h3>
              <div>
                <span className="row-meta">Soroban · one transaction</span>
                <p>Creator, co-creators, the affiliate who sent the buyer, and a {fee / 100}% platform fee.</p>
              </div>
            </li>
            <li>
              <span className="num">03</span>
              <h3>Everyone is paid</h3>
              <div>
                <span className="row-meta">Straight to each wallet</span>
                <p>Dollars stay dollars. A share that can't be delivered yet waits until its owner claims it.</p>
              </div>
            </li>
            <li>
              <span className="num">04</span>
              <h3>The receipt unlocks it</h3>
              <div>
                <span className="row-meta">On-chain receipt · private link</span>
                <p>The buyer downloads at once and keeps a link that works on any device.</p>
              </div>
            </li>
            <li>
              <span className="num">05</span>
              <h3>Cash out when you want</h3>
              <div>
                <span className="row-meta">Stellar anchor · SEP-24</span>
                <p>Keep dollars, send them to any Stellar wallet, or cash out to a bank through an anchor.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="band dark" id="shelf">
        <div className="container">
          <div className="bar">
            <span className="eyebrow">On the shelf</span>
            <Link href="/sell" className="text-link">
              Sell yours <ArrowRight size={14} />
            </Link>
          </div>
          {products === null ? (
            <p className="muted">Loading the shelf…</p>
          ) : products.length === 0 ? (
            <div className="empty">Nothing listed yet. The first product goes right here.</div>
          ) : (
            <div className="grid">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="band cream">
        <div className="container two-col">
          <div>
            <Eyebrow>Where $10 goes</Eyebrow>
            <h2>
              Read the split
              <br />
              before you list.
            </h2>
            <p className="lead">
              You set the price, the affiliate share and any co-creators. The contract enforces it on every sale, and
              nobody can change a co-creator's share after listing.
            </p>
            <div className="actions">
              <TagLink href="/sell" icon={<Store size={16} />}>
                List a product
              </TagLink>
            </div>
          </div>
          <Receipt>
            <div className="receipt-head">
              <span>Example · $10.00 sale</span>
              <span className="verified">10% affiliate</span>
            </div>
            <Spec
              rows={[
                { label: "Affiliate", value: `$${formatUsdc(cut(1000))}`, note: "only when someone referred the buyer" },
                { label: "Platform fee", value: `$${formatUsdc(cut(fee))}`, note: `${fee / 100}%, fixed when you list` },
                { label: "Network fee", value: "$0.00", note: "paid by the store" },
                { label: "You", value: `$${formatUsdc(EXAMPLE - cut(1000) - cut(fee))}`, total: true },
              ]}
            />
          </Receipt>
        </div>
      </section>
    </>
  );
}
