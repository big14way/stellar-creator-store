// Which wallets this browser has proven it controls, and download links.
//
// A wallet is "proven" when this browser either
// - submitted, through our server, a transaction the wallet signed (with its
//   passkey, or with a Stellar wallet's key) that succeeded on chain, or
// - signed one of our one-time sign-in challenges with it (see auth.ts).

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";

const COOKIE = "cs_wallets";
const MAX_WALLETS = 10;

export function sessions(secret: string, secureCookies: boolean) {
  async function proven(c: Context): Promise<string[]> {
    const value = await getSignedCookie(c, secret, COOKIE);
    return value ? value.split(",").filter((w) => /^[CG][A-Z2-7]{55}$/.test(w)) : [];
  }

  /** Adds wallets to this browser's proven set. The newest comes first. */
  async function prove(c: Context, wallets: string[]): Promise<string[]> {
    if (wallets.length === 0) return proven(c);
    const merged = [...new Set([...wallets, ...(await proven(c))])].slice(0, MAX_WALLETS);
    await setSignedCookie(c, COOKIE, merged.join(","), secret, {
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookies,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return merged;
  }

  const mac = (productId: number, buyer: string) =>
    createHmac("sha256", secret).update(`download:${productId}:${buyer}`).digest("base64url").slice(0, 32);

  /** A private link to a purchased file. Like Gumroad's or Selar's, anyone holding it can download. */
  function downloadToken(productId: number, buyer: string): string {
    return `${productId}.${buyer}.${mac(productId, buyer)}`;
  }

  function readDownloadToken(token: string): { productId: number; buyer: string } | null {
    const [id, buyer, sig] = token.split(".");
    const productId = Number(id);
    if (!Number.isSafeInteger(productId) || !buyer || !sig) return null;
    const want = Buffer.from(mac(productId, buyer));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    return { productId, buyer };
  }

  /** Forgets every wallet this browser proved. */
  function forget(c: Context) {
    deleteCookie(c, COOKIE, { path: "/", secure: secureCookies });
  }

  return { proven, prove, forget, downloadToken, readDownloadToken };
}
