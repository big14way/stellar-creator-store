// Uploaded files on disk, named by their SHA-256.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

export function openFiles(dataDir: string) {
  const dir = join(dataDir, "files");
  mkdirSync(dir, { recursive: true });
  const path = (key: string) => {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("bad file key");
    return join(dir, key);
  };

  return {
    save(bytes: Uint8Array): string {
      const key = createHash("sha256").update(bytes).digest("hex");
      const p = path(key);
      if (!existsSync(p)) writeFileSync(p, bytes);
      return key;
    },
    size: (key: string) => statSync(path(key)).size,
    /** A web stream of the file, for a Response body. */
    stream: (key: string) => Readable.toWeb(createReadStream(path(key))) as ReadableStream<Uint8Array>,
  };
}

export type Files = ReturnType<typeof openFiles>;
