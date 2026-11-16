import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Product } from "../api";
import { ShelfPage } from "../shelf";

/** Every product on the public shelf. */
export function All() {
  const [products, setProducts] = useState<Product[] | null>(null);
  useEffect(() => {
    api.products().then(setProducts).catch(() => setProducts([]));
  }, []);
  const all = products ?? [];
  return (
    <ShelfPage
      crumbs={[{ label: "Home", href: "/" }, { label: "Shop" }]}
      eyebrow="The shelf"
      title={["Every product,", "one shelf."]}
      lead="Templates, ebooks, courses, beats and design files from creators in Nigeria and Ghana. Filter by aisle or price, open one, and the file is yours once you pay."
      stats={[
        { n: all.length, label: "Products" },
        { n: new Set(all.map((p) => p.kind)).size, label: "Aisles" },
        { n: all.reduce((n, p) => n + p.sales, 0), label: "Sold" },
      ]}
      products={products}
      listTitle={["Every product,", "one place."]}
      empty={
        <>
          Nothing listed yet. <Link href="/sell">The first product goes right here.</Link>
        </>
      }
    />
  );
}
