// Each buyer's copy carries their receipt. A PDF gets a line at the foot of
// every page and the receipt in its document properties; a ZIP archive gets a
// receipt file. A copy that leaks traces back to the purchase it came from.
// Any other file, or one these can't open (encrypted, damaged), is served
// exactly as the creator uploaded it.

import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export type Stamp = {
  productId: number;
  product: string;
  buyer: string;
  /** The purchase transaction, if the store recorded it. */
  tx: string | null;
  /** When it was bought (ms), if known. */
  at: number | null;
  /** The store's address, e.g. paperstallhq.vercel.app. */
  site: string;
  /** A link to the transaction on an explorer. */
  explorer: string | null;
};

export const RECEIPT_FILE = "PAPERSTALL-RECEIPT.txt";
/** Larger files are served as uploaded rather than opened in memory. */
const MAX_STAMP_BYTES = 50 * 1024 * 1024;

const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04; // PK\3\4

const shortId = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The receipt as plain text. */
export function receiptText(s: Stamp): string {
  return [
    "Paperstall receipt",
    "",
    `Product:     ${s.product} (#${s.productId})`,
    `Licensed to: ${s.buyer}`,
    `Bought:      ${s.at ? new Date(s.at).toISOString() : "see the transaction"}`,
    `Transaction: ${s.tx ?? "recorded on chain by the store contract"}`,
    ...(s.explorer ? [`Verify:      ${s.explorer}`] : []),
    "",
    `This copy was sold to the wallet above through ${s.site}. The sale is recorded on the Stellar network.`,
    "Please don't share it: the creator was paid for this copy only.",
    "",
  ].join("\n");
}

/** The buyer's copy with their receipt in it, or null to serve the file as uploaded. */
export async function stampFile(bytes: Uint8Array, s: Stamp): Promise<Uint8Array | null> {
  if (bytes.length > MAX_STAMP_BYTES) return null;
  try {
    if (isPdf(bytes)) return await stampPdf(bytes, s);
    if (isZip(bytes)) return stampZip(bytes, s);
  } catch {
    // Encrypted or damaged: the buyer still gets the file.
  }
  return null;
}

async function stampPdf(bytes: Uint8Array, s: Stamp): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const line =
    `Licensed to ${shortId(s.buyer)}` +
    (s.tx ? ` · receipt ${s.tx.slice(0, 12)}` : "") +
    (s.at ? ` · ${day(s.at)}` : "") +
    ` · ${s.site}`;
  for (const page of doc.getPages()) {
    const box = page.getCropBox();
    const size = Math.max(5, Math.min(7, box.width / 90));
    const width = font.widthOfTextAtSize(line, size);
    page.drawText(line, {
      x: box.x + Math.max(8, (box.width - width) / 2),
      y: box.y + 8,
      size,
      font,
      color: rgb(0.45, 0.45, 0.45),
      opacity: 0.85,
    });
  }
  doc.setSubject(`Licensed to ${s.buyer}${s.tx ? `, transaction ${s.tx}` : ""}`);
  doc.setKeywords(["paperstall-receipt", s.buyer, ...(s.tx ? [s.tx] : []), `product-${s.productId}`]);
  return doc.save();
}

function stampZip(bytes: Uint8Array, s: Stamp): Uint8Array {
  const files = unzipSync(bytes) as Zippable;
  files[RECEIPT_FILE] = strToU8(receiptText(s));
  return zipSync(files, { level: 6 });
}
