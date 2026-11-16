import { ArrowRight, BadgeDollarSign, Check, Code, Fingerprint, Play, Plus, ShoppingBag, Store, X } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "wouter";
import { api, fileSize, type Config, type Product, type Sale, type Stats } from "../api";
import { formatUsdc, read } from "../chain";
import { EXPLORER, STORE_ID } from "../config";
import { KINDS, kindOf } from "../kinds";
import { CountUp, Headline, Reveal, useInView } from "../motion";
import {
  ago,
  explorerTx,
  Eyebrow,
  fileKind,
  ProductBox,
  ProductCard,
  Receipt,
  SaleCard,
  Spec,
  TagAnchor,
  TagButton,
  TagLink,
  Ticker,
  toneFor,
} from "../ui";
import { useWallet } from "../useWallet";
import { explain } from "../wallet";

const REPO = "https://github.com/big14way/stellar-creator-store";
const usd = (units: bigint | string | number) => `$${formatUsdc(BigInt(units))}`;

export function Home() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [feeBps, setFeeBps] = useState(500);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    api.products().then(setProducts).catch(() => setProducts([]));
    api.sales().then(setSales).catch(() => setSales([]));
    api.stats().then(setStats).catch(() => setStats(null));
    api.config().then(setConfig).catch(() => setConfig(null));
    read<{ fee_bps: number }>(STORE_ID, "config")
      .then((c) => setFeeBps(c.fee_bps))
      .catch(() => {});
  }, []);

  // Best sellers first; ties go to the newest listing.
  const ranked = [...(products ?? [])].sort((a, b) => b.sales - a.sales || b.id - a.id);
  const featured = ranked[0];

  return (
    <>
      <Hero products={ranked} sales={sales} stats={stats} />
      {sales.length > 0 && <Ticker sales={sales} />}
      <Aisles products={products ?? []} stats={stats} />
      {featured && <Window featured={featured} more={ranked.slice(1, 4)} />}
      <Inside product={featured} />
      <Splits feeBps={feeBps} />
      <Steps />
      <Numbers stats={stats} />
      {sales.length > 0 && <Receipts sales={sales} />}
      <Counter />
      {config?.faucet !== false && <Free />}
      <Faq feeBps={feeBps} maxFileMb={config?.maxFileMb ?? 20} />
      <Notes />
      <Cta />
    </>
  );
}

/* ---------------- 1. hero: headline, tags, recent-sales receipt; three shelves of real products ---------------- */

