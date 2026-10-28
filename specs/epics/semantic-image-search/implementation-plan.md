# semantic-image-search — implementation plan

Three milestones, each one reviewed pull request (SI0 is the repository's
first commit and its spec), each green before it merges.

## SI0 — the spec (SI-1)

The repository is born: `intent.yaml` with the placeholder workspace
`ws_CHANGE_ME`, `ci.yml` (byte for byte rag-chatbot's, which is
turso-starter's with the comment lines its own copy changes), the shared
TypeScript and ESLint configuration, the wiring renderer and migration
helpers, the spec index, this doc set and the task contracts.

## SI1 — the image search on Workers and Supabase (SI-2)

- The template in `apps/web` on Next.js 16.3.8: the page and its
  components as they are, `lib/site.ts` (the name seam, the source link, the
  origin) read by the layout and the header, the "Deploy with Vercel" button
  replaced by the source link, an empty-index state, the card naming the
  model that described the image; ESLint in eslint-config-next 16's flat
  form.
- `lib/ai/models.ts` (Llama 4 Scout in JSON mode, BGE base), `lib/db/`
  (upstream's search over a client per call; the indexer's queries),
  `lib/cache.ts` (KV under the index's generation), `lib/ai/index-images.ts`
  and `app/api/index`, `app/images/[...key]` (R2 delivery),
  `app/api/health`, `public/samples` and `lib/samples.ts`.
- `wrangler.template.jsonc` + `wiring.fixture.json` (the `HYPERDRIVE`,
  `IMAGES`, `CACHE` and `AI` bindings), `component.yaml` (the smoke: the
  page's search box, the indexing pass until nothing remains, `/api/health`
  counting images).
- `packages/db`: `010_images`, `020_row_level_security`; the Supabase,
  Hyperdrive, R2 and KV roots; `infra/db-migrate`.
- `tests/web` (the models' calls, the pass over the real schema with R2 in
  memory — seeding, skipping by etag and by hash, removing, failures, the
  generation — the search and its cache, the routes, the samples, the
  wrangler config, the origin and the name) and `tests/db` (the manifest,
  the schema at 768 dimensions and its cosine ranking, row-level security
  and its guard), on PGlite with pgvector.

## SI2 — a baseline (SI-3)

rag-chatbot's machinery on this tree: `blueprint.yaml` (Cloudflare and
Supabase, six brokered keys — R2's among them — the subdomain read from the
connection, no AI key), `repo-blueprint.yaml` (01-product, then 02-docs),
`.baseline/`, the rename engine (with upstream's own links masked: its
repository is named what this slug is), the bootstrap helpers, the
deployment-record renderer probing `/` and `/api/health` and recording each
environment's index, the phase pages, the context pack, and the baseline's
tests: manifest, phases, coverage, rebrand, retouch, bootstrap-defer, the
generated component docs, the leak gate, the offline bootstrap with the
product's own plan, and the end-to-end tier — the migrations applied
through a stand-in Supabase Management API over a real Postgres with
pgvector, the built Worker served over it with a stand-in for Workers AI,
the page saying the index is empty, the component's own smoke indexing the
samples, a search finding the right image first and answered from KV the
second time, the images from R2, and a second pass indexing nothing.
