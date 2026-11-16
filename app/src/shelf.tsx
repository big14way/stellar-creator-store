import { useState, type CSSProperties, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import type { Product } from "./api";
import { KINDS } from "./kinds";
import { Headline, Reveal } from "./motion";
import { Eyebrow, ProductBox, StagedProduct } from "./ui";

const PRICES = [
  { id: "all", label: "All prices", test: () => true },
  { id: "low", label: "Under $1", test: (p: Product) => BigInt(p.price) < 1_0000000n },
  { id: "mid", label: "$1 – $10", test: (p: Product) => BigInt(p.price) >= 1_0000000n && BigInt(p.price) <= 10_0000000n },
  { id: "high", label: "Over $10", test: (p: Product) => BigInt(p.price) > 10_0000000n },
];

const SORTS = [
  { id: "featured", label: "Most sold", sort: (a: Product, b: Product) => b.sales - a.sales || b.id - a.id },
  { id: "new", label: "Newest", sort: (a: Product, b: Product) => b.id - a.id },
  { id: "cheap", label: "Price, low to high", sort: (a: Product, b: Product) => Number(BigInt(a.price) - BigInt(b.price)) },
  { id: "dear", label: "Price, high to low", sort: (a: Product, b: Product) => Number(BigInt(b.price) - BigInt(a.price)) },
];

type Props = {
  crumbs: { label: string; href?: string }[];
  eyebrow: string;
  title: string[];
  titleTestId?: string;
  lead?: ReactNode;
  stats: { n: string | number; label: string }[];
  extra?: ReactNode;
  products: Product[] | null;
  listTitle: string[];
  empty: ReactNode;
};

/** A shelf of products: a dark header with a few boxes on a plank, then the whole shelf with aisle and price filters. */
export function ShelfPage({ crumbs, eyebrow, title, titleTestId, lead, stats, extra, products, listTitle, empty }: Props) {
  const search = new URLSearchParams(useSearch());
  const [aisle, setAisle] = useState<string>(search.get("aisle") ?? "all");
  const [price, setPrice] = useState("all");
  const [sort, setSort] = useState("featured");
  const all = products ?? [];
  const counts = (id: string) => all.filter((p) => p.kind === id).length;
  const shown = all
    .filter((p) => aisle === "all" || p.kind === aisle)
    .filter(PRICES.find((x) => x.id === price)!.test)
    .sort(SORTS.find((s) => s.id === sort)!.sort);

  return (
    <>
      <section className="band dark lined page-hero">
        <div className="container page-hero-grid">
          <div>
            <p className="crumbs mono">
              {crumbs.map((c, i) => (
                <span key={c.label}>
                  {i > 0 && <span className="sep">/</span>}
                  {c.href ? <Link href={c.href}>{c.label}</Link> : <span className="here">{c.label}</span>}
                </span>
              ))}
            </p>
            <Reveal>
              <Eyebrow>{eyebrow}</Eyebrow>
            </Reveal>
            <Headline as="h1" lines={title} testId={titleTestId} />
            {lead && (
              <Reveal delay={200}>
                <div className="lead">{lead}</div>
              </Reveal>
            )}
            <Reveal delay={300} className="stat-row">
              {stats.map((s) => (
                <span key={s.label} className="stat-inline">
                  <strong>{s.n}</strong>
                  <span className="dash" />
                  <span className="mono">{s.label}</span>
                </span>
              ))}
            </Reveal>
            {extra}
          </div>
          <div className="mini-shelf" aria-hidden="true">
            <span className="mono mini-label">On the shelf</span>
            <div className="mini-objects">
              {all.slice(0, 5).map((p, i) => (
                <div key={p.id} className="shelf-obj" style={{ "--i": i } as CSSProperties}>
                  <ProductBox product={p} />
                </div>
              ))}
            </div>
            <span className="plank" />
          </div>
        </div>
      </section>

      <section className="band cream shelf-list">
        <div className="container">
          <Reveal>
            <Eyebrow>The whole shelf</Eyebrow>
          </Reveal>
          <Headline lines={listTitle} />
          <div className="filters">
            <div className="chip-row" role="group" aria-label="Aisle">
              <button className={`fchip ${aisle === "all" ? "on" : ""}`} onClick={() => setAisle("all")}>
                All aisles
              </button>
              {KINDS.filter((k) => counts(k.id) > 0).map((k) => (
                <button key={k.id} className={`fchip ${aisle === k.id ? "on" : ""}`} onClick={() => setAisle(k.id)}>
                  {k.label} <span>{counts(k.id)}</span>
                </button>
              ))}
            </div>
            <div className="chip-row second">
              <div className="price-chips" role="group" aria-label="Price">
                {PRICES.map((p) => (
                  <button key={p.id} className={`fchip small ${price === p.id ? "on" : ""}`} onClick={() => setPrice(p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
              <label className="sort mono">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <p className="mono count">
            {products === null ? "Loading the shelf…" : `${shown.length} product${shown.length === 1 ? "" : "s"}`}
          </p>
          {products !== null && shown.length === 0 ? (
            <div className="empty">{all.length === 0 ? empty : "Nothing in this aisle at that price."}</div>
          ) : (
            <div className="grid staged-grid">
              {shown.map((p, i) => (
                <Reveal key={p.id} delay={(i % 3) * 80}>
                  <StagedProduct product={p} />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