function Hero({ products, sales, stats }: { products: Product[]; sales: Sale[]; stats: Stats | null }) {
  const onShelf = products.slice(0, 9);
  const planks = [onShelf.slice(0, 3), onShelf.slice(3, 6), onShelf.slice(6, 9)].filter((p) => p.length > 0);
  return (
    <section className="band dark lined hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <Reveal>
            <Eyebrow>Creator store · Templates · Ebooks · Beats</Eyebrow>
          </Reveal>
          <Headline as="h1" className="display" lines={["Your work,", "sold anywhere,", "paid in dollars."]} accent={2} />
          <Reveal delay={350}>
            <p className="lead">
              Paperstall is a creator store for Nigeria and Ghana: templates, ebooks, courses and beats sold to buyers
              anywhere, paid in USDC on Stellar the moment they buy.
            </p>
          </Reveal>
          <Reveal delay={450} className="actions">
            <TagLink href="/shop" icon={<ShoppingBag size={16} />}>
              Browse the shelf
            </TagLink>
            <TagLink href="/sell" icon={<Store size={16} />} variant="dark">
              Start selling
            </TagLink>
          </Reveal>
          {sales.length > 0 && (
            <Reveal delay={600}>
              <Receipt className="hero-receipt">
                <div className="receipt-head">
                  <span>Paperstall · recent sales</span>
                  <span className="sold-stamp">Sold</span>
                </div>
                <div className="receipt-rows">
                  {sales.slice(0, 3).map((s) => (
                    <a key={s.txHash} href={explorerTx(s.txHash)} target="_blank" rel="noreferrer">
                      <span className="r-when">{ago(s.at)}</span>
                      <span className="r-title">{s.title}</span>
                      <span className="r-who">
                        {s.buyer.slice(0, 4)}…{s.buyer.slice(-3)}
                      </span>
                      <span className="r-price">{s.price ? usd(s.price) : ""}</span>
                    </a>
                  ))}
                </div>
                {stats && (
                  <div className="receipt-foot">
                    {stats.sales.toLocaleString("en-US")} {stats.sales === 1 ? "sale" : "sales"} · {usd(stats.paid)} paid on
                    Stellar
                  </div>
                )}
              </Receipt>
            </Reveal>
          )}
        </div>

        <div className="hero-shelves" aria-label="On the shelf">
          {planks.map((row, p) => (
            <div key={p} className="plank-row" style={{ "--p": p } as CSSProperties}>
              <div className="plank-objects">
                {row.map((product, i) => (
                  <div key={product.id} className="shelf-obj" style={{ "--i": p * 3 + i } as CSSProperties}>
                    <ProductBox product={product} href={`/p/${product.id}`} />
                    <span className="ptag mono" aria-hidden="true">
                      {usd(product.price)}
                    </span>
                  </div>
                ))}
              </div>
              <span className="plank" />
            </div>
          ))}
          {planks.length === 0 && (
            <div className="plank-row" style={{ "--p": 0 } as CSSProperties}>
              <div className="plank-objects">
                <Link href="/sell" className="box empty-box">
                  <div className="face">
                    <div className="box-title">Your product here</div>
                  </div>
                </Link>
              </div>
              <span className="plank" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------- 2. the aisles: a numbered list of kinds, each with its count; a box follows the cursor ---------------- */

function Aisles({ products, stats }: { products: Product[]; stats: Stats | null }) {
  const [hover, setHover] = useState<{ kind: string; x: number; y: number } | null>(null);
  const counts = stats?.kinds ?? {};
  const sample = hover ? products.find((p) => p.kind === hover.kind) : undefined;
  const move = (kind: string) => (e: ReactPointerEvent) => setHover({ kind, x: e.clientX, y: e.clientY });
  return (
    <section className="band cream aisles">
      <div className="container">
        <div className="section-head">
          <div>
            <Reveal>
              <Eyebrow>The aisles</Eyebrow>
            </Reveal>
            <Headline lines={["Six aisles.", "Any file you make."]} />
          </div>
          <Reveal delay={200} className="head-side">
            <p className="lead">Every product is a file. The buyer pays once in USDC and downloads it on any device.</p>
            <TagLink href="/shop" icon={<ArrowRight size={16} />} variant="light">
              Browse everything
            </TagLink>
          </Reveal>
        </div>
        <ol className="aisle-list" onPointerLeave={() => setHover(null)}>
          {KINDS.map((k, i) => (
            <Reveal as="li" key={k.id} delay={i * 60}>
              <Link href={`/shop?aisle=${k.id}`} className="aisle" onPointerMove={move(k.id)}>
                <span className="aisle-num mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="aisle-name">{k.label}</span>
                <span className="aisle-info">
                  <span className="mono">
                    {counts[k.id] ?? 0} {(counts[k.id] ?? 0) === 1 ? "product" : "products"}
                  </span>
                  <span>{k.blurb}</span>
                </span>
                <ArrowRight className="aisle-go" size={20} />
                <span className="aisle-line" />
              </Link>
            </Reveal>
          ))}
        </ol>
      </div>
      {hover && sample && (
        <div className="aisle-float" style={{ left: hover.x, top: hover.y }} aria-hidden="true">
          <ProductBox product={sample} />
        </div>
      )}
    </section>
  );
}

/* ---------------- 3. the window: the best seller grows to fill the screen as you scroll ---------------- */

function Window({ featured, more }: { featured: Product; more: Product[] }) {
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "end end"] });
  const width = useTransform(scrollYProgress, [0.15, 0.7], ["34%", "100%"]);
  const scale = useTransform(scrollYProgress, [0.15, 0.9], [1.25, 1]);
  // A cover too small to fill the window shows as the product's box instead.
  const [tinyCover, setTinyCover] = useState(false);
  const kind = kindOf(featured.kind);
  const chips = [
    `${fileKind(featured.file.name)} · ${fileSize(featured.file.size)}`,
    "Instant download",
    featured.affiliateBps > 0 ? `${featured.affiliateBps / 100}% to affiliates` : "Paid in USDC",
    featured.shares.length > 0
      ? `Split with ${featured.shares.length} co-creator${featured.shares.length > 1 ? "s" : ""}`
      : "No XLM needed",
  ];
  return (
    <section className="band dark window">
      <div className="container">
        <div className="center-head">
          <Reveal>
            <Eyebrow>Most bought on the shelf</Eyebrow>
          </Reveal>
          <Headline lines={["The shop", "window."]} accent={1} />
          <Reveal delay={200}>
            <p className="lead">The product buyers pick most, up close.</p>
          </Reveal>
        </div>
      </div>
      <div className="window-stage" ref={stage}>
        <div className="window-sticky">
          <motion.div className="window-frame" style={{ width }}>
            <div className="window-art duo" style={{ "--tone": toneFor(featured.id) } as CSSProperties}>
              {featured.cover && !tinyCover ? (
                <motion.img
                  src={featured.cover}
                  alt=""
                  style={{ scale }}
                  onLoad={(e) => e.currentTarget.naturalWidth < 400 && setTinyCover(true)}
                />
              ) : (
                <div className="window-box">
                  <ProductBox product={featured} big />
                </div>
              )}
            </div>
            <span className="stamp feature-stamp">Most bought</span>
          </motion.div>
        </div>
      </div>
      <div className="container">
        <Reveal className="window-card">
          <p className="mono accent-ink">
            {kind.one} · {fileKind(featured.file.name)} · {featured.creatorProfile?.name ?? "Paperstall creator"}
          </p>
          <h3>{featured.title}</h3>
          <div className="chips">
            {chips.map((c) => (
              <span key={c} className="chip-tag">
                {c}
              </span>
            ))}
          </div>
          <div className="window-buy">
            <div>
              <div className="window-price">{usd(featured.price)}</div>
              <span className="mono muted-ink">{featured.sales} sold · paid in USDC</span>
            </div>
            <TagLink href={`/p/${featured.id}`} icon={<ArrowRight size={16} />}>
              View product
            </TagLink>
          </div>
        </Reveal>

        {more.length > 0 && (
          <div className="more">
            <div className="bar">
              <span className="eyebrow">More on the shelf</span>
              <Link href="/shop" className="text-link">
                All products <ArrowRight size={14} />
              </Link>
            </div>
            <div className="grid">
              {more.map((p, i) => (
                <Reveal key={p.id} delay={i * 90}>
                  <ProductCard product={p} />
                </Reveal>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- 4. what's inside: an open box with tags rising out; the receipt of what a buyer gets ---------------- */

function Inside({ product }: { product?: Product }) {
  const [ref, open] = useInView<HTMLDivElement>();
  const tags = ["Your file, instantly", "A receipt on Stellar", "A private download link", "Your library, any device"];
  return (
    <section className="band cream inside">
      <div className="container two-col center">
        <div className={`open-box ${open ? "is-open" : ""}`} ref={ref} aria-hidden="true">
          {tags.map((t, i) => (
            <span key={t} className="fly-tag mono" style={{ "--i": i } as CSSProperties}>
              {t}
            </span>
          ))}
          <div className="crate" style={{ "--tone": product ? toneFor(product.id) : "var(--blue)" } as CSSProperties}>
            <span className="lid" />
            <div className="crate-face">
              <strong>{product?.title ?? "Your product"}</strong>
              <span className="mono">
                {product ? `${fileKind(product.file.name)} · ${fileSize(product.file.size)}` : "Any file"}
              </span>
            </div>
          </div>
        </div>
        <div>
          <Reveal>
            <Eyebrow>What a buyer gets</Eyebrow>
          </Reveal>
          <Headline lines={["See the receipt", "before you pay."]} />
          <Reveal delay={200}>
            <p className="lead">
              Every product page shows the file, its size and who gets each dollar of the price, before you sign
              anything.
            </p>
          </Reveal>
          <Reveal delay={300}>
            <Spec
              rows={[
                { label: "Payment", value: "USDC on Stellar" },
                { label: "Network fee", value: "Paid by the store" },
                { label: "Delivery", value: "Instant download" },
                { label: "Access", value: "Any device, private link" },
                { label: "Receipt", value: "A Stellar transaction" },
              ]}
            />
          </Reveal>
          <Reveal delay={400} className="actions">
            <TagLink href={product ? `/p/${product.id}` : "/shop"} icon={<ShoppingBag size={16} />}>
              See a product
            </TagLink>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 5. splits: three stacked cards, each a worked $10 sale ---------------- */

function Splits({ feeBps }: { feeBps: number }) {
  const sale = 10_0000000n;
  const cut = (bps: number) => (sale * BigInt(bps)) / 10_000n;
  const fee = cut(feeBps);
  const cards = [
    {
      title: "Just you",
      lead: "You list it, a buyer pays, and the price minus the platform fee is in your wallet.",
      who: ["You"],
      rows: [] as [string, bigint][],
    },
    {
      title: "With an affiliate",
      lead: "Anyone can share your link. When it brings a buyer, their cut leaves in the same transaction.",
      who: ["You", "Affiliate"],
      rows: [["Affiliate · 10%", cut(1000)]] as [string, bigint][],
    },
    {
      title: "With co-creators",
      lead: "Up to five collaborators, each with a share fixed at listing that nobody can change later.",
      who: ["You", "Co-creator", "Affiliate"],
      rows: [
        ["Co-creator · 30%", cut(3000)],
        ["Affiliate · 10%", cut(1000)],
      ] as [string, bigint][],
    },
  ];
  return (
    <section className="band dark splits">
      <div className="container">
        <div className="section-head">
          <div>
            <Reveal>
              <Eyebrow>Splits</Eyebrow>
            </Reveal>
            <Headline lines={["One sale.", "Everyone paid."]} />
          </div>
          <Reveal delay={200} className="head-side">
            <p className="lead">You set the shares when you list. The contract pays each one in the same transaction as the sale.</p>
            <Link href="/sell" className="text-link">
              List a product <ArrowRight size={14} />
            </Link>
          </Reveal>
        </div>
        <div className="stack">
          {cards.map((c, i) => {
            const you = sale - fee - c.rows.reduce((sum, [, v]) => sum + v, 0n);
            return (
              <article key={c.title} className="stack-card" style={{ "--i": i } as CSSProperties}>
                <div className="stack-copy">
                  <span className="mono">
                    0{i + 1} / 0{cards.length}
                  </span>
                  <h3>{c.title}</h3>
                  <p>{c.lead}</p>
                  <div className="who">
                    {c.who.map((w) => (
                      <span key={w} className="who-chip">
                        <span className="who-dot" />
                        <span>
                          <strong>{w}</strong>
                          <span className="mono">{w === "You" ? "creator" : "paid at once"}</span>
                        </span>
                      </span>
                    ))}
                  </div>
                  <TagLink href="/sell" icon={<Store size={16} />}>
                    List a product
                  </TagLink>
                </div>
                <div className="stack-receipt receipt">
                  <div className="receipt-head">
                    <span>Example · {usd(sale)} sale</span>
                    <span>{c.rows.length + 2} lines</span>
                  </div>
                  <div className="lines mono">
                    {c.rows.map(([label, v]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <span>{usd(v)}</span>
                      </div>
                    ))}
                    <div>
                      <span>Platform · {feeBps / 100}%</span>
                      <span>{usd(fee)}</span>
                    </div>
                    <div>
                      <span>Network fee</span>
                      <span>$0.00</span>
                    </div>
                  </div>
                  <div className="you-get">
                    <span className="mono">You get</span>
                    <strong>{usd(you)}</strong>
                  </div>
                  <span className="seal mono">1 transaction</span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------------- 6. the checkout, step by step: a sticky card follows the step you are reading ---------------- */

const STEPS = [
  { who: "Buyer", title: "Pick a product", text: "Open any product page: the file, its size and the split are all on it." },
  { who: "Buyer", title: "Pay with a fingerprint", text: "A passkey makes a wallet in seconds, or pay from Freighter, LOBSTR, xBull or Albedo." },
  { who: "Store", title: "The store pays the fee", text: "A fee sponsor covers the network fee under strict rules, so nobody needs XLM." },
  { who: "Contract", title: "The contract splits it", text: "Creator, co-creators, affiliate and the platform fee, in one Soroban call." },
  { who: "Server", title: "The receipt unlocks the file", text: "The server checks the sale on chain, then serves the download and a private link." },
  { who: "Creator", title: "Cash out when you want", text: "Keep dollars, send them anywhere on Stellar, or withdraw through an anchor." },
];

function Steps() {
  const [active, setActive] = useState(0);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    rows.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, []);
  const step = STEPS[active];
  return (
    <section className="band cream steps">
      <div className="container">
        <div className="steps-head">
          <Reveal>
            <Eyebrow>The checkout</Eyebrow>
          </Reveal>
          <Headline lines={["Six steps,", "one transaction."]} />
          <Reveal delay={200}>
            <p className="lead">From the buy button to the creator's wallet, in the order it happens. Scroll the sale.</p>
          </Reveal>
        </div>
        <div className="steps-grid">
          <div className="player-col">
            <div className="player">
              <div className="player-art photo-studio" />
              <div className="player-top mono">
                <span className="live">
                  <i /> Now settling
                </span>
                <span>
                  0{active + 1} / 0{STEPS.length}
                </span>
              </div>
              <div className="player-body">
                <span className="play" aria-hidden="true">
                  <Play size={18} fill="currentColor" />
                </span>
                <p key={`m${active}`} className="mono player-mod">
                  Step {active + 1} · {step.who}
                </p>
                <h3 key={`t${active}`} className="player-title">
                  {step.title}
                </h3>
                <p key={`l${active}`} className="player-len">
                  {step.text}
                </p>
                <div className="player-bar">
                  <i style={{ width: `${((active + 1) / STEPS.length) * 100}%` }} />
                </div>
              </div>
              <div className="player-foot mono">6 steps · 1 transaction · No XLM</div>
            </div>
            <div className="player-buy">
              <div>
                <span className="player-price">$0.00</span>
                <span className="mono muted-ink">network fee for buyers</span>
              </div>
              <TagLink href="/c/demo" icon={<ShoppingBag size={16} />}>
                Try the demo shop
              </TagLink>
            </div>
          </div>
          <ol className="step-list">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                data-i={i}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                className={i === active ? "is-active" : undefined}
              >
                <span className="mono step-n">0{i + 1}</span>
                <div>
                  <span className="mono step-who">
                    Step {i + 1} · {s.who}
                  </span>
                  <strong>{s.title}</strong>
                  <p>{s.text}</p>
                </div>
                <span className="mono step-tick">{i < active ? <Check size={14} /> : i === active ? "●" : ""}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 7. in numbers: counted from the store's sales; this week's sales as bars ---------------- */

function Numbers({ stats }: { stats: Stats | null }) {
  const [ref, on] = useInView<HTMLDivElement>();
  const week = stats?.week ?? [];
  const top = Math.max(1, ...week.map((d) => d.sales));
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }).slice(0, 1);
  const items = stats
    ? [
        { n: stats.sales, label: "Sales to date" },
        { n: Number(BigInt(stats.paid)) / 1e7, label: "USDC paid to wallets", money: true },
        { n: stats.products, label: "Products on the shelf" },
        { n: stats.buyers, label: "Wallets that bought" },
      ]
    : [];
  return (
    <section className="band dark lined numbers">
      <div className="container">
        <Reveal>
          <Eyebrow>In numbers</Eyebrow>
        </Reveal>
        <div className="numbers-grid">
          <dl className="stat-grid">
            {items.map((s, i) => (
              <Reveal key={s.label} delay={i * 80} className="stat-cell">
                <dd>
                  {s.money ? "$" : ""}
                  <CountUp
                    value={s.n}
                    format={
                      s.money
                        ? (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : undefined
                    }
                  />
                </dd>
                <dt className="mono">{s.label}</dt>
              </Reveal>
            ))}
          </dl>
          {week.length > 0 && (
            <div className={`chart ${on ? "is-on" : ""}`} ref={ref}>
              <div className="chart-head mono">
                <span>Sales this week</span>
                <span>{week.some((d) => d.sales > 0) ? "UTC days" : "None yet this week"}</span>
              </div>
              <div className="bars">
                {week.map((d, i) => (
                  <div key={d.day} className="bar-col" title={`${d.sales} sales`}>
                    <div className="bar-well">
                      <i
                        className={i === week.length - 1 ? "today" : undefined}
                        style={{ "--h": `${Math.max(3, (d.sales / top) * 100)}%`, "--i": i } as CSSProperties}
                      />
                    </div>
                    <span className="mono">{day(d.day)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="works-with">
          <span className="mono">Pay with</span>
          {["Passkeys", "Freighter", "LOBSTR", "xBull", "Albedo", "Hana", "Circle USDC"].map((w) => (
            <span key={w} className="ww">
              {w}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- 8. receipts: a wall of real sales you can drag ---------------- */

function Receipts({ sales }: { sales: Sale[] }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const down = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse" || !track.current) return;
    drag.current = { x: e.clientX, left: track.current.scrollLeft, moved: false };
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag.current || !track.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    track.current.scrollLeft = drag.current.left - dx;
  };
  const up = () => {
    setTimeout(() => (drag.current = null), 0);
  };
  return (
    <section className="band dark lined receipts">
      <div className="container">
        <div className="section-head">
          <div>
            <Reveal>
              <Eyebrow>Receipts</Eyebrow>
            </Reveal>
            <Headline lines={["Every sale", "is a receipt."]} />
          </div>
          <Reveal delay={200} className="head-side">
            <p className="lead">Each card is a purchase on Stellar testnet. Drag the wall, or open one on the explorer.</p>
            <a className="text-link" href={`${EXPLORER}/contract/${STORE_ID}`} target="_blank" rel="noreferrer">
              The store contract <ArrowRight size={14} />
            </a>
          </Reveal>
        </div>
      </div>
      <div
        className="wall"
        ref={track}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        onClickCapture={(e) => {
          if (drag.current?.moved) e.preventDefault();
        }}
      >
        {sales.map((s, i) => (
          <SaleCard key={s.txHash} sale={s} index={i} />
        ))}
      </div>
    </section>
  );
}

/* ---------------- 9. behind the counter: an arched photo with a polaroid; how it is built ---------------- */

function Counter() {
  return (
    <section className="band cream counter">
      <div className="container two-col center">
        <Reveal className="arch-wrap">
          <div className="arch photo-desk" />
          <figure className="polaroid">
            <div className="photo-keys" />
            <figcaption className="mono">Files, sold anywhere</figcaption>
          </figure>
        </Reveal>
        <div>
          <Reveal>
            <Eyebrow>Behind the counter</Eyebrow>
          </Reveal>
          <Headline lines={["Open source,", "tested live."]} />
          <Reveal delay={200}>
            <p className="body-lg">
              A Soroban contract holds every price and split; the server only keeps the files and pays network fees under
              strict rules. The latest five-person test against the live site passed all 27 checks.
            </p>
          </Reveal>
          <Reveal delay={300}>
            <Spec
              rows={[
                { label: "Network", value: "Stellar testnet" },
                {
                  label: "Contract",
                  value: (
                    <a href={`${EXPLORER}/contract/${STORE_ID}`} target="_blank" rel="noreferrer">
                      {STORE_ID.slice(0, 6)}…{STORE_ID.slice(-4)}
                    </a>
                  ),
                },
                { label: "Wallets", value: "Passkeys and Stellar Wallets Kit" },
                { label: "Latest live test", value: "27 of 27 checks, 15 Nov 2026" },
              ]}
            />
          </Reveal>
          <Reveal delay={400} className="signed">
            <span className="mono">— the Paperstall build</span>
            <TagAnchor href={REPO} target="_blank" rel="noreferrer" icon={<Code size={16} />} variant="light">
              Read the source
            </TagAnchor>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 10. free: ten test dollars from the faucet ---------------- */

function Free() {
  const { wallet, stellar } = useWallet();
  const [address, setAddress] = useState("");
  const [state, setState] = useState<{ busy?: boolean; ok?: string; error?: string }>({});
  useEffect(() => {
    if (!address && (wallet ?? stellar)) setAddress((wallet ?? stellar)!);
  }, [wallet, stellar, address]);
  const send = async () => {
    setState({ busy: true });
    try {
      const r = await api.faucet(address.trim());
      setState({ ok: `${usd(r.amount)} test USDC is on its way to ${address.slice(0, 4)}…${address.slice(-4)}.` });
    } catch (err) {
      setState({ error: explain(err instanceof Error ? err.message : String(err)) });
    }
  };
  return (
    <section className="band free" id="free">
      <div className="container two-col center">
        <Reveal className="free-art">
          <div className="pack">
            <span className="burst mono">Free</span>
            <div className="pack-face">
              <span className="mono">Testnet</span>
              <strong>10 test USDC</strong>
              <span className="mono">Circle USDC · Stellar</span>
            </div>
            <span className="pack-spine" />
          </div>
        </Reveal>
        <div>
          <Reveal>
            <Eyebrow>Free on testnet</Eyebrow>
          </Reveal>
          <Headline lines={["Ten test dollars,", "on the house."]} />
          <Reveal delay={200}>
            <p className="lead">
              Paperstall runs on Stellar testnet. Paste a wallet made here, or a Stellar address that holds USDC, and
              the faucet sends 10 test USDC to try the shop.
            </p>
          </Reveal>
          <Reveal delay={300}>
            <form
              className="free-form"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                aria-label="Your Stellar address"
                placeholder="C… or G… address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                spellCheck={false}
              />
              <TagButton type="submit" variant="dark" icon={<BadgeDollarSign size={16} />} disabled={state.busy || !address.trim()}>
                {state.busy ? "Sending…" : "Send me 10 USDC"}
              </TagButton>
            </form>
            {state.ok && <p className="free-note ok">{state.ok}</p>}
            {state.error && <p className="free-note bad">{state.error}</p>}
            {!state.ok && !state.error && (
              <p className="free-note mono">
                No wallet yet? <Link href="/c/demo">Make one with a fingerprint</Link> on any product.
              </p>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 11. questions: tag-shaped answers ---------------- */

function Faq({ feeBps, maxFileMb }: { feeBps: number; maxFileMb: number }) {
  const [open, setOpen] = useState(0);
  const qa = [
    {
      q: "How do I get the file after paying?",
      a: "At once. The product page swaps the buy button for a download and gives you a private link that works on any device. Your library keeps every purchase.",
    },
    {
      q: "Do I need XLM or a crypto wallet?",
      a: "No. A fingerprint or face makes a passkey wallet, and the store pays every network fee. If you already use Freighter, LOBSTR, xBull or Albedo, pay from that.",
    },
    {
      q: "Is this real money?",
      a: "Not yet. Paperstall runs on Stellar testnet with Circle's test USDC, so every price is play money until the store moves to mainnet.",
    },
    {
      q: "What does Paperstall take?",
      a: `A ${feeBps / 100}% platform fee, fixed in the contract when a product is listed. Network fees cost buyers and creators nothing.`,
    },
    {
      q: "How do creators cash out?",
      a: "Keep dollars in the wallet, send them to any Stellar address, or withdraw through a Stellar anchor (SEP-24). On testnet that is the SDF test anchor, so payouts are simulated.",
    },
    {
      q: "Can I split sales with collaborators?",
      a: "Yes. Add up to five co-creators with fixed shares when you list. The contract pays them in the same transaction as the sale.",
    },
    {
      q: "Which files can I sell?",
      a: `Any file up to ${maxFileMb} MB: templates, ebooks, courses, beat packs and design assets, with an optional cover image.`,
    },
  ];
  return (
    <section className="band cream faq">
      <div className="container faq-grid">
        <div>
          <Reveal>
            <Eyebrow>FAQ</Eyebrow>
          </Reveal>
          <Headline lines={["Questions,", "answered."]} />
          <Reveal delay={200}>
            <p className="lead">Wallets, fees, files and cashing out: the short answers.</p>
          </Reveal>
          <Reveal delay={300} className="ask-card">
            <strong>Something else?</strong>
            <p>Open an issue on GitHub and we'll answer there.</p>
            <TagAnchor href={`${REPO}/issues`} target="_blank" rel="noreferrer" icon={<Code size={16} />}>
              Ask on GitHub
            </TagAnchor>
            <span className="mono">github.com/big14way/stellar-creator-store</span>
          </Reveal>
        </div>
        <div className="qa">
          {qa.map((item, i) => (
            <div key={item.q} className={`qa-item ${i === 0 ? "wide" : ""} ${open === i ? "is-open" : ""}`}>
              <button className="qa-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                <span className="mono qa-n">Q-0{i + 1}</span>
                <span className="qa-text">{item.q}</span>
                <span className="qa-pm">{open === i ? <X size={14} /> : <Plus size={14} />}</span>
              </button>
              {open === i && <p className="qa-a">{item.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- 12. notes: three write-ups from the README ---------------- */

const NOTES = [
  {
    tag: "How it works",
    title: "How a sale settles on Stellar",
    text: "The contract call, the fee-bump and the receipt that unlocks a download.",
    href: `${REPO}#how-it-uses-stellar`,
    photo: "photo-receipt",
  },
  {
    tag: "Wallets",
    title: "Why buyers never need XLM",
    text: "Passkey wallets, the fee sponsor and the rules it signs under.",
    href: `${REPO}#trust-and-security`,
    photo: "photo-phone",
  },
  {
    tag: "Cash out",
    title: "Naira and cedis: what works today",
    text: "Anchors, SEP-24 and what is still simulated on testnet.",
    href: `${REPO}#cash-out-honestly`,
    photo: "photo-cash",
  },
];

function Notes() {
  return (
    <section className="band cream notes">
      <div className="container">
        <div className="section-head">
          <div>
            <Reveal>
              <Eyebrow>Notes</Eyebrow>
            </Reveal>
            <Headline lines={["Notes from", "the build."]} />
          </div>
          <Reveal delay={200} className="head-side">
            <p className="lead">How Paperstall uses Stellar, written up in the project's README.</p>
            <a className="text-link" href={REPO} target="_blank" rel="noreferrer">
              The README <ArrowRight size={14} />
            </a>
          </Reveal>
        </div>
        <div className="grid">
          {NOTES.map((n, i) => (
            <Reveal key={n.title} delay={i * 90}>
              <a className="note" href={n.href} target="_blank" rel="noreferrer">
                <div className={`note-art ${n.photo}`}>
                  <span className="mono accent-ink">{n.tag}</span>
                  <strong>{n.title}</strong>
                </div>
                <div className="note-meta mono">
                  <span>README</span>
                  <span className="rule" />
                  <span>GitHub</span>
                </div>
                <p>{n.text}</p>
                <span className="text-link">
                  Read the note <ArrowRight size={14} />
                </span>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- 13. closing call ---------------- */

function Cta() {
  return (
    <section className="band dark lined cta">
      <div className="container center-head">
        <Reveal>
          <Eyebrow>Open on testnet</Eyebrow>
        </Reveal>
        <Headline lines={["Open your", "own stall."]} className="display" />
        <Reveal delay={250}>
          <p className="lead">List a file in two minutes with a fingerprint, or buy from the demo shop with test dollars.</p>
        </Reveal>
        <Reveal delay={350} className="actions">
          <TagLink href="/sell" icon={<Fingerprint size={16} />}>
            Start selling
          </TagLink>
          <TagLink href="/shop" icon={<ShoppingBag size={16} />} variant="dark">
            Browse the shelf
          </TagLink>
        </Reveal>
        <Reveal delay={450}>
          <p className="mono cta-line">USDC on Stellar · No XLM needed · One transaction per sale</p>
        </Reveal>
      </div>
    </section>
  );
}
