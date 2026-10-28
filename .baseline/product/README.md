# semantic-image-search

Vercel's [Semantic Image Search](https://github.com/vercel-labs/semantic-image-search)
— search a page of images by what they show, not by their file names: a
vision model titles and describes each image, the description is embedded,
and your search is embedded and ranked against them by cosine similarity,
beside a plain text match — on **Cloudflare Workers + Static Assets**
through [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare). Both
models are **Workers AI**'s, through the Worker's `AI` binding, so it needs
no AI vendor key. The images live in an **R2** bucket the Worker serves,
searches are cached in **Workers KV**, and the vectors are in a **Supabase**
project's Postgres with pgvector, reached through **Cloudflare Hyperdrive**.
Terraform provisions all four per environment, Orun's `db-migrate` applies
the schema, and every deploy indexes the bucket — all on every merge to
`main`.

## Live deployment

<!-- 02-docs:begin -->
Not recorded yet. The bootstrap's last phase writes the live URLs, the
workspace, the state of each environment's index and the secrets the product
uses into [ai/context/deployment.md](ai/context/deployment.md); how the
product deploys and how to operate it is in
[ai/context/operations.md](ai/context/operations.md).
<!-- 02-docs:end -->

## What is here

| Surface | Where |
|---|---|
| The product's name and source link | `apps/web/lib/site.ts` |
| The page and its search | `apps/web/app/page.tsx`, `apps/web/components`, `apps/web/lib/db/api.ts` |
| The models — Workers AI's vision and embedding models | `apps/web/lib/ai/models.ts` |
| The indexing pass, and the route every deploy calls | `apps/web/lib/ai/index-images.ts`, `apps/web/app/api/index/route.ts` |
| The images, served from R2 | `apps/web/app/images/[...key]/route.ts` |
| The search cache in KV | `apps/web/lib/cache.ts` |
| The database check the deploy smoke-tests | `apps/web/app/api/health/route.ts` |
| The sample images | `apps/web/public/samples`, `apps/web/lib/samples.ts` |
| Workers build and deploy contract | `apps/web/next.config.mjs`, `open-next.config.ts`, `wrangler.template.jsonc` → `wrangler.jsonc`, `component.yaml` |
| The pgvector extension, the images table and row-level security, as migrations, and their runner | `packages/db` (`@saas/db`) |
| Applying the migrations locally | `tooling/migrations/apply-local.mjs` |
| The Supabase project, the Hyperdrive config, the bucket, the namespace, the migration step | `infra/terraform/supabase`, `infra/terraform/cloudflare-hyperdrive`, `infra/terraform/cloudflare-r2`, `infra/terraform/cloudflare-kv`, `infra/db-migrate` |
| Tests | `tests/web`, `tests/db` (vitest) |

## Getting started

```bash
pnpm install
pnpm run wire:fixture   # re-render apps/web/wrangler.jsonc from its template (it is committed)
pnpm typecheck
pnpm lint
pnpm test
pnpm build              # next build + opennextjs-cloudflare build → apps/web/.open-next
```

The build needs no database, no model and no bucket: nothing pre-renders
against them. The tests run the indexing pass, the search and the routes
against scripted bindings, and every migration on an in-process Postgres
with pgvector.

## The images, and the index

The product starts with **twelve sample images** (`apps/web/public/samples`,
drawn for it and licensed with it), so there is something to search on the
first deploy. They ship as static assets; the first indexing pass copies
each into the bucket under `images/`.

**The index follows the bucket.** `POST /api/index` runs one pass over the
environment's bucket: every image under `images/` (JPEG, PNG or WebP) it has
not indexed is fetched, described by the vision model, embedded and stored;
an image whose R2 version it has already seen is skipped, and one whose
bytes have not changed is not described again; an image gone from the bucket
leaves the index. One call indexes up to four images and answers how many
remain, so it is called until `"remaining":0`. Every deploy's smoke step does
exactly that, so a merge leaves each environment indexed.

**Add your own images** to the environment's bucket (Cloudflare → R2 →
`stg-semantic-image-search-stage` or `prod-semantic-image-search-prod`, or `wrangler r2 object
put <bucket>/images/<name>.jpg --file <name>.jpg --remote`), then run the
pass — redeploy, or:

```bash
curl -X POST https://semantic-image-search-web-prod.<your-subdomain>.workers.dev/api/index
```

(again until it answers `"remaining":0`). **To drop the samples**, empty the
list in `apps/web/lib/samples.ts`, delete `apps/web/public/samples`'s images
and merge, then delete them from the bucket: a sample the list still names is
put back by the next pass.

