"use server";

import {
  cosineDistance,
  desc,
  getTableColumns,
  gt,
  or,
  sql,
} from "drizzle-orm";
import { withDb, type Db } from ".";
import { DBImage, images } from "./schema";
import { generateEmbedding } from "../ai/utils";
import { cacheKey, readCache, writeCache } from "../cache";

// Upstream's search, on the per-call client (lib/db/index.ts) and Workers KV
// (lib/cache.ts). The hashes and the R2 version stay server-side with the
// embedding.
const { embedding: _, contentHash: _h, etag: _e, createdAt: _c, ...rest } = getTableColumns(images);
const imagesWithoutEmbedding = {
  ...rest,
  embedding: sql<number[]>`ARRAY[]::integer[]`,
};

// Upstream's threshold was 0.28, for OpenAI's text-embedding-3-small. BGE's
// cosine similarities run higher for unrelated text, so the bar is too; it is
// the one number to tune against your own images.
const SIMILARITY_THRESHOLD = 0.5;

const findSimilarContent = async (db: Db, description: string) => {
  const embedding = await generateEmbedding(description);
  const similarity = sql<number>`1 - (${cosineDistance(images.embedding, embedding)})`;
  return db
    .select({ image: imagesWithoutEmbedding, similarity })
    .from(images)
    .where(gt(similarity, SIMILARITY_THRESHOLD))
    .orderBy((t) => desc(t.similarity))
    .limit(10);
};

const findImageByQuery = async (db: Db, query: string) => {
  return db
    .select({ image: imagesWithoutEmbedding, similarity: sql<number>`1` })
    .from(images)
    .where(
      or(
        sql`title ILIKE ${"%" + query + "%"}`,
        sql`description ILIKE ${"%" + query + "%"}`,
      ),
    );
};

function uniqueItemsByObject(items: DBImage[]): DBImage[] {
  const seenObjects = new Set<string>();
  const uniqueItems: DBImage[] = [];

  for (const item of items) {
    if (!seenObjects.has(item.title)) {
      seenObjects.add(item.title);
      uniqueItems.push(item);
    }
  }

  return uniqueItems;
}

export const getImages = async (
  query?: string,
): Promise<{ images: DBImage[]; error?: Error }> => {
  try {
    const key = await cacheKey(query);
    const cached = await readCache(key);
    if (cached) {
      return { images: cached };
    }
    const found = await withDb(async (db) => {
      if (query === undefined || query.length < 3) {
        return db.select(imagesWithoutEmbedding).from(images).orderBy(images.path).limit(20);
      }
      const directMatches = await findImageByQuery(db, query);
      const semanticMatches = await findSimilarContent(db, query);
      return uniqueItemsByObject(
        [...directMatches, ...semanticMatches].map((image) => ({
          ...image.image,
          similarity: image.similarity,
        })),
      );
    });
    await writeCache(key, found);
    return { images: found };
  } catch (e) {
    console.error("search failed", e);
    if (e instanceof Error) return { error: e, images: [] };
    return {
      images: [],
      error: { message: "Error, please try again." } as Error,
    };
  }
};
