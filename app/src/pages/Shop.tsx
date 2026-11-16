import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Shop as ShopData } from "../api";
import { ShelfPage } from "../shelf";
import { explorerAccount, Status } from "../ui";
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
      <section className="band dark lined page-hero">
        <div className="container">
          <h1>No shop here.</h1>
          <Link href="/shop" className="text-link">
            Back to the shelf
          </Link>
        </div>
      </section>
    );
  }
  if (!shop) {
    return (
      <section className="band dark lined page-hero">
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
    <ShelfPage
      crumbs={[{ label: "Home", href: "/" }, { label: "Shop", href: "/shop" }, { label: name }]}
      eyebrow={shop.profile?.handle ? `@${shop.profile.handle}` : "A creator's shop"}
      title={[name]}
      titleTestId="shop-name"
      lead={shop.profile?.bio || undefined}
      stats={[
        { n: shop.products.length, label: shop.products.length === 1 ? "Product" : "Products" },
        { n: sold, label: "Sold" },
        { n: new Set(shop.products.map((p) => p.kind)).size, label: "Aisles" },
      ]}
      extra={
        <p className="hint mono shop-links">
          Paid to{" "}
          <a href={explorerAccount(shop.wallet)} target="_blank" rel="noreferrer">
            {short(shop.wallet)}
          </a>{" "}
          ·{" "}
          <button className="text-link" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>
            <Copy size={13} /> {copied ? "Copied" : "Copy shop link"}
          </button>
        </p>
      }
      products={shop.products}
      listTitle={["Everything", "in this shop."]}
      empty="Nothing on this shelf yet."
    />
  );
}
