// One small SQL interface over SQLite (local, zero setup) and Postgres (hosted).
// Queries use `?` placeholders and SQL that both databases accept.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Dialect = "sqlite" | "postgres";

export interface Sql {
  dialect: Dialect;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Runs a statement and returns how many rows it changed. */
  run(sql: string, params?: unknown[]): Promise<number>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export function sqlite(dataDir: string): Sql {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "store.db"));
  db.exec("pragma journal_mode = wal");
  const cache = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  const stmt = (sql: string) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = db.prepare(sql)));
    return s;
  };
  const args = (params: unknown[]) => params as (string | number | bigint | null | Uint8Array)[];
  return {
    dialect: "sqlite",
    all: async <T>(sql: string, params: unknown[] = []) => stmt(sql).all(...args(params)) as T[],
    get: async <T>(sql: string, params: unknown[] = []) => stmt(sql).get(...args(params)) as T | undefined,
    run: async (sql, params = []) => Number(stmt(sql).run(...args(params)).changes),
    exec: async (sql) => db.exec(sql),
    close: async () => db.close(),
  };
}

export async function postgres(url: string): Promise<Sql> {
  const { default: pg } = await import("pg");
  // int8 columns (our millisecond timestamps) as numbers, not strings.
  pg.types.setTypeParser(20, (v: string) => Number(v));
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  const numbered = (sql: string) => {
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
  };
  return {
    dialect: "postgres",
    all: async <T>(sql: string, params: unknown[] = []) => (await pool.query(numbered(sql), params)).rows as T[],
    get: async <T>(sql: string, params: unknown[] = []) => (await pool.query(numbered(sql), params)).rows[0] as T | undefined,
    run: async (sql, params = []) => (await pool.query(numbered(sql), params)).rowCount ?? 0,
    exec: async (sql) => void (await pool.query(sql)),
    close: () => pool.end(),
  };
}

/** Postgres when DATABASE_URL is set, otherwise a SQLite file in the data folder. */
export function connect(dataDir: string): Promise<Sql> {
  const url = process.env.DATABASE_URL;
  return url ? postgres(url) : Promise.resolve(sqlite(dataDir));
}
