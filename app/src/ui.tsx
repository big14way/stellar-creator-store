import { useEffect, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { api, type Product, type Rates, type Sale } from "./api";
import { formatUsdc } from "./chain";
import { EXPLORER } from "./config";
import { kindOf } from "./kinds";

/** Our mark: a receipt with a torn edge and a four-point star cut out of it. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M7 3h18a2 2 0 0 1 2 2v23l-3-2-3 2-3-2-3 2-3-2-3 2-3-2V5a2 2 0 0 1 2-2z"
        fill="#FF6A2B"
      />
      <path d="M16 8.5l1.7 4.8 4.8 1.7-4.8 1.7L16 21.5l-1.7-4.8-4.8-1.7 4.8-1.7z" fill="#17100C" />
    </svg>
  );
}

// Cover colours for products without a cover image; all stand out on the dark shop.
const TONES = ["#4740d9", "#ff6a2b", "#1f8a70", "#b04b20"];
export const toneFor = (id: number) => TONES[id % TONES.length];

/** File type from its name, for the mono meta line: "lagos-nights.zip" -> "ZIP". */
export function fileKind(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return ext ? ext.toUpperCase().slice(0, 6) : "FILE";
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
/** A stamp only when it is literally true. */
export function stampFor(p: Product): string | null {
  if (p.sales >= 3) return `${p.sales} sold`;
  if (Date.now() - p.listedAt < WEEK) return "New";
  return null;
}

type Variant = "solid" | "dark" | "light";
type TagProps = { children: ReactNode; icon: ReactNode; variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>;

/** The inside of a price-tag button: punched hole, a fill that wipes out from the hole, a label that rolls, an icon tile. */
function TagInside({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <>
      <span className="tag-hole" aria-hidden="true" />
      <span className="tag-fill" aria-hidden="true" />
      <span className="tag-lbl">
        <span className="l1">{children}</span>
        <span className="l2" aria-hidden="true">
          {children}
        </span>
      </span>
      <span className="tile" aria-hidden="true">
        {icon}
      </span>
    </>
  );
}

/** The price-tag button. On hover it swings on its hole, like a tag on a string. */
export function TagButton({ children, icon, variant = "solid", className, ...rest }: TagProps) {
  return (
    <button className={`tag ${variant} ${className ?? ""}`} {...rest}>
      <TagInside icon={icon}>{children}</TagInside>
    </button>
  );
}

export function TagLink({ href, children, icon, variant = "solid" }: { href: string; children: ReactNode; icon: ReactNode; variant?: Variant }) {
  return (
    <Link href={href} className={`tag ${variant}`}>
      <TagInside icon={icon}>{children}</TagInside>
    </Link>
  );
}

/** A tag that is a plain link (a download, an outside page). */
export function TagAnchor({
  children,
  icon,
  variant = "solid",
  ...rest
}: { children: ReactNode; icon: ReactNode; variant?: Variant } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={`tag ${variant}`} {...rest}>
      <TagInside icon={icon}>{children}</TagInside>
    </a>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

/** A product as a 3D box on a shelf: its cover if it has one, otherwise a printed face. */
export function ProductBox({ product, big, href }: { product: Product; big?: boolean; href?: string }) {
  const stamp = stampFor(product);
  const inner = (
    <>
      {stamp && <span className={big ? "stamp burst" : "stamp"}>{stamp}</span>}
      <div className={`face ${product.cover ? "has-cover" : ""}`}>
        {product.cover && <img src={product.cover} alt="" />}
        <span className="barcode" />
        <div>
          <div className="box-title">{product.title}</div>
          <div className="box-meta">
            {fileKind(product.file.name)} · ${formatUsdc(BigInt(product.price))}
          </div>
        </div>
      </div>
      <span className="spine" />
    </>
  );
  const style = { "--tone": toneFor(product.id) } as CSSProperties;
  return href ? (
    <Link href={href} className={`box kind-${product.kind} ${big ? "big" : ""}`} style={style} aria-label={product.title}>
      {inner}
    </Link>
  ) : (
    <div className={`box kind-${product.kind} ${big ? "big" : ""}`} style={style}>
      {inner}
    </div>
  );
}

/** A product as a card: duotone cover, stamp, title and price, aisle underneath. */
export function ProductCard({ product }: { product: Product }) {
  const stamp = stampFor(product);
  return (
    <Link href={`/p/${product.id}`} className="card">
      <div className="card-art duo" style={{ "--tone": toneFor(product.id) } as CSSProperties}>
        {product.cover ? <img src={product.cover} alt="" loading="lazy" /> : <div className="placeholder">{product.title}</div>}
        {stamp && <span className="stamp">{stamp}</span>}
      </div>
      <div className="card-meta">
        <strong>{product.title}</strong>
        <span className="card-price">${formatUsdc(BigInt(product.price))}</span>
      </div>
      <span className="mono card-sub">
        {kindOf(product.kind).one} · {fileKind(product.file.name)}
      </span>
    </Link>
  );
}

/** A box standing on a shelf stage, for product grids (the box, then its title, price and aisle). */
export function StagedProduct({ product }: { product: Product }) {
  return (
    <Link href={`/p/${product.id}`} className="staged">
      <div className="stage">
        <ProductBox product={product} />
        <span className="stage-plank" />
      </div>
      <div className="card-meta">
        <strong>{product.title}</strong>
        <span className="card-price">${formatUsdc(BigInt(product.price))}</span>
      </div>
      <span className="mono card-sub">
        {kindOf(product.kind).one} · {fileKind(product.file.name)} · {product.sales} sold
      </span>
    </Link>
  );
}

/** One sale as a pinned receipt: what sold, for how much, to which wallet, and its transaction. */
export function SaleCard({ sale, index }: { sale: Sale; index: number }) {
  const tilt = [-2, 1.5, -1, 2][index % 4];
  return (
    <a className="sale-card" href={explorerTx(sale.txHash)} target="_blank" rel="noreferrer" style={{ "--r": `${tilt}deg` } as CSSProperties}>
      <span className="pin" aria-hidden="true" />
      <div className="sale-head mono">
        <span className="ok">Settled</span>
        <span>#{sale.txHash.slice(0, 6)}</span>
      </div>
      <strong className="sale-title">{sale.title}</strong>
      <div className="sale-price">{sale.price ? `$${formatUsdc(BigInt(sale.price))}` : "Paid"}</div>
      <dl className="sale-rows mono">
        <div>
          <dt>Buyer</dt>
          <dd>
            {sale.buyer.slice(0, 4)}…{sale.buyer.slice(-4)}
          </dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{ago(sale.at)}</dd>
        </div>
        <div>
          <dt>Paid in</dt>
          <dd>USDC · 1 transaction</dd>
        </div>
      </dl>
      <span className="sale-stamp mono">On Stellar ↗</span>
    </a>
  );
}

export function Receipt({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`receipt ${className ?? ""}`}>{children}</div>;
}

/** A dotted-leader list: LABEL ········ value */
export function Spec({ rows }: { rows: { label: string; value: ReactNode; note?: ReactNode; total?: boolean }[] }) {
  return (
    <dl className="spec">
      {rows.map((r) => (
        <div key={r.label} className={r.total ? "total" : undefined}>
          <dt>{r.label}</dt>
          <dd>
            {r.value}
            {r.note && <small>{r.note}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Status({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="status" data-testid={testId} role="status">
      <span className="spinner" aria-hidden="true" />
      {children}
    </p>
  );
}

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAccount = (address: string) =>
  `${EXPLORER}/${address.startsWith("C") ? "contract" : "account"}/${address}`;

export function useRates(): Rates | null {
  const [rates, setRates] = useState<Rates | null>(null);
  useEffect(() => {
    api.rates().then(setRates);
  }, []);
  return rates;
}

const whole = (n: number) => Math.round(n).toLocaleString("en-NG");

/** "≈ ₦13,520 · GH₵118" for a USDC amount, from the day's mid-market rate. */
export function Local({ usdc, className }: { usdc: bigint; className?: string }) {
  const rates = useRates();
  if (!rates) return null;
  const usd = Number(usdc) / 1e7;
  return (
    <span className={`local ${className ?? ""}`} title={`Mid-market estimate, ${rates.updated}`}>
      ≈ ₦{whole(usd * rates.NGN)} · GH₵{whole(usd * rates.GHS)}
    </span>
  );
}

/** The rate source's required credit, shown wherever we show an estimate. */
export function RatesCredit() {
  return (
    <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer" className="rates-credit">
      Rates By Exchange Rate API
    </a>
  );
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ago(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** A strip of real sales, each linking to its transaction. */
export function Ticker({ sales }: { sales: Sale[] }) {
  const items = sales.map((s) => (
    <a key={s.txHash} className="ticker-item" href={explorerTx(s.txHash)} target="_blank" rel="noreferrer">
      <span className="sold">Sold</span>
      <span>{clock(s.at)}</span>
      <strong>{s.title}</strong>
      {s.price && <span>${formatUsdc(BigInt(s.price))}</span>}
      <span className="dot">●</span>
    </a>
  ));
  // Repeat until the strip is wide enough to loop without a gap.
  const copies = Math.max(2, Math.ceil(8 / Math.max(1, sales.length)) * 2);
  return (
    <div className="ticker" aria-label="Recent sales">
      <div className="ticker-track">
        {Array.from({ length: copies }, (_, i) => (
          <div key={i} style={{ display: "flex" }} aria-hidden={i > 0}>
            {items}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The home page's shelf: navigates home if needed, then scrolls to it (a hash link alone doesn't, with client routing). */
export function ShelfLink({ className, children }: { className?: string; children: ReactNode }) {
  const [location, navigate] = useLocation();
  return (
    <a
      href="/#shelf"
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (location !== "/") navigate("/");
        let tries = 0;
        const scroll = () => {
          const shelf = document.getElementById("shelf");
          if (shelf) shelf.scrollIntoView({ behavior: "smooth", block: "start" });
          else if (tries++ < 30) requestAnimationFrame(scroll);
        };
        requestAnimationFrame(scroll);
      }}
    >
      {children}
    </a>
  );
}
