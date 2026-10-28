# semantic-image-search — design

## The template

Vercel's Semantic Image Search ([vercel-labs/semantic-image-search](https://github.com/vercel-labs/semantic-image-search))
is a Next.js 15 App Router app with one page. The page is a server
component: it reads the search from `?q=`, and a suspended child calls
`getImages(query)` (`lib/db/api.ts`), which answers from Vercel KV if the
query is cached and otherwise runs two searches over the `images` table in
Vercel Postgres — a text match (`ILIKE`) on title and description, each hit
scored 1, and a semantic match: the query embedded by OpenAI's
`text-embedding-3-small` (1536 dimensions) and ranked by cosine similarity
in pgvector, above 0.28 — merged, deduplicated by title and cached in KV for
good. With no query it lists twenty images. A card shows the image, its
title and description, and a badge for a direct or a semantic match.

Nothing indexes the images at run time. The owner runs three scripts by
hand (`lib/ai/0-upload.ts`, `1-generate-metadata.ts`, `2-embed-and-save.ts`):
upload a git-ignored `images-to-index/` directory to Vercel Blob; ask GPT-4o
for each image's title and description (AI SDK 4, `generateObject` with
upstream's schema and the prompt "Describe the image in detail."), written
to a JSON file; embed each description and insert the rows. The table is
pushed by `drizzle-kit` after the owner runs `CREATE EXTENSION vector` by
hand. The template ships no images.

## How it maps to Cloudflare and Supabase

