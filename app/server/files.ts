// Uploaded files, named by their SHA-256. On disk locally; in the database
// when hosted, where the disk does not survive a restart.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { Sql } from "./sql";

export type Files = {
  save(bytes: Uint8Array): Promise<string>;
  /** The file as a Response body. */
  body(key: string): Promise<ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer> | null>;
};

const keyOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const checked = (key: string) => {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("bad file key");
  return key;
};

export function diskFiles(dataDir: string): Files {
  const dir = join(dataDir, "files");
  mkdirSync(dir, { recursive: true });
  const path = (key: string) => join(dir, checked(key));
  return {
    async save(bytes) {
      const key = keyOf(bytes);
      if (!existsSync(path(key))) writeFileSync(path(key), bytes);
      return key;
    },
    async body(key) {
      const p = path(key);
      return existsSync(p) ? (Readable.toWeb(createReadStream(p)) as ReadableStream<Uint8Array>) : null;
    },
  };
}

export function sqlFiles(sql: Sql): Files {
  return {
    async save(bytes) {
      const key = keyOf(bytes);
      await sql.run("insert into blobs (key, bytes, size) values (?, ?, ?) on conflict (key) do nothing", [
        key,
        sql.dialect === "postgres" ? Buffer.from(bytes) : bytes,
        bytes.length,
      ]);
      return key;
    },
    async body(key) {
      const row = await sql.get<{ bytes: Uint8Array }>("select bytes from blobs where key = ?", [checked(key)]);
      return row ? new Uint8Array(row.bytes) : null;
    },
  };
}