The pass needs no credential: it describes only what is in the environment's
own bucket, and an image it has indexed costs nothing to see again, so a
call from anyone does what the deploy does. Workers AI bills the Cloudflare
account the Worker runs in after its free daily allocation — one vision call
and one embedding per new image, one embedding per new search.

**Searches are cached in KV** for a day, under the index's generation: a
pass that adds or removes an image moves the generation on, so a search
never answers from an index that has changed.

**The similarity bar** (`SIMILARITY_THRESHOLD` in `apps/web/lib/db/api.ts`)
is 0.5, a judgement for BGE's embeddings (upstream's 0.28 was for OpenAI's).
If your searches find too little or too much, it is the one number to tune.

## Running it locally

You need a Postgres with pgvector, and a Cloudflare login for the models.

1. **A Postgres** on `localhost:5432` with the pgvector extension available,
   database `images`, user and password `postgres` — the
   `localConnectionString` in `apps/web/wrangler.template.jsonc`. Docker is
   the quickest:

   ```bash
   docker run --name images-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=images -p 5432:5432 -d pgvector/pgvector:pg17
   ```

2. **Environment.** Copy `apps/web/.env.example` to `apps/web/.env.local`:
   `DATABASE_URL` is for the migration script. The Worker never reads it:
   its database is the `HYPERDRIVE` binding.

3. **Schema.** Apply every migration — the extension, the table, row-level
   security — with `psql`:

   ```bash
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/images pnpm --filter @app/web db:migrate:local
   ```

   CI applies the same files to the real databases.

4. **Models.** Workers AI has no local mode: the `AI` binding always reaches
   your Cloudflare account, so `wrangler login` once. That is all — no key.
   The bucket and the namespace are local under `wrangler dev`.

5. **Run** the built Worker under `wrangler dev`, then index the samples:

   ```bash
   pnpm build
   pnpm --filter @app/web preview      # http://localhost:8787
   curl -X POST http://localhost:8787/api/index   # until "remaining":0
   ```

## How it deploys

Merges to `main` converge through [Orun](https://github.com/sourceplane/orun):
`.github/workflows/ci.yml` plans the changed components and runs each lane
against the workspace in `intent.yaml`. Per environment the order is
enforced — **the Supabase project, then the Hyperdrive config over its
database, then the migrations, and the bucket and the namespace, then the
Worker** — because each reads what the one before it published: the
project's ref and password, the Hyperdrive id, the bucket's name and the
namespace's id the Worker binds, the schema the app queries. `stage` deploys
first and `prod` once stage has converged on the same commit; `dev` only
verifies. Every deploy is smoke-tested over HTTP: the page, the indexing pass
until nothing remains, and `/api/health`, which answers only when the Worker
reaches a migrated database, and counts the images indexed.

The pipeline holds one credential, GitHub's own `GITHUB_TOKEN`. The
Cloudflare tokens and account id and the Supabase access token and org id
are brokered per run from the workspace's connections; the Supabase
project's credentials, the Hyperdrive id, the bucket's name and the
namespace's id are published by the Terraform applies as orun secrets.
Workers AI needs nothing: the `AI` binding is the account the Worker deploys
into. Nothing provider-shaped is stored in the repository or in GitHub.

**Deploy by hand.** Orunbase's **Deploy** button on a component, or **Run
workflow** on the CI workflow in GitHub's Actions tab (on `main`), runs
`ci.yml` for the environment and components you pick, and each one deploys
exactly as a merge would deploy it. Leave the component blank to redeploy
every component in that environment, with nothing changed. A component with
nothing to run in that environment (a test suite in `prod`) is left out with
a notice.

## Custom domain

The app answers on workers.dev from its first deploy. To serve it on your
own domain, attach the domain to the Worker in Cloudflare (Workers & Pages →
`semantic-image-search-web-prod` → Settings → Domains & Routes), then set `SITE_URL`
under that environment's `env:` in `intent.yaml` — the page's Open Graph
image link is absolute, and the build bakes the origin in — and merge.

The repository names the domain in one more place, `BASE_DOMAIN` in
`intent.yaml` (one line per environment), which the product was born with as
the reserved placeholder `semantic-image-search.example.com`. Replace it with your
domain in the same change.

## CI

| Workflow | What it runs |
|---|---|
| `ci.yml` | the Orun pipeline, and the only workflow: `orun plan --changed`, then one job per lane. A pull request runs the verify lanes — the app built and dry-deployed for each environment, the four Terraform roots checked and planned, the migrations planned — with nothing applied or deployed. No lane runs the `typecheck`, `lint` or `test` scripts: run them yourself (above) before you push. A merge applies, migrates, deploys stage → prod and indexes each |

## Licence

The app is upstream's, under the Apache License 2.0 (`apps/web/LICENSE`);
the sample images are licensed with it.
