# semantic-image-search — operating contract (for humans and agents)

This is the standing guide to how this product is deployed and operated.
Instance facts (live URLs, workspace, each environment's index, the
secrets it uses) live in [deployment.md](deployment.md), rendered from
probed reality by the bootstrap's `02-docs` phase; this file is the contract
that stays true between deployments. It is written to give an agent with
repository read access enough context to reason about and operate the product
without any other source.

## What this system is

Vercel's Semantic Image Search — a page of images searched by what they
show — on Cloudflare Workers. Each image is titled and described by
**Workers AI's** `@cf/meta/llama-4-scout-17b-16e-instruct` in JSON mode, and
the title and description embedded by `@cf/baai/bge-base-en-v1.5` (768
dimensions), both through the Worker's `AI` binding
(`apps/web/lib/ai/models.ts`). A search is embedded by the same model and
ranked by cosine similarity in pgvector, beside a plain text match on title
and description (`apps/web/lib/db/api.ts`). The images live in an R2 bucket
the Worker serves at `/images/<name>`; the searches are cached in Workers
KV; the vectors are in a Supabase project's Postgres, reached through
Cloudflare Hyperdrive. Expressed as an Orun component-native desired-state
repo. Nine components:

- **`infra/terraform/supabase`** (`supabase`) — one Supabase project per
  environment. Its apply publishes `SUPABASE_PROJECT_REF`,
  `SUPABASE_DB_PASSWORD` and `SUPABASE_DB_URL` onto the environment's secret
  rung.
