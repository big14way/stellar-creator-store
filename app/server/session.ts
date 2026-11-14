// Which wallets this browser has proven it controls, and download links.
//
// A wallet is "proven" when this browser submitted, through our server, a
// transaction that the wallet signed with its passkey and that succeeded on
// chain. Only the browser holding the passkey had that signed payload.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";

const COOKIE = "cs_wallets";
const MAX_WALLETS = 10;

export function sessions(secret: string, secureCookies: boolean) {
  async function proven(c: Context): Promise<string[]> {
    const value = await getSignedCookie(c, secret, COOKIE);
    return value ? value.split(",").filter((w) => /^C[A-Z2-7]{55}$/.test(w)) : [];
  }

  async function prove(c: Context, wallets: string[]) {
    if (wallets.length === 0) return;
    const merged = [...new Set([...wallets, ...(await proven(c))])].slice(0, MAX_WALLETS);
    await setSignedCookie(c, COOKIE, merged.join(","), secret, {
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookies,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
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

  return { proven, prove, downloadToken, readDownloadToken };
}
