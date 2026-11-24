// Receipt stamps on downloads: PDFs get a line on every page and the receipt
// in their properties, ZIPs get a receipt file, anything else is untouched.

import assert from "node:assert/strict";
import { test } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { RECEIPT_FILE, stampFile, type Stamp } from "../server/stamp";

const STAMP: Stamp = {
  productId: 42,
  product: "Invoice template",
  buyer: "CAC7NLYEITU3HWTGCW7NBMLUGQWDLUV7PEC573GNEAERFDLMH5TMCQTS",
  tx: "959fd03143bf04394d12f93965dee2302965ccb239ff83ab4c6fdb60c9f2a7d1",
  at: Date.UTC(2026, 10, 24, 9, 0),
  site: "paperstall.example",
  explorer: "https://stellar.expert/explorer/testnet/tx/959fd031",
};

test("a PDF keeps its pages and carries the buyer's receipt", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([842, 595]);
  doc.setTitle("Invoice template");
  const original = await doc.save();

  const stamped = await stampFile(original, STAMP);
  assert.ok(stamped, "stamped");
  const back = await PDFDocument.load(stamped!);
  assert.equal(back.getPageCount(), 2);
  assert.equal(back.getTitle(), "Invoice template");
  assert.match(back.getSubject() ?? "", new RegExp(STAMP.buyer));
  assert.match(back.getSubject() ?? "", new RegExp(STAMP.tx!));
  assert.ok((back.getKeywords() ?? "").includes("paperstall-receipt"));
});

test("two buyers get different copies of the same PDF", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const original = await doc.save();
  const a = await stampFile(original, STAMP);
  const b = await stampFile(original, { ...STAMP, buyer: "GDNG6XNTEOPZ5TRC6FUSNHPIIT236RGA6SDPYZFWONOB4OIYZK2CE33O" });
  assert.notDeepEqual(a, b);
});

test("a ZIP keeps every file and gains a receipt", async () => {
  const files = { "tiles/one.svg": strToU8("<svg/>"), "README.txt": strToU8("hello") };
  const stamped = await stampFile(zipSync(files), STAMP);
  assert.ok(stamped, "stamped");
  const back = unzipSync(stamped!);
  assert.equal(strFromU8(back["tiles/one.svg"]), "<svg/>");
  assert.equal(strFromU8(back["README.txt"]), "hello");
  const receipt = strFromU8(back[RECEIPT_FILE]);
  assert.match(receipt, new RegExp(STAMP.buyer));
  assert.match(receipt, new RegExp(STAMP.tx!));
  assert.match(receipt, /Invoice template \(#42\)/);
});

test("other files, and files that can't be opened, are served as uploaded", async () => {
  assert.equal(await stampFile(strToU8("just some text"), STAMP), null);
  assert.equal(await stampFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), STAMP), null); // PNG
  assert.equal(await stampFile(strToU8("%PDF-1.7 not really a pdf"), STAMP), null);
  assert.equal(await stampFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]), STAMP), null); // broken zip
});
