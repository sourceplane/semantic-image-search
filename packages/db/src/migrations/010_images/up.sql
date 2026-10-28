-- The images table: upstream's lib/db/schema.ts, with Workers AI's embedding
-- size and the three columns the indexer needs.
--
-- Upstream created it with `drizzle-kit push` against Vercel Postgres, after
-- `CREATE EXTENSION vector` by hand. Here the extension and the table are this
-- migration, applied by db-migrate before the Worker deploys:
--
--   embedding     vector(768) — Workers AI's @cf/baai/bge-base-en-v1.5
--                 (apps/web/lib/ai/models.ts); upstream's was 1536, OpenAI's
--                 text-embedding-3-small. Vectors from two models do not
--                 share a space, so changing the model is a new migration and
--                 a re-index of every image.
--   path          the image's URL on the Worker (/images/<name>, served from
--                 R2), where upstream stored a Vercel Blob URL; UNIQUE, so
--                 re-indexing an image replaces its row.
--   content_hash  the sha256 of the image's bytes, and
--   etag          the R2 object version it was indexed from: the indexer
--                 skips an image whose version it has seen, and re-describes
--                 one only when its bytes changed.
--   model         the vision model that wrote title and description.
--
-- Idempotent: IF NOT EXISTS throughout.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "images" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"path" text NOT NULL UNIQUE,
	"content_hash" text NOT NULL,
	"etag" text NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "embeddingIndex" ON "images" USING hnsw ("embedding" vector_cosine_ops);
