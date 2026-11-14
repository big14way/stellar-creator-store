export type Product = {
  id: number;
  title: string;
  description: string;
  creator: string;
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

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as T;
}

export const api = {
  products: (creator?: string) =>
    fetch(creator ? `/api/products?creator=${encodeURIComponent(creator)}` : "/api/products").then((r) => json<Product[]>(r)),
  sales: () => fetch("/api/sales").then((r) => json<Sale[]>(r)),
  product: (id: string | number) => fetch(`/api/products/${id}`).then((r) => json<Product>(r)),
  /** The download link if a wallet proven in this browser owns the product. */
  access: (id: string | number) =>
    fetch(`/api/products/${id}/access`).then((r) => json<Access>(r)),
  draft: (form: FormData) => fetch("/api/drafts", { method: "POST", body: form }).then((r) => json<{ draftId: string }>(r)),
  publish: (draftId: string, productId: number) =>
    fetch(`/api/drafts/${draftId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    }).then((r) => json<Product>(r)),
  faucet: (wallet: string) =>
    fetch("/api/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet }),
    }).then((r) => json<{ amount: string }>(r)),
};

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
