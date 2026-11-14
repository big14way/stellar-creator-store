export type CreatorRef = { name: string; handle: string | null } | null;

export type Product = {
  id: number;
  title: string;
  description: string;
  creator: string;
  creatorProfile: CreatorRef;
  price: string; // USDC smallest units
  feeBps: number;
  shares: { to: string; bps: number }[];
  affiliateBps: number;
  active: boolean;
  sales: number;
  file: { name: string; size: number; type: string };
  cover: string | null;
  listedAt: number;
};

export type Access = { buyer: string | null; download: string | null; txHash: string | null };

export type Sale = { productId: number; title: string; price: string | null; buyer: string; txHash: string; at: number };

export type LibraryItem = {
  productId: number;
  title: string;
  file: { name: string; size: number };
  cover: string | null;
  buyer: string;
  paid: string | null;
  txHash: string;
  at: number;
  download: string;
};

export type Profile = { name: string; bio: string; handle: string | null };

export type Shop = { wallet: string; profile: Profile | null; products: Product[] };

export type Rates = { NGN: number; GHS: number; updated: string; source: string };

export type Config = { network: string; maxFileMb: number; faucet: boolean; sponsor: string; store: string };

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as T;
}

const send = (method: string, url: string, body: unknown) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let ratesCache: Promise<Rates | null> | null = null;
let configCache: Promise<Config> | null = null;

export const api = {
  config: () => (configCache ??= fetch("/api/config").then((r) => json<Config>(r))),
  products: (creator?: string) =>
    fetch(creator ? `/api/products?creator=${encodeURIComponent(creator)}` : "/api/products").then((r) => json<Product[]>(r)),
  sales: (creator?: string) =>
    fetch(creator ? `/api/sales?creator=${encodeURIComponent(creator)}` : "/api/sales").then((r) => json<Sale[]>(r)),
  product: (id: string | number) => fetch(`/api/products/${id}`).then((r) => json<Product>(r)),
  updateProduct: (id: number, title: string, description: string) =>
    send("PATCH", `/api/products/${id}`, { title, description }).then((r) => json<{ ok: true }>(r)),
  /** The download link if a wallet proven in this browser owns the product. */
  access: (id: string | number) => fetch(`/api/products/${id}/access`).then((r) => json<Access>(r)),
  library: () => fetch("/api/library").then((r) => json<{ wallets: string[]; items: LibraryItem[] }>(r)),
  shop: (id: string) => fetch(`/api/creators/${encodeURIComponent(id)}`).then((r) => json<Shop>(r)),
  saveProfile: (wallet: string, p: Profile) => send("PUT", "/api/profile", { wallet, ...p }).then((r) => json<Profile>(r)),
  draft: (form: FormData) => fetch("/api/drafts", { method: "POST", body: form }).then((r) => json<{ draftId: string }>(r)),
  publish: (draftId: string, productId: number) =>
    send("POST", `/api/drafts/${draftId}/publish`, { productId }).then((r) => json<Product>(r)),
  faucet: (wallet: string) => send("POST", "/api/faucet", { wallet }).then((r) => json<{ amount: string }>(r)),
  rates: () =>
    (ratesCache ??= fetch("/api/rates")
      .then((r) => (r.ok ? (r.json() as Promise<Rates>) : null))
      .catch(() => null)),
};

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Where a creator's shop lives: their handle if they chose one. */
export const shopPath = (wallet: string, ref?: CreatorRef) => `/c/${ref?.handle ?? wallet}`;
