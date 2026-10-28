import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { manifest } from "@saas/db/manifest";
import type { Db } from "@/lib/db";

// What the app's bindings and database are, in a test: the real schema on a
// real Postgres in process (PGlite with pgvector, every packages/db
// migration), an R2 bucket and a KV namespace in memory, and the Worker's
// static assets read from apps/web/public.
const migrationsDir = path.resolve(__dirname, "../../../../packages/db/src/migrations");
export const publicDir = path.resolve(__dirname, "../../../../apps/web/public");

export async function migratedDb(): Promise<{ pg: PGlite; db: Db }> {
  const pg = new PGlite({ extensions: { vector } });
  for (const entry of manifest.migrations) {
    await pg.exec(readFileSync(path.join(migrationsDir, entry.path), "utf8"));
  }
  // drizzle's PGlite session speaks the same query builder the app uses on
  // postgres-js; the app's `Db` type is the postgres-js one.
  return { pg, db: drizzle(pg) as unknown as Db };
}

type Stored = { bytes: ArrayBuffer; etag: string; contentType?: string };

export class FakeBucket {
  objects = new Map<string, Stored>();
  private version = 0;
  // A small page, so the indexer's listing must follow the cursor.
  constructor(private pageSize = 5) {}

  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, etag: o.etag } : null;
  }
  async put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
    const bytes = value instanceof Uint8Array ? value.slice().buffer : value;
    this.objects.set(key, { bytes, etag: `etag-${++this.version}`, contentType: options?.httpMetadata?.contentType });
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async list({ prefix = "", cursor }: { prefix?: string; cursor?: string }) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = keys.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return {
      objects: page.map((key) => ({ key, etag: this.objects.get(key)!.etag })),
      truncated: next < keys.length,
      cursor: next < keys.length ? String(next) : undefined,
    };
  }
  async get(key: string, options?: { onlyIf?: Headers }) {
    const o = this.objects.get(key);
    if (!o) return null;
    const httpEtag = `"${o.etag}"`;
    const meta = {
      key,
      etag: o.etag,
      httpEtag,
      httpMetadata: { contentType: o.contentType },
      writeHttpMetadata(headers: Headers) {
        if (o.contentType) headers.set("content-type", o.contentType);
      },
    };
    if (options?.onlyIf?.get("if-none-match") === httpEtag) return meta; // no body
    return { ...meta, body: new Blob([o.bytes]).stream(), arrayBuffer: async () => o.bytes };
  }
}

export const assetsFromPublic = {
  fetch: async (url: URL | string) => {
    const pathname = new URL(String(url)).pathname;
    try {
      const bytes = readFileSync(path.join(publicDir, pathname));
      return new Response(bytes, { headers: { "content-type": "image/jpeg" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};

export class FakeKv {
  store = new Map<string, string>();
  puts: { key: string; ttl?: number }[] = [];
  async get(key: string, type?: "json") {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.store.set(key, value);
    this.puts.push({ key, ttl: options?.expirationTtl });
  }
}

// A deterministic embedding: each word hashed into one of 768 dimensions,
// normalized — so texts that share words are near, and texts that share none
// are orthogonal.
export function wordVector(text: string): number[] {
  const v = new Array<number>(768).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 2166136261;
    for (const c of word) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    v[h % 768] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
