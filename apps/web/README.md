# apps/web — the app

Vercel's [Semantic Image Search](https://github.com/vercel-labs/semantic-image-search)
template (Next.js, Drizzle, pgvector), ported to Cloudflare Workers through
`@opennextjs/cloudflare`. The repository's README is the product's guide:
what is here, how it deploys, adding images, running it locally. This page
is the map of the app itself.

| Path | What it is | Upstream's |
|---|---|---|
| `app/page.tsx`, `components/` | The page: the search box, the image grid, a card per image with its match badge, the empty and no-results states | the same, with the deploy button replaced by a link to this repository's source and an empty-index state added |
| `lib/db/api.ts` | `getImages(query)`: a text match on title and description, then a semantic match — the query embedded and ranked by cosine similarity over 0.5 — both read through the KV cache | the same search; its threshold was 0.28 (OpenAI's embeddings) and its cache never expired |
| `lib/db/schema.ts`, `lib/db/index.ts`, `lib/db/images.ts` | The images table in Drizzle, a client per call over the `HYPERDRIVE` binding, the indexer's reads and writes | the schema, with 768 dimensions and the indexer's columns; `@vercel/postgres` |
| `lib/ai/models.ts` | Workers AI's Llama 4 Scout describes an image (upstream's prompt and schema, in JSON mode); BGE base embeds text at 768 dimensions | GPT-4o and `text-embedding-3-small` through the AI SDK |
| `lib/ai/index-images.ts`, `app/api/index/route.ts` | One idempotent indexing pass over the bucket, `POST /api/index` | the three scripts in `lib/ai/` run by hand |
| `app/images/[...key]/route.ts` | The images, from the `IMAGES` R2 bucket, with their etags | Vercel Blob URLs |
| `lib/cache.ts` | The search cache in the `CACHE` KV namespace, keyed by the index's generation | `@vercel/kv` |
| `app/api/health/route.ts` | The database check the deploy smoke-tests, with the number of images indexed | — |
| `public/samples/`, `lib/samples.ts` | Twelve sample images, seeded into the bucket by the first pass | none shipped |
| `lib/site.ts` | The product's name and its source link | — |
| `wrangler.template.jsonc` → `wrangler.jsonc`, `wiring.fixture.json` | The Worker's bindings: `HYPERDRIVE`, `IMAGES`, `CACHE`, `AI`, `ASSETS` | Vercel's project settings |

The app is upstream's, under the Apache License 2.0 ([LICENSE](LICENSE)).
