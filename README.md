# semantic-image-search

Vercel's [Semantic Image Search](https://github.com/vercel-labs/semantic-image-search)
— a page of images searched by what they show rather than by their file
names: a vision model titles and describes each image, the description is
embedded, and a search is embedded and ranked against it by cosine
similarity in pgvector, beside a plain text match — running on **Cloudflare
Workers + Static Assets** through [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare),
its images in an **R2** bucket served by the Worker, its searches cached in
**Workers KV**, both models **Workers AI**'s through the Worker's `AI`
binding, and its vectors in a **Supabase** project's Postgres reached through
**Cloudflare Hyperdrive** — all provisioned by Terraform through
[Orun](https://github.com/sourceplane/orun), the schema applied by Orun's
`db-migrate`, the way the [rag-chatbot baseline](https://github.com/sourceplane/rag-chatbot)
does it, and packaged as an **Orun baseline**: one command takes a new
product from nothing to live on stage and prod, in its own repository, under
its own name — in ONE landing.

The template's code is the code. What the port changes is what the Workers
runtime and a fresh unattended deployment force. Upstream indexed by hand:
three scripts (`upload` to Vercel Blob, `generate-metadata` with GPT-4o,
`embed-and-save` with OpenAI's embeddings). Here they are one idempotent
pass the Worker runs on its own bindings (`POST /api/index`,
`lib/ai/index-images.ts`), and every deploy's smoke step runs it: images in
the bucket it has not seen are described and embedded, images it has seen
are skipped by their R2 version and content hash, images gone from the
bucket leave the index. The models are Workers AI's (`lib/ai/models.ts`) —
Llama 4 Scout for the descriptions, BGE base at 768 dimensions for the
embeddings — so the platform brokers no AI vendor and the Cloudflare account
the app deploys into is the only one. Upstream ships no images; a fresh
product starts with twelve drawn for this baseline, licensed with it, seeded
into its bucket by its first pass. What the baseline adds is everything
needed to make a copy of it somebody else's — built the way
[cirrus-baseline](https://github.com/sourceplane/cirrus-baseline) is. See
[`specs/epics/semantic-image-search`](specs/epics/semantic-image-search/README.md)
for the design, the milestones and the as-built status, including every
departure.

## Instantiating a product

```bash
git clone --depth 1 --branch <baseline-tag> https://github.com/sourceplane/semantic-image-search
cd semantic-image-search
orun new --blueprint repo-blueprint.yaml --out ~/products/acme-gallery --run-hooks --resume \
  --set reponame=acme-gallery --set productname="Acme Gallery" \
  --set githuborg=acme-inc --set subdomain=<workers-dev-subdomain>
```

Or, once the platform's registry lists it, from the Orun console (Baselines →
`semantic-image-search` → Build). Two phases: **`01-product`** creates the repository,
mints the six brokered credentials (Cloudflare and Supabase) and lands the
whole product as one pull request, whose convergence on `main` provisions and
deploys it per environment in a fixed order —

```
supabase ──▶ cloudflare-hyperdrive ──▶ db-migrate ──▶ web
                        cloudflare-r2 ──────────────▶ web
                        cloudflare-kv ──────────────▶ web
```

— each edge `mode: enforced` on a push to main and advisory on a pull
request — and the web lane's smoke indexes the images; then **`02-docs`** records the live deployment from probed facts.
**[BOOTSTRAP.md](BOOTSTRAP.md)** is the operator guide;
[docs/phases/](docs/phases/README.md) has a page per phase.

**It creates two Supabase projects**, `<reponame>-stage` and
`<reponame>-prod`. Supabase's free plan allows two active projects per
organization, so the connected organization needs room for both
(BOOTSTRAP.md, §0).

The new repository receives the **product only** — the app, its sample
images, the Terraform roots, the migrations, the tests, its CI, its tooling,
a README of its own and its operating contract — renamed throughout to the
product's name, repository, Worker, bucket, namespace, Supabase project and
Hyperdrive config. None of this repository's machinery ships. **No AI vendor
key is asked for**: Workers AI needs none, and bills the Cloudflare account
the Worker runs in after its free daily allocation.

| What makes it a baseline | Where |
|---|---|
| The console card (inputs, secrets, programme) | `blueprint.yaml` |
| The build document (modules, phases, hooks) | `repo-blueprint.yaml` |
| This tree's identity, the product's README and the bootstrap's task contracts | `.baseline/` |
| The rename engine (product-name seam: `apps/web/lib/site.ts`) | `tooling/rebrand/rebrand.mjs` |
| The bootstrap's helpers (deferrals, redeploy marker, work-tree strip) | `tooling/bootstrap/` |
| The deployment-record renderer | `hooks/render-deployment-docs.sh` |
| The product's context pack | `ai/context/` |
| The baseline's tests: contract, leak, offline bootstrap and plans, end to end (with a Workers AI stand-in that describes the samples and embeds) | `testing/`, `.github/workflows/baseline.yml` |
| Cutting a `baseline-vN` tag | `.github/workflows/tag.yml` |

## What is here (the product)

| Surface | Where |
|---|---|
| The product's name and source link | `apps/web/lib/site.ts` |
| The page, `/api/index`, `/api/health`, the images from R2 (`/images/<name>`) | `apps/web/app` |
| The models: Workers AI's vision and embedding models | `apps/web/lib/ai/models.ts` |
| The indexing pass | `apps/web/lib/ai/index-images.ts` |
| The search, its KV cache, the per-call database client | `apps/web/lib/db/api.ts`, `lib/cache.ts`, `lib/db/index.ts` |
| The twelve sample images (Apache-2.0, drawn for this baseline) | `apps/web/public/samples` |
| Workers build and deploy contract | `apps/web/next.config.mjs`, `open-next.config.ts`, `wrangler.template.jsonc` → `wrangler.jsonc` (committed), `component.yaml` |
| The pgvector extension, the images table and row-level security as migrations, and Lumen's runner | `packages/db` (`@saas/db`) |
| The Supabase project, the Hyperdrive config, the bucket, the namespace, the migration step | `infra/terraform/supabase`, `infra/terraform/cloudflare-hyperdrive`, `infra/terraform/cloudflare-r2`, `infra/terraform/cloudflare-kv`, `infra/db-migrate` |
| Tests | `tests/web`, `tests/db` (vitest, PGlite with pgvector) |

## Getting started

```bash
pnpm install
pnpm run wire:fixture   # re-render apps/web/wrangler.jsonc from its template (committed; this changes nothing)
pnpm typecheck
pnpm lint
pnpm test
pnpm build              # next build + opennextjs-cloudflare build → apps/web/.open-next
pnpm --filter @saas/db run manifest:check
```

The build needs no database, no model, no bucket and no Cloudflare
credential. Running it locally — a Postgres with pgvector on
`localhost:5432`, `pnpm --filter @app/web db:migrate:local`, `wrangler login`
for Workers AI, `wrangler dev` — is in the product's README
(`.baseline/product/README.md`), which is what a product built from here
carries.

## How it maps to Vercel

| Vercel | Here |
|---|---|
| Next.js 15.5 hosting | One Cloudflare Worker (`.open-next/worker.js`) + Static Assets on Next.js 16.3.8 (the adapter refuses 15.5); the page and its search run as they did |
| GPT-4o through the AI SDK (`generate-metadata`), upstream's prompt and `{ image: { title, description } }` schema | Workers AI's `@cf/meta/llama-4-scout-17b-16e-instruct` through the `AI` binding, in JSON mode, the same prompt and schema; no key |
| OpenAI's `text-embedding-3-small` (1536 dimensions) for every image and query | Workers AI's `@cf/baai/bge-base-en-v1.5` (768). No OpenAI option: a query and the images must be embedded by the same model |
| Vercel Blob, filled by `pnpm run upload` | An R2 bucket per environment (`infra/terraform/cloudflare-r2`), bound as `IMAGES`, served by the Worker at `/images/<name>` with its etag; the samples seeded into it from the Worker's assets |
| Vercel KV, a query cache that never expired | A Workers KV namespace per environment (`infra/terraform/cloudflare-kv`), bound as `CACHE`; every key under the index's generation, which a pass that changes the index moves on, and a day's TTL |
| Vercel Postgres with pgvector, the table pushed by `drizzle-kit` | The Supabase project's Postgres through a Hyperdrive config; `CREATE EXTENSION vector`, the table and its HNSW index as migrations applied by `infra/db-migrate` before the Worker deploys |
| Three scripts run by hand (`upload`, `generate-metadata`, `embed-and-save`) | `POST /api/index`: one idempotent pass on the Worker's own bindings, four images per call, run until none remain by every deploy's smoke step |
| "Deploy with Vercel" (clone the template) | `orun new --blueprint repo-blueprint.yaml` — a new repository, branded, provisioned, deployed, indexed; the header links to its own source |

## CI

| Workflow | What it runs | Ships to a product |
|---|---|---|
| `ci.yml` | the Orun pipeline, and the only workflow a product carries: `orun plan --changed`, then one job per lane. A pull request runs the verify lanes (the app built and dry-deployed per environment, the four Terraform roots checked and planned, the migrations planned); no lane runs the `typecheck`, `lint` or `test` scripts — `baseline.yml`'s e2e tier runs them on the bootstrapped product before every tag, and a product's developers run them before they push. The bootstrap's own landings (`orun/BASE-*`) run `plan` alone and nothing waits for it — the landing was checked in the build box; a merge applies, migrates and deploys stage → prod. It plans nothing while `intent.yaml` names the placeholder workspace `ws_CHANGE_ME`, as this repository does. A manual run (Orunbase's Deploy button, or Run workflow on `main`) plans the environment and components it names under the push-to-main trigger, so they deploy as a merge deploys them | yes |
| `baseline.yml` | the baseline's own tiers: contract tests; the blueprint read by the pinned orun, the leak gate, the offline bootstrap and the product's own plans; the product built, migrated into a local Postgres with pgvector, dry-deployed, served with Workers AI stood in for, its samples indexed by its own smoke, searched, and the pass run again to index nothing | no |
| `tag.yml` | cuts a `baseline-vN` tag (manual) | no |
