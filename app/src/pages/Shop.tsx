import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Shop as ShopData } from "../api";
import { explorerAccount, Eyebrow, ProductCard, Status } from "../ui";
import { short } from "../useWallet";

/** A creator's own shop page: their name, a short bio and everything they sell. */
export function Shop({ id }: { id: string }) {
  const [shop, setShop] = useState<ShopData | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setShop(null);
    api
      .shop(id)
      .then(setShop)
      .catch(() => setMissing(true));
  }, [id]);

  if (missing) {
    return (
      <section className="band dark">
        <div className="container">
          <h1>No shop here.</h1>
          <Link href="/" className="text-link">
            Back to the store
          </Link>
        </div>
      </section>
    );
  }
  if (!shop) {
    return (
      <section className="band dark">
        <div className="container">
          <Status>Loading the shop</Status>
        </div>
      </section>
    );
  }

  const name = shop.profile?.name ?? `Shop ${short(shop.wallet)}`;
  const sold = shop.products.reduce((n, p) => n + p.sales, 0);
  const link = `${window.location.origin}/c/${shop.profile?.handle ?? shop.wallet}`;

  return (
    <>
      <section className="band dark lined tight">
        <div className="container">
          <Eyebrow>{shop.profile?.handle ? `@${shop.profile.handle}` : "Shop"}</Eyebrow>
          <h1 data-testid="shop-name">{name}</h1>
          {shop.profile?.bio && <p className="lead">{shop.profile.bio}</p>}
          <p className="hint mono" style={{ marginTop: 18 }}>
            {shop.products.length} product{shop.products.length === 1 ? "" : "s"} · {sold} sold · paid to{" "}
            <a href={explorerAccount(shop.wallet)} target="_blank" rel="noreferrer">
              {short(shop.wallet)}
            </a>{" "}
            ·{" "}
            <button className="text-link" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>
              <Copy size={13} /> {copied ? "Copied" : "Copy shop link"}
            </button>
          </p>
        </div>
      </section>
      <section className="band dark">
        <div className="container">
          {shop.products.length === 0 ? (
            <div className="empty">Nothing on this shelf yet.</div>
          ) : (
            <div className="grid">
              {shop.products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