| Vercel | Here | Why |
|---|---|---|
| Next.js hosting | One Worker (`.open-next/worker.js`) + Static Assets, built by `@opennextjs/cloudflare` on Next.js 16.3.8 | The adapter refuses Next.js 15.5 |
| GPT-4o for the metadata | `lib/ai/models.ts`: Workers AI's `@cf/meta/llama-4-scout-17b-16e-instruct` through the Worker's `AI` binding, the image as a base64 data URI, in JSON mode with upstream's prompt and upstream's schema as JSON Schema | Natively multimodal on Workers AI; a product indexes with no vendor key |
| `text-embedding-3-small` (1536) | `@cf/baai/bge-base-en-v1.5` (768), rag-chatbot's | The same model must embed the images and every search, so there is one embedding model and no OpenAI option (alternatives, below) |
| Vercel Blob | An R2 bucket per environment (`infra/terraform/cloudflare-r2`, blob-starter's root), bound as `IMAGES`; the Worker serves `images/<name>` at `/images/<name>` (`app/images/[...key]/route.ts`), with the object's etag, conditional requests and a cache header; a card's `path` is that URL | The bucket is private; the Worker is the delivery |
| Vercel KV, a query cache with no expiry | A Workers KV namespace per environment (`infra/terraform/cloudflare-kv`, kv-redis-starter's root), bound as `CACHE` (`lib/cache.ts`). Every key is prefixed with the index's generation (`index:generation`), which a pass that changes the index moves on, and expires in a day | Upstream's cache answered a search from before a re-index forever |
| Vercel Postgres + pgvector, `drizzle-kit push` | A Supabase project's Postgres through the `HYPERDRIVE` binding, a `postgres` client per call (`lib/db/index.ts`); `010_images` creates the extension, the table (768 dimensions, plus `content_hash`, `etag` and `model`) and its HNSW index; `020_row_level_security`; applied by `infra/db-migrate` before the Worker deploys | rag-chatbot's roots and runner; Supabase has pgvector |
| Three scripts run by hand | `POST /api/index` (below), run by every deploy's smoke | A product is indexed when it is live |
| No images | Twelve drawn for this baseline (below) | A product needs something to search |
| "Deploy with Vercel" | The header's source link to the product's own repository; `orun new --blueprint repo-blueprint.yaml` | |

## Indexing on deploy

The brief's question was where to run upload → describe → embed for a
product nobody has touched. Not at `next build`: the build holds no
credential and must not. Not in a CI step: the platform brokers no Workers AI
token to a job, and the Worker already holds every binding the work needs —
the bucket, both models and the database. So the work is the Worker's own,
one idempotent pass (`lib/ai/index-images.ts`), and the deploy's smoke is
where it runs: the moment a deployment's code, bucket and schema first meet.

One call:

1. **Seeds** each sample `lib/samples.ts` names that is not in the bucket,
   from the Worker's own assets (`/samples/<name>`).
2. **Lists** every image under `images/` (JPEG, PNG, WebP).
3. **Removes** from the table every row whose object is gone.
4. **Indexes** up to four images whose R2 etag differs from the row's: reads
   the bytes and hashes them (sha256); if the hash is the row's, only the
   etag is updated; otherwise the vision model describes the image, the
   title and description are embedded, and the row is upserted by path. Each
   model call is tried twice before the image counts as a failure.
5. **Moves the cache's generation** if anything was added or removed.

It answers `{ok, seeded, indexed, unchanged, removed, remaining, images,
failures}`. The smoke calls it until `"remaining":0` (thirty calls at
most), then requires `/api/health` to count at least one image. A second
deploy costs one listing and no model call.

The route needs no credential. It describes only the environment's own
bucket, which only its owner can write to, and an image it has indexed is
never described again, so a call from anyone does what the deploy does — at
most it indexes an image the owner put in the bucket a little sooner. A
bearer the deploy generates would need a secret the Worker and the smoke
both hold, which the composition has no way to hand to the smoke; doc-search,
the sibling port solving the same question, settled on the same open,
idempotent route.

## The sample images

Upstream ships none (its scripts read a git-ignored directory), and a fresh
product must have something to search and to prove its pipeline with. So
twelve flat illustrations were drawn for this baseline — a slice of pizza, a
stack of pancakes, a fruit bowl, a cup of coffee, a sailboat at sunset,
snowy mountains, a city at night, a pine forest, a red bicycle, a sleeping
cat, a lighthouse and hot-air balloons — 800×600 JPEGs of 8–20 KB, licensed
with the app under the Apache License 2.0 (`public/samples/README.md`). They
ship as static assets and are seeded into the bucket, so the owner's own
images and the samples go through exactly one path.

## The repository

rag-chatbot's tree in the turso v8 shape, with blob-starter's R2 root and
kv-redis-starter's KV root: `apps/web` (the template), `packages/db` (the
migrations and Lumen's runner), `infra/terraform/{supabase,
cloudflare-hyperdrive, cloudflare-r2, cloudflare-kv}`, `infra/db-migrate`,
`tests/web`, `tests/db`, `tooling/*`; the baseline's own `blueprint.yaml`,
`repo-blueprint.yaml`, `.baseline/`, `hooks/`, `docs/phases/`, `testing/`
and `ai/context/`. Per environment, on a push to main: supabase →
cloudflare-hyperdrive → db-migrate → web, and cloudflare-r2 and
cloudflare-kv → web, every edge enforced.

## Alternatives rejected

- **OpenAI as an option beside Workers AI.** For the vision model it would
  be honest; for the embeddings it is not: a query embedded by one model
  cannot be ranked against images embedded by another, and the column's size
  is the model's. An optional key that silently broke search, or a second
  column and a re-index, is not a fit. One model space, Workers AI's.
- **Vectorize instead of pgvector.** The brief names pgvector through
  Hyperdrive, upstream's search mixes a vector rank with SQL text matching
  in one database, and rag-chatbot already proves the path.
- **Indexing in a CI step.** The platform brokers no Workers AI credential
  to a job, and the job would need the bucket's and the database's
  credentials as well; the Worker has all of it already.
- **A bearer on `/api/index`.** No secret the Worker and the deploy smoke
  can both hold; and the pass is idempotent and bounded to the owner's
  bucket, so the bearer would guard nothing worth guarding.
- **Upstream's images, or stock photographs.** Upstream has none; a
  photograph's licence would have to travel with every product. Drawn images
  are ours to license.
- **Next.js 15.5.** The adapter refuses it.
