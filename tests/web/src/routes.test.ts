import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { FakeBucket, migratedDb } from "./support/fakes";

// The three routes the Worker answers beside the page: an image from R2,
// /api/health, and POST /api/index.
const bucket = new FakeBucket();
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: { IMAGES: bucket } }),
}));
let dbFor: () => Promise<unknown>;
vi.mock("@/lib/db", () => ({ withDb: async (fn: (db: unknown) => unknown) => fn(await dbFor()) }));
const indexImages = vi.fn();
vi.mock("@/lib/ai/index-images", () => ({ indexImages: (...args: unknown[]) => indexImages(...args) }));

const params = (key: string[]) => ({ params: Promise.resolve({ key }) });

describe("GET /images/<name> (app/images/[...key]/route.ts)", () => {
  beforeEach(async () => {
    bucket.objects.clear();
    await bucket.put("images/pizza.jpg", new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await bucket.put("secrets.json", new TextEncoder().encode("{}"));
  });

  it("serves the object from R2 with its type, its version and a cache lifetime", async () => {
    const { GET } = await import("@/app/images/[...key]/route");
    const res = await GET(new Request("https://x.test/images/pizza.jpg"), params(["pizza.jpg"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("etag")).toBe(`"${bucket.objects.get("images/pizza.jpg")!.etag}"`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
  });

  it("answers 304 to a request that already has this version", async () => {
    const { GET } = await import("@/app/images/[...key]/route");
    const etag = `"${bucket.objects.get("images/pizza.jpg")!.etag}"`;
    const res = await GET(
      new Request("https://x.test/images/pizza.jpg", { headers: { "if-none-match": etag } }),
      params(["pizza.jpg"]),
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("serves nothing but images under images/: 404 for the missing, the outside and the not-an-image", async () => {
    const { GET } = await import("@/app/images/[...key]/route");
    for (const key of [["missing.jpg"], ["..", "secrets.json"], ["secrets.json"], ["pizza.jpg", ""], []]) {
      const res = await GET(new Request("https://x.test/images/x"), params(key));
      expect(res.status, key.join("/")).toBe(404);
    }
  });
});

describe("GET /api/health (app/api/health/route.ts)", () => {
  it("is ok with the schema migrated, saying how many images are indexed", async () => {
    const pg = await migratedDb();
    dbFor = async () => pg.db;
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, database: "reachable", schema: "migrated", images: 0 });
  }, 60_000);

  it("is 503 and says so before db-migrate has run, and when the database is unreachable", async () => {
    const bare = new PGlite();
    dbFor = async () => drizzle(bare);
    const { GET } = await import("@/app/api/health/route");
    let res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, database: "reachable", schema: "missing", images: 0 });
    dbFor = async () => {
      throw new Error("no route to host");
    };
    res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, database: "unreachable" });
  }, 60_000);
});

describe("POST /api/index (app/api/index/route.ts)", () => {
  beforeEach(() => indexImages.mockReset());

  it("runs the pass for this origin and answers its result, 500 when an image failed", async () => {
    const { POST } = await import("@/app/api/index/route");
    indexImages.mockResolvedValueOnce({ ok: true, remaining: 0 });
    let res = await POST(new Request("https://acme.test/api/index", { method: "POST" }));
    expect(indexImages).toHaveBeenCalledWith("https://acme.test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, remaining: 0 });
    indexImages.mockResolvedValueOnce({ ok: false, remaining: 0, failures: [{ path: "/images/x.jpg", error: "e" }] });
    res = await POST(new Request("https://acme.test/api/index", { method: "POST" }));
    expect(res.status).toBe(500);
    indexImages.mockRejectedValueOnce(new Error("database unreachable"));
    res = await POST(new Request("https://acme.test/api/index", { method: "POST" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "database unreachable" });
  });
});
