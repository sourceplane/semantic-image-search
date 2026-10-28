import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withDb, type Db } from "../db";
import { countImages, listIndexed, removeImages, touchEtag, upsertImage } from "../db/images";
import { nextGeneration } from "../cache";
import { SAMPLE_IMAGES } from "../samples";
import { IMAGE_PREFIX, imageType, pathOf } from "../storage";
import { VISION_MODEL, describeImage, embedText, type ImageMetadata } from "./models";

// Not upstream's as a file: upstream's three scripts, run by hand from a
// laptop — 0-upload.ts (images → Blob), 1-generate-metadata.ts (a vision
// model writes each image's title and description), 2-embed-and-save.ts (the
// description embedded and stored) — as one idempotent pass the Worker runs
// itself, through its own bindings: POST /api/index (app/api/index/route.ts),
// which every deploy's smoke step calls (apps/web/component.yaml). No
// credential leaves Cloudflare: R2, Workers AI and Hyperdrive are the
// Worker's bindings.
//
//   1. seed: each sample image (lib/samples.ts) not yet in the bucket is
//      copied into it from the Worker's static assets — upstream's upload;
//   2. every image object under images/ (yours too: `wrangler r2 object put
//      <bucket>/images/<name> --file <file> --remote`) whose R2 version the
//      index has not seen is read and hashed; same bytes as indexed → only
//      the version is recorded; new bytes → described by the vision model,
//      the description embedded, and the row upserted by path;
//   3. rows whose object is gone are removed;
//   4. anything indexed or removed moves the search cache's generation on.
//
// At most `batch` images are described per call, so one request stays short;
// `remaining` says how many still wait, and the caller asks again.

export const BATCH = 4;

export type IndexResult = {
  ok: boolean;
  seeded: number;
  indexed: number;
  unchanged: number;
  removed: number;
  remaining: number;
  images: number;
  failures: { path: string; error: string }[];
};

export type IndexDeps = {
  bucket: R2Bucket;
  assets: Fetcher;
  origin: string;
  db: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  describe: (bytes: ArrayBuffer, contentType: string) => Promise<ImageMetadata>;
  embed: (text: string) => Promise<number[]>;
  nextGeneration: () => Promise<void>;
  batch: number;
};

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One model call may fail transiently; it is asked once more before the image
// counts as a failure for this pass (the next pass tries it again).
async function twice<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fn();
  }
}

async function listObjects(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: IMAGE_PREFIX, cursor });
    objects.push(...page.objects.filter((o) => imageType(o.key)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function runIndex(deps: IndexDeps): Promise<IndexResult> {
  let seeded = 0;
  for (const name of SAMPLE_IMAGES) {
    const key = IMAGE_PREFIX + name;
    if (await deps.bucket.head(key)) continue;
    const res = await deps.assets.fetch(new URL(`/samples/${name}`, deps.origin));
    if (!res.ok) throw new Error(`the sample ${name} is not in the Worker's assets (${res.status})`);
    await deps.bucket.put(key, await res.arrayBuffer(), {
      httpMetadata: { contentType: imageType(name) ?? "application/octet-stream" },
    });
    seeded++;
  }

  const objects = await listObjects(deps.bucket);
  return deps.db(async (db) => {
    const indexed = new Map((await listIndexed(db)).map((row) => [row.path, row]));
    const present = new Set(objects.map((o) => pathOf(o.key)));
    const stale = [...indexed.keys()].filter((path) => !present.has(path));
    await removeImages(db, stale);

    const pending = objects.filter((o) => indexed.get(pathOf(o.key))?.etag !== o.etag);
    const failures: IndexResult["failures"] = [];
    let added = 0;
    let unchanged = objects.length - pending.length;
    for (const object of pending.slice(0, deps.batch)) {
      const path = pathOf(object.key);
      try {
        const body = await deps.bucket.get(object.key);
        if (!body) continue; // deleted since the listing
        const bytes = await body.arrayBuffer();
        const contentHash = await sha256(bytes);
        if (indexed.get(path)?.contentHash === contentHash) {
          // The same bytes under a new R2 version (re-uploaded): nothing to
          // describe again.
          await touchEtag(db, path, object.etag);
          unchanged++;
          continue;
        }
        const type = body.httpMetadata?.contentType ?? imageType(object.key) ?? "image/jpeg";
        const metadata = await twice(() => deps.describe(bytes, type));
        const embedding = await twice(() => deps.embed(metadata.title + "\n" + metadata.description));
        await upsertImage(db, {
          path,
          contentHash,
          etag: object.etag,
          model: VISION_MODEL,
          title: metadata.title,
          description: metadata.description,
          embedding,
        });
        added++;
      } catch (error) {
        failures.push({ path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (added || stale.length) await deps.nextGeneration();
    return {
      ok: failures.length === 0,
      seeded,
      indexed: added,
      unchanged,
      removed: stale.length,
      remaining: Math.max(0, pending.length - deps.batch),
      images: await countImages(db),
      failures,
    };
  });
}

/** The pass, on the Worker's own bindings. */
export async function indexImages(origin: string): Promise<IndexResult> {
  const { env } = await getCloudflareContext({ async: true });
  return runIndex({
    bucket: env.IMAGES,
    assets: env.ASSETS,
    origin,
    db: withDb,
    describe: describeImage,
    embed: embedText,
    nextGeneration,
    batch: BATCH,
  });
}
