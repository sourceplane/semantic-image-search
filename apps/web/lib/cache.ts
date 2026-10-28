import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { DBImage } from "./db/schema";

// Upstream's query cache (Vercel KV), on Workers KV (the CACHE binding).
// Upstream kept every answer forever, so an image indexed after a query was
// cached never showed for it. Here every key is prefixed with the index's
// GENERATION, which the indexer moves on whenever it adds, replaces or removes
// an image (lib/ai/index-images.ts): the next search reads a fresh key, and
// the stale ones expire on their own. KV is eventually consistent, so a new
// generation can take up to a minute to reach every location.
export const GENERATION_KEY = "index:generation";
export const CACHE_TTL_SECONDS = 60 * 60 * 24;

async function kv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  return env.CACHE;
}

/** Upstream's key — `q:<query>` (spaces as `_`), or `all_images` — under the generation. */
export async function cacheKey(query?: string): Promise<string> {
  const generation = (await (await kv()).get(GENERATION_KEY)) ?? "0";
  const q = query && query.length >= 3 ? "q:" + query.replaceAll(" ", "_") : "all_images";
  return `${generation}:${q}`;
}

export async function readCache(key: string): Promise<DBImage[] | null> {
  return (await (await kv()).get(key, "json")) as DBImage[] | null;
}

export async function writeCache(key: string, images: DBImage[]): Promise<void> {
  await (await kv()).put(key, JSON.stringify(images), { expirationTtl: CACHE_TTL_SECONDS });
}

export async function nextGeneration(): Promise<void> {
  await (await kv()).put(GENERATION_KEY, Date.now().toString(36));
}
