import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { runIndex, type IndexDeps } from "@/lib/ai/index-images";
import { SAMPLE_IMAGES } from "@/lib/samples";
import { VISION_MODEL } from "@/lib/ai/models";
import { assetsFromPublic, FakeBucket, migratedDb, publicDir, wordVector } from "./support/fakes";

// lib/ai/index-images.ts — upstream's upload, describe and embed scripts as
// one idempotent pass — over the real schema (PGlite, every migration), an
// R2 bucket in memory and the Worker's real sample images.
type Pg = Awaited<ReturnType<typeof migratedDb>>;

let pg: Pg;
let bucket: FakeBucket;
let described: number;
let generations: number;
let failDescribe: (bytes: ArrayBuffer) => boolean;

function deps(over: Partial<IndexDeps> = {}): IndexDeps {
  return {
    bucket: bucket as unknown as R2Bucket,
    assets: assetsFromPublic as unknown as Fetcher,
    origin: "https://images.example.test",
    db: async (fn) => fn(pg.db),
    describe: async (bytes) => {
      described++;
      if (failDescribe(bytes)) throw new Error("the model is down");
      const n = bytes.byteLength;
      return { title: `Picture ${n}`, description: `An illustration of ${n} bytes.` };
    },
    embed: async (text) => wordVector(text),
    nextGeneration: async () => {
      generations++;
    },
    batch: 4,
    ...over,
  };
}

async function untilDone(d = deps()) {
  const passes = [];
  for (let i = 0; i < 10; i++) {
    const r = await runIndex(d);
    passes.push(r);
    if (r.remaining === 0) break;
  }
  return passes;
}

const rows = async () =>
  (
    await pg.pg.query<{ path: string; model: string; dims: number }>(
      "select path, model, vector_dims(embedding) as dims from images order by path",
    )
  ).rows;

describe("the indexer (lib/ai/index-images.ts)", () => {
  beforeEach(async () => {
    pg = await migratedDb();
    bucket = new FakeBucket();
    described = 0;
    generations = 0;
    failDescribe = () => false;
  }, 60_000);

  it("seeds the samples into the bucket and indexes them, at most a batch per pass", async () => {
    const passes = await untilDone();
    expect(passes.map((p) => [p.seeded, p.indexed, p.remaining])).toEqual([
      [12, 4, 8],
      [0, 4, 4],
      [0, 4, 0],
    ]);
    expect(passes.every((p) => p.ok)).toBe(true);
    expect([...bucket.objects.keys()].sort()).toEqual(SAMPLE_IMAGES.map((n) => `images/${n}`).sort());
    // The bucket holds the very bytes the Worker ships.
    const pizza = bucket.objects.get("images/pizza.jpg")!;
    expect(Buffer.from(pizza.bytes).equals(readFileSync(path.join(publicDir, "samples/pizza.jpg")))).toBe(true);
    expect(pizza.contentType).toBe("image/jpeg");
    const indexed = await rows();
    expect(indexed.map((r) => r.path)).toEqual(SAMPLE_IMAGES.map((n) => `/images/${n}`).sort());
    expect(indexed.every((r) => r.model === VISION_MODEL && r.dims === 768)).toBe(true);
    expect(described).toBe(12);
    expect(generations).toBe(3);
    expect(passes.at(-1)!.images).toBe(12);
  }, 60_000);

  it("does nothing the second time: no model call, no new generation", async () => {
    await untilDone();
    described = 0;
    generations = 0;
    const again = await runIndex(deps());
    expect(again).toMatchObject({ ok: true, seeded: 0, indexed: 0, unchanged: 12, removed: 0, remaining: 0, images: 12 });
    expect(described).toBe(0);
    expect(generations).toBe(0);
  }, 60_000);

  it("re-describes an image only when its bytes change, not when it is merely re-uploaded", async () => {
    await untilDone();
    described = 0;
    const same = bucket.objects.get("images/coffee.jpg")!.bytes;
    await bucket.put("images/coffee.jpg", same, { httpMetadata: { contentType: "image/jpeg" } });
    expect(await runIndex(deps())).toMatchObject({ indexed: 0, unchanged: 12 });
    expect(described).toBe(0);
    const other = readFileSync(path.join(publicDir, "samples/forest.jpg"));
    await bucket.put("images/coffee.jpg", other, { httpMetadata: { contentType: "image/jpeg" } });
    expect(await runIndex(deps())).toMatchObject({ indexed: 1, images: 12 });
    expect(described).toBe(1);
  }, 60_000);

  it("indexes the owner's own images, ignores what is not an image, and removes what is gone", async () => {
    await untilDone();
    generations = 0;
    await bucket.put("images/mine.png", readFileSync(path.join(publicDir, "samples/sailboat.jpg")), {
      httpMetadata: { contentType: "image/png" },
    });
    await bucket.put("images/notes.txt", new TextEncoder().encode("not an image"));
    await bucket.put("elsewhere/other.jpg", readFileSync(path.join(publicDir, "samples/pizza.jpg")));
    expect(await runIndex(deps())).toMatchObject({ indexed: 1, images: 13 });
    await bucket.delete("images/bicycle.jpg");
    // A sample the bucket lost is seeded again on the next pass — so remove
    // one of the owner's to see a removal.
    await bucket.delete("images/mine.png");
    const pass = await runIndex(deps());
    expect(pass).toMatchObject({ seeded: 1, removed: 1 });
    expect((await rows()).map((r) => r.path)).not.toContain("/images/mine.png");
    expect(generations).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("reports an image the model failed on, asks once more before giving up, and leaves it for the next pass", async () => {
    failDescribe = (bytes) => bytes.byteLength === readFileSync(path.join(publicDir, "samples/pizza.jpg")).length;
    const d = deps({ batch: 12 });
    const first = await runIndex(d);
    expect(first.ok).toBe(false);
    expect(first.failures).toEqual([{ path: "/images/pizza.jpg", error: "the model is down" }]);
    expect(first.indexed).toBe(11);
    expect(described).toBe(13); // eleven, and pizza twice
    failDescribe = () => false;
    const second = await runIndex(d);
    expect(second).toMatchObject({ ok: true, indexed: 1, images: 12 });
  }, 60_000);

  it("refuses to seed a sample the Worker's assets do not carry", async () => {
    const none = { fetch: async () => new Response("Not found", { status: 404 }) };
    await expect(runIndex(deps({ assets: none as unknown as Fetcher }))).rejects.toThrow(/not in the Worker's assets \(404\)/);
  });

  it("is what POST /api/index runs, on the Worker's own bindings", () => {
    const route = readFileSync(path.resolve(publicDir, "../app/api/index/route.ts"), "utf8");
    expect(route).toMatch(/export async function POST/);
    expect(route).toMatch(/indexImages\(new URL\(request\.url\)\.origin\)/);
    expect(route).not.toMatch(/export async function GET/);
  });
});

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));
