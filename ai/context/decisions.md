# semantic-image-search — decisions

The choices that shape this repository, one line each, with where the full
reasoning lives.

| # | Decision | Why | Source |
|---|---|---|---|
| 1 | OpenNext on Workers + Static Assets, the static-assets incremental cache, Next.js 16.3.8 | The page renders per request from its query string; nothing revalidates; the adapter refuses Next.js 15.5 | `specs/epics/semantic-image-search/design.md` |
| 2 | `withDb()` builds a `postgres` client per call over the `HYPERDRIVE` binding and ends it; no module-level pool | Workers refuse a socket opened in another request; Hyperdrive holds the pool | design.md, rag-chatbot |
| 3 | Both models are Workers AI's through an `AI` binding: Llama 4 Scout describes each image in JSON mode with upstream's prompt and schema, BGE base embeds at 768 dimensions. No OpenAI option, no gateway | The platform brokers no AI vendor and AI Gateway is not a composition here; a search must be embedded by the model that embedded the images, so a second embedding model cannot sit beside the first | design.md, risk SI-B |
| 4 | Indexing is one idempotent pass on the Worker's own bindings (`POST /api/index`), four images a call, run by every deploy's smoke until none remain | Upstream's three hand-run scripts need a vendor key and a laptop; the Worker already holds the bucket, the models and the database, and a deploy is when the bucket and the code meet | design.md, "Indexing on deploy" |
| 5 | The pass skips an image by its R2 etag, and re-describes one only when its sha256 changed; an image gone from the bucket leaves the index; `/api/index` needs no credential | A deploy must cost nothing once indexed; the pass only ever describes the environment's own bucket, so a call from anyone does what the deploy does | design.md, risk SI-D |
| 6 | Twelve sample images drawn for this baseline, licensed with the app (Apache-2.0), shipped as static assets and seeded into the bucket by the pass | Upstream ships none; a product needs something to search on its first deploy, and the images must be ours to license | `apps/web/public/samples/README.md` |
| 7 | Images in an R2 bucket per environment, served by the Worker at `/images/<name>` with their etag; searches in a KV namespace per environment, every key under the index's generation, a day's TTL | Vercel Blob → R2 and Vercel KV → Workers KV; upstream's cache never expired, so a re-index served stale results | design.md |
| 8 | The database, the bucket and the namespace come from Terraform, the schema (pgvector, the table, its HNSW index) from db-migrate before the Worker deploys | rag-chatbot's, blob-starter's and kv-redis-starter's roots and runner; the build stays credential-free | design.md |
| 9 | `apps/web/wrangler.jsonc` is committed as the fixture render; the stage and prod lanes re-render it from the Hyperdrive, R2 and KV wiring documents | The composition checks the file exists before the build | design.md |
| 10 | Row-level security on every table in `public`, no policy | Supabase's Data API serves `public` to the anon key; the app, as owner, is not subject to it | `packages/db` 020 |
| 11 | One landing (`01-product`) then the record (`02-docs`); one convergence runs supabase → cloudflare-hyperdrive → db-migrate → web, and cloudflare-r2 and cloudflare-kv → web, enforced on `main`, advisory on a pull request | A job resolves its secrets when it starts, so each apply must finish before its reader | `repo-blueprint.yaml` |
| 12 | `ci.yml` plans nothing while `intent.yaml` names `ws_CHANGE_ME` | A bootstrap cannot set a repository variable | `.github/workflows/ci.yml` |
| 13 | stack-tectonic 0.19.0, not 0.20.0 | 0.20.0's lane-scoped install links `node_modules` out of the job tree, which Next 16's Turbopack refuses | `intent.yaml`, `BOOTSTRAP.md` (Troubleshooting) |
| 14 | orun is pinned only where it runs; component docs are generated from the manifests and checked in CI; the subdomain is read from the Cloudflare connection; the console asks for no domain | The cirrus standard and the turso-starter v8 shape, as rag-chatbot has them | `blueprint.yaml`, `repo-blueprint.yaml`, `tooling/catalog/gen-component-docs.py` |
