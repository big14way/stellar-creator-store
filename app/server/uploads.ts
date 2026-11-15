// What we accept and how we serve files people upload.

/** Cover images we show: raster formats only. An SVG can carry script. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** The image type from its first bytes (not the browser's claim), or null if it isn't one we show. */
export function imageType(b: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Headers for files people uploaded: never sniffed into another type, never run as a page on our origin. */
export const UNTRUSTED = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};