- **`infra/terraform/cloudflare-hyperdrive`** (`cloudflare-hyperdrive`) — one
  Hyperdrive config per environment over that database. Its apply publishes
  `WIRING_CLOUDFLARE_HYPERDRIVE` (the config's id and name).
- **`infra/terraform/cloudflare-r2`** (`cloudflare-r2`) — one R2 bucket per
  environment, the images. Its apply publishes `WIRING_CLOUDFLARE_R2` (the
  bucket's name).
- **`infra/terraform/cloudflare-kv`** (`cloudflare-kv`) — one Workers KV
  namespace per environment, the search cache. Its apply publishes
  `WIRING_CLOUDFLARE_KV` (the namespace's id and title).
- **`infra/db-migrate`** (`db-migrate`) — applies `packages/db`'s migrations
  to the environment's database through Supabase's Management API: the
  pgvector extension, the `images` table and its HNSW index (`010`), and
  row-level security (`020`). Each migration is recorded with its checksum in
  `_migrations.applied`; only the missing ones apply.
- **`packages/db`** (`db`) — the migrations and their runner.
- **`apps/web`** (`web`) — the app: Next.js built by `@opennextjs/cloudflare`
  into one Worker plus Static Assets. It reaches Postgres through its
  `HYPERDRIVE` binding, one client per call (`lib/db/index.ts`), the images
  through `IMAGES`, the cache through `CACHE` and the models through `AI`.
- **`tests/web`**, **`tests/db`** — vitest suites, verified on the `dev` rung.

Environments: **`stage`** and **`prod`** are deployed; **`dev` is
verify-only by design** — lanes build and test, nothing deploys.

## Identity and tenancy

Every remote operation runs against ONE Orun workspace, declared in
`intent.yaml` under `execution.state.workspace` — committed, enforced, and
what CI uses. Do not remove it; headless credentials depend on it. If it
reads `ws_SET_ME`, the bootstrap had no workspace to write: set the real one
before anything else.

## How deployment works

1. Merge (or push) to `main`.
2. CI (`.github/workflows/ci.yml`) runs `orun plan --changed` — only
   components whose files changed are planned — then runs each planned lane
   with `orun run --remote-state`, authenticated by GitHub OIDC (the
   exchange resolves this repository's linked workspace server-side).
3. Per environment, in this order — each edge `mode: enforced` on a push to
   main, advisory on a pull request (which deploys nothing):
   **`supabase` → `cloudflare-hyperdrive` → `db-migrate` → `web`, and
   `cloudflare-r2` and `cloudflare-kv` → `web`.** A job resolves its secrets
   when it starts, so each one reads what the apply before it published. The
   app's deploy re-renders `apps/web/wrangler.jsonc` from
   `WIRING_CLOUDFLARE_HYPERDRIVE`, `WIRING_CLOUDFLARE_R2` and
   `WIRING_CLOUDFLARE_KV` before it builds, deploys
   `semantic-image-search-web-<env>`, and smoke-tests it: the page; **the indexing
   pass**, `POST /api/index`, called until it answers `"remaining":0`; and
   `/api/health`, which answers 200 only when the database is reachable
   through Hyperdrive and migrated, and must count at least one image.
4. `prod` deploys after `stage` has converged on the same commit
   (`environments.prod.promotion` in intent.yaml).
5. **The convergence run is the deployment.** A green run means every
   planned lane applied. Failed lanes are retried with
   `gh run rerun --failed`, which resumes the same execution.

Caveats that matter:

- A push that touches no component files plans zero lanes — that run is
  green and deployed nothing. Never treat "latest run green" as "product
  converged"; probe the URLs instead.
- `apps/web/wrangler.jsonc` is committed as the render of
  `wrangler.template.jsonc` from `wiring.fixture.json` (a placeholder
  Hyperdrive id): edit the template and run `pnpm run wire:fixture`. The
  deploy lanes render the real one in their own job tree; never commit a
  real id.
- **The index follows the bucket.** The pass (`lib/ai/index-images.ts`)
  seeds the sample images (`lib/samples.ts`) into the bucket if they are not
  there, then indexes every image under `images/` it has not seen — by the R2
  object's etag; an image whose bytes are unchanged (its sha256) is not
  described again — and removes from the index every image gone from the
  bucket. It is idempotent and needs no credential: it describes only the
  environment's own bucket. Four images per call; the deploy smoke calls it
  until none remain (at most thirty calls).
- **Searches are cached in KV** under the index's generation
  (`index:generation`), which a pass that adds or removes an image moves on,
  with a day's TTL. Never write a cache key without the generation.
- **The embedding model and the column are one decision.** `images.embedding`
  is `vector(768)`, BGE base's size. Changing `EMBEDDING_MODEL` is a new
  migration (the column, the index) and a re-index of every image: vectors
  from two models do not share a space, even at the same size.
- Every table in `public` has row-level security and no policy. Supabase's
  Data API serves `public` to the anon key, so this is what keeps the table
  out of it; the app is unaffected because it connects as `postgres`, the
  table's owner. Enable RLS on a new table; never `FORCE` it, and never add a
  policy for `anon` without meaning to publish that table.
- A migration is immutable once applied: its checksum is in
  `packages/db/src/manifest.ts` and in the database's ledger. Change the
  schema with a NEW migration in `packages/db/src/migrations`.

## Secrets model

- **Brokered provider secrets**, minted per run from the workspace's
  connections — no long-lived values at rest, nothing to rotate by hand:
  `CLOUDFLARE_API_TOKEN` (Workers deploy, the AI binding included, and the
  KV namespace's apply), `CLOUDFLARE_HYPERDRIVE_TOKEN` (Hyperdrive — the
  deploy token deliberately cannot touch it), `CLOUDFLARE_R2_TOKEN` (the
  bucket's apply — the deploy token carries no R2), `CLOUDFLARE_ACCOUNT_ID`,
  `SUPABASE_ACCESS_TOKEN` (project create and migrations) and
  `SUPABASE_ORG_ID`.
- **Published by the applies** onto the stage and prod rungs:
  `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`,
  `WIRING_CLOUDFLARE_HYPERDRIVE`, `WIRING_CLOUDFLARE_R2`,
  `WIRING_CLOUDFLARE_KV`.
- **No model key.** Workers AI is the Cloudflare account the Worker runs in;
  it bills that account after its free daily allocation — one vision call and
  one embedding per new image, one embedding per search not in the cache.
- Inspect by NAME only: `orun secrets list --org <ws> --project` and
  `--env stage|prod`. No tooling in this repository prints a secret value,
  and no document in `ai/context/` may contain one.

## Adding and removing images

Put an image (JPEG, PNG or WebP) into the environment's bucket under
`images/` — the Cloudflare dashboard, or `wrangler r2 object put
<bucket>/images/<name>.jpg --file <name>.jpg --remote` — then run the pass:
redeploy, or `curl -X POST <url>/api/index` until it answers
`"remaining":0`. Delete one from the bucket and the next pass removes it from
the index. A sample image `lib/samples.ts` still names is put back by the
next pass: to drop the samples, empty that list and `public/samples`'s images
in a merge, then delete them from the bucket.

## Verifying the system

```bash
# the app and its database path on each environment (also recorded, probed, in deployment.md)
curl -s -o /dev/null -w '%{http_code}\n' https://semantic-image-search-web-stage.your-workers-subdomain.workers.dev/
curl -s https://semantic-image-search-web-prod.your-workers-subdomain.workers.dev/api/health   # {"ok":true,…,"images":N}

# the index: nothing to do answers "indexed":0 and calls no model
curl -s -X POST https://semantic-image-search-web-prod.your-workers-subdomain.workers.dev/api/index

# the whole path, the models included: search on the page

# workspace readiness (integrations + repository link)
orun integrations list --org <ws> --json && orun cloud check --org <ws>
```

## Common operations

| task | how |
|---|---|
| deploy a change | merge to `main`; watch the run; failed lanes → `gh run rerun --failed` |
| deploy by hand | Orunbase's Deploy button, or `gh workflow run ci.yml --ref main -f environment=<env> [-f component=<a,b>]` — the named components (blank: every one) run in that environment as a merge runs them; started off `main` it is refused |
| change the schema | a new `packages/db/src/migrations/<nnn>_<name>/up.sql` (enable row-level security on any new table in `public`), its entry in the manifest (`pnpm --filter @saas/db run manifest:fix` for its checksum); merge — db-migrate applies it before the app deploys. `pnpm test` fails on a table in `public` without row-level security |
| add or remove images | above |
| re-index everything | delete the rows (`DELETE FROM images`) and run the pass; it describes every image in the bucket again |
| try the schema locally | `DATABASE_URL=… pnpm --filter @app/web db:migrate:local` applies every migration to a local Postgres |
| change the vision model | `VISION_MODEL` in `apps/web/lib/ai/models.ts` — a Workers AI vision model with JSON mode; images already indexed keep their descriptions until re-indexed |
| change the embedding model | `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS`, a migration for the column and its index, and a re-index |
| tune the search | `SIMILARITY_THRESHOLD` in `apps/web/lib/db/api.ts` (0.5) |
| redeploy without a change | edit the last line of the component's `component.yaml` (`# orun: redeploy <reason> <stamp>`) and merge — it is a deploy trigger, nothing reads it |
| serve a custom domain | attach it to the Worker in Cloudflare, then set `SITE_URL` under that environment's `env:` in `intent.yaml` (the page's Open Graph link is absolute), replace the placeholder `semantic-image-search.example.com` in its `BASE_DOMAIN` with the domain, and merge |
| headless credentials | `ORUN_TOKEN` (workspace-scoped) + `GITHUB_TOKEN` |

The deployment record is the bootstrap's `02-docs` phase. Re-running it (the
Orun console's Retry on that phase, or `orun new … --phase 02-docs`)
re-probes the URLs and re-renders [deployment.md](deployment.md); it is
idempotent.

## Evolution

Structural changes (a second Worker, another data store) follow the
same contract that deployed the product: add a component under `apps/`,
`infra/` or `packages/` with a `component.yaml` — declaring `dependsOn` on
any infrastructure whose published secrets it reads, enforced on main — land
it as a pull request, and the convergence run applies it.
