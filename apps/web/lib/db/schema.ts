import { varchar, index, pgTable, vector, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { EMBEDDING_DIMENSIONS } from "../ai/models";

// Upstream's `images` table, as packages/db's migration 010 creates it. Three
// columns are not upstream's: `content_hash` (the sha256 of the image's
// bytes) and `etag` (the R2 object version it was indexed from), which make
// the indexer idempotent — lib/ai/index-images.ts — and `model`, the vision
// model that wrote the title and description, which the image card names.
// `path` is the image's URL on this Worker (/images/<name>, served from R2),
// where upstream stored its Vercel Blob URL; it is unique, so re-indexing an
// image replaces its row. The embedding is Workers AI's (768 dimensions),
// not OpenAI's (1536).
export const images = pgTable(
  "images",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    title: text("title").notNull(),
    description: text("description").notNull(),
    path: text("path").notNull().unique(),
    contentHash: text("content_hash").notNull(),
    etag: text("etag").notNull(),
    model: text("model").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    embeddingIndex: index("embeddingIndex").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  }),
);

export const dbImageSchema = z.object({
  id: z.string(),
  embedding: z.array(z.number()),
  title: z.string(),
  path: z.string(),
  description: z.string(),
  model: z.string(),
  similarity: z.number().optional(),
});

export type DBImage = z.infer<typeof dbImageSchema>;
