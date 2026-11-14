import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Link } from "wouter";
import type { Product, Sale } from "./api";
import { formatUsdc } from "./chain";

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

type TagProps = { children: ReactNode; icon: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>;

/** The price-tag button: punched hole on the left, dark icon tile on the right. */
export function TagButton({ children, icon, className, ...rest }: TagProps) {
  return (
    <button className={`tag ${className ?? ""}`} {...rest}>
      {children}
      <span className="tile" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

export function TagLink({ href, children, icon }: { href: string; children: ReactNode; icon: ReactNode }) {
  return (
    <Link href={href} className="tag">
      {children}
      <span className="tile" aria-hidden="true">
        {icon}
      </span>
    </Link>
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
    <Link href={href} className={`box ${big ? "big" : ""}`} style={style} aria-label={product.title}>
      {inner}
    </Link>
  ) : (
    <div className={`box ${big ? "big" : ""}`} style={style}>
      {inner}
    </div>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const stamp = stampFor(product);
  return (
    <Link href={`/p/${product.id}`} className="card">
      <div className="card-art" style={{ "--tone": toneFor(product.id) } as CSSProperties}>
        <div className="art-inner">
          {product.cover ? <img src={product.cover} alt="" /> : <div className="placeholder">{product.title}</div>}
        </div>
        {stamp && <span className="stamp">{stamp}</span>}
      </div>
      <div className="card-meta">
        <strong>{product.title}</strong>
        <span className="card-price">${formatUsdc(BigInt(product.price))}</span>
      </div>
      <span className="mono muted card-sub">
        {fileKind(product.file.name)} · {product.sales} sold
      </span>
    </Link>
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

export const explorerTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

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
