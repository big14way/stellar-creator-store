// Cover images are checked by their bytes, so an SVG (which can carry script) never gets in.

import assert from "node:assert/strict";
import { test } from "node:test";
import { imageType } from "../server/uploads";

const bytes = (...b: number[]) => new Uint8Array(b);

test("recognises the raster formats we show", () => {
  assert.equal(imageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), "image/png");
  assert.equal(imageType(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(imageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), "image/gif");
  assert.equal(imageType(new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")])), "image/webp");
});

test("refuses SVG, HTML and anything else, whatever the browser called it", () => {
  assert.equal(imageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(imageType(new TextEncoder().encode("<!doctype html><script>alert(1)</script>")), null);
  assert.equal(imageType(new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE")])), null);
  assert.equal(imageType(bytes()), null);
});
