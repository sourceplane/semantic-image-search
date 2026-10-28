import { eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from ".";
import { images } from "./schema";

// The indexer's reads and writes (lib/ai/index-images.ts), upstream's
// 2-embed-and-save.ts insert grown into an upsert by path.
export type IndexedImage = { path: string; contentHash: string; etag: string };

export async function listIndexed(db: Db): Promise<IndexedImage[]> {
  return db
    .select({ path: images.path, contentHash: images.contentHash, etag: images.etag })
    .from(images);
}

export type NewImage = {
  path: string;
  contentHash: string;
  etag: string;
  model: string;
  title: string;
  description: string;
  embedding: number[];
};

export async function upsertImage(db: Db, image: NewImage): Promise<void> {
  await db
    .insert(images)
    .values({ id: nanoid(), ...image })
    .onConflictDoUpdate({
      target: images.path,
      set: {
        contentHash: image.contentHash,
        etag: image.etag,
        model: image.model,
        title: image.title,
        description: image.description,
        embedding: image.embedding,
      },
    });
}

export async function touchEtag(db: Db, path: string, etag: string): Promise<void> {
  await db.update(images).set({ etag }).where(eq(images.path, path));
}

export async function removeImages(db: Db, paths: string[]): Promise<void> {
  if (paths.length) await db.delete(images).where(inArray(images.path, paths));
}

export async function countImages(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(images);
  return row?.n ?? 0;
}
