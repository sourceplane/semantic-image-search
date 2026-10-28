import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeKv, migratedDb, wordVector } from "./support/fakes";

// lib/db/api.ts — upstream's search: a direct match on the title or
// description (ILIKE) and a semantic one (cosine similarity in pgvector),
// cached in KV — over the real schema in PGlite, Workers KV in memory and an
// embedding stood in by a deterministic word vector.
let pg: Awaited<ReturnType<typeof migratedDb>>;
const kv = new FakeKv();
let embedded: string[] = [];
const run = vi.fn(async (_model: string, inputs: { text: string[] }) => {
  embedded.push(inputs.text[0]!);
  return { data: [wordVector(inputs.text[0]!)] };
});
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: { CACHE: kv, AI: { run } } }),
}));
vi.mock("@/lib/db", () => ({ withDb: async (fn: (db: unknown) => unknown) => fn(pg.db) }));

const IMAGES = [
  ["/images/bicycle.jpg", "Crimson Ride", "A red bicycle leaning on a grey street wall."],
  ["/images/pizza.jpg", "Pepperoni Triangle", "A slice of pepperoni pizza, tasty food on a wooden board."],
  ["/images/pancakes.jpg", "Morning Stack", "A tall stack of pancakes with syrup, tasty food for breakfast."],
  ["/images/mountains.jpg", "Snow Peaks", "Snowy mountains under a clear blue sky."],
] as const;

async function seed() {
  for (const [path, title, description] of IMAGES) {
    await pg.pg.query(
      `insert into images (id, title, description, path, content_hash, etag, model, embedding)
       values ($1, $2, $3, $4, $5, 'e', '@cf/meta/llama-4-scout-17b-16e-instruct', $6)`,
      [path, title, description, path, `hash-of-${path}`, JSON.stringify(wordVector(title + "\n" + description))],
    );
  }
}

describe("the search (lib/db/api.ts, lib/cache.ts)", () => {
  beforeEach(async () => {
    vi.resetModules();
    pg = await migratedDb();
    await seed();
    kv.store.clear();
    kv.puts.length = 0;
    embedded = [];
    run.mockClear();
  }, 60_000);

  it("lists up to twenty images with no query, without their embeddings or hashes", async () => {
    const { getImages } = await import("@/lib/db/api");
    const { images, error } = await getImages();
    expect(error).toBeUndefined();
    expect(images.map((i) => i.path)).toEqual(IMAGES.map((i) => i[0]).sort());
    expect(images.every((i) => Array.isArray(i.embedding) && i.embedding.length === 0)).toBe(true);
    expect(Object.keys(images[0]!).sort()).toEqual(["description", "embedding", "id", "model", "path", "title"]);
    expect(embedded).toEqual([]);
  });

  it("ranks by meaning, keeps the direct matches first, and drops what is unrelated", async () => {
    const { getImages } = await import("@/lib/db/api");
    const { images } = await getImages("tasty food");
    // Both food images: each matches "tasty food" directly (ILIKE) and
    // semantically; once each, by title.
    expect(images.map((i) => i.path)).toEqual(["/images/pizza.jpg", "/images/pancakes.jpg"]);
    expect(images.every((i) => i.similarity === 1)).toBe(true);
    // Words the bicycle shares, but not a phrase it contains: only the
    // semantic match can find it.
    const semantic = await getImages("crimson red bicycle street");
    expect(semantic.images.map((i) => i.path)).toEqual(["/images/bicycle.jpg"]);
    expect(semantic.images[0]!.similarity).toBeGreaterThan(0.5);
    expect(semantic.images[0]!.similarity).toBeLessThan(1);
    expect(embedded).toEqual(["tasty food", "crimson red bicycle street"]);
  });

  it("answers a repeated query from KV, under the index's generation, for a day", async () => {
    const { getImages } = await import("@/lib/db/api");
    await getImages("snowy mountains");
    await getImages("snowy mountains");
    expect(embedded).toEqual(["snowy mountains"]);
    expect(kv.puts).toEqual([{ key: "0:q:snowy_mountains", ttl: 86_400 }]);
  });

  it("asks again once the indexer moves the generation on", async () => {
    const { getImages } = await import("@/lib/db/api");
    const { nextGeneration, GENERATION_KEY } = await import("@/lib/cache");
    await getImages("snowy mountains");
    await nextGeneration();
    expect(kv.store.get(GENERATION_KEY)).toBeTruthy();
    await getImages("snowy mountains");
    expect(embedded).toEqual(["snowy mountains", "snowy mountains"]);
  });

  it("answers an error, not a crash, when the database is unreachable", async () => {
    vi.doMock("@/lib/db", () => ({
      withDb: async () => {
        throw new Error("connection refused");
      },
    }));
    const { getImages } = await import("@/lib/db/api");
    const { images, error } = await getImages("anything");
    expect(images).toEqual([]);
    expect(error?.message).toBe("connection refused");
    vi.doUnmock("@/lib/db");
  });
});
