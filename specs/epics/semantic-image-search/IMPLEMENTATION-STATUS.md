# semantic-image-search — implementation status

| Milestone | State | Landed |
|---|---|---|
| SI0 — the spec | ✅ | SI-1 |
| SI1 — the image search on Workers and Supabase | ✅ | SI-2 |
| SI2 — a baseline | planned | SI-3 |

## Departures from the upstream template

Everything not listed here is the template as it is at `94eaed2`.

| # | What | Why |
|---|---|---|
| 1 | Next.js 15.5.15 → 16.3.8 (React 19.0.4), ESLint in eslint-config-next 16's flat form, `images.unoptimized` in place of Blob's `remotePatterns`, `tsconfig.json`'s `jsx` and `moduleResolution` as Next.js 16 writes them | `@opennextjs/cloudflare` 1.20.11 refuses 15.5; the images are the Worker's own URLs |
| 2 | GPT-4o → Workers AI's Llama 4 Scout through the `AI` binding, in JSON mode with upstream's prompt and schema; `text-embedding-3-small` (1536) → BGE base (768); the AI SDK and `@ai-sdk/openai` dropped | No vendor key; one embedding model for the images and the searches |
| 3 | The three indexing scripts → one idempotent pass, `POST /api/index` (`lib/ai/index-images.ts`), run by the deploy's smoke | A product is indexed when it is live (design.md) |
| 4 | Vercel Blob → an R2 bucket, served at `/images/<name>` (`app/images/[...key]/route.ts`) | |
| 5 | Vercel KV → Workers KV under the index's generation, a day's TTL | Upstream's cache never expired |
| 6 | `@vercel/postgres` → `postgres` over the `HYPERDRIVE` binding, a client per call; `drizzle-kit push` → migrations `010_images` (the extension, the table, its HNSW index, and the indexer's `content_hash`, `etag` and `model` columns) and `020_row_level_security` | The Workers runtime; the schema applied before the deploy; the Data API |
| 7 | The similarity bar 0.28 → 0.5 | 0.28 was OpenAI's (risk SI-B) |
| 8 | Twelve sample images, `public/samples`, seeded by the pass | Upstream ships none |
| 9 | `lib/site.ts`: `SITE_NAME` read by the layout's title and the header (upstream's header said "Semantic Search", its title "Semantic Image Search Demo"); `siteUrl()` for `metadataBase` | One rename seam; each product's own origin |
| 10 | The "Deploy with Vercel" button (`components/deploy-button.tsx`) → `components/source-link.tsx`; the intro names Workers AI | |
| 11 | With no query and nothing found, the page says the index is empty | A deploy before its first pass, or a bucket emptied |
| 12 | The card says which model described the image (its row's `model`), not "GPT-4o" | It is no longer GPT-4o |
| 13 | `app/api/health/route.ts` added: the database reachable, the schema migrated, the images counted | The deploy's smoke and the record's probe |
| 14 | `next.config.mjs` (standalone output, the trace root, the dev platform proxy), `open-next.config.ts` and `wrangler.template.jsonc` added; `sharp`, `dotenv`, `tsx`, `drizzle-kit` and the Vercel packages dropped | OpenNext's build; nothing runs them |

## Departures from the reference

| # | What | Why |
|---|---|---|
| 1 | No drizzle-kit migrations: the schema is Drizzle's for the queries, and the migrations live only in `packages/db`, applied locally with `tooling/migrations/apply-local.mjs` | rag-chatbot's twins were drizzle's |
| 2 | An R2 root and a KV root beside rag-chatbot's, with the `r2-data` mint | Blob and KV |
| 3 | No chat, no tools: one vision call per image and one embedding per text; the e2e stand-in describes each sample by the sha256 of its bytes | The template |
| 4 | The deploy smoke does work (the indexing pass), not only probes | Indexing on deploy |

## Verified

- `pnpm typecheck`, `lint`, `test` (tests/web 39, tests/db 10) and `build`
  green; the Worker is 1.33 MiB gzipped (Workers Free).
- Every contract tier, the leak gate and the placement tier pass locally.
  The e2e tier needs a PostgreSQL server with pgvector (initdb, pg_ctl,
  psql), which this build's machine did not have: it ran on Baseline CI,
  where every pull request ran it before it merged. Its serving half — the
  empty index, the component's own smoke indexing the samples through the
  Workers AI stand-in, the routes, the searches and the second pass — was
  run here too, against the built Worker over an in-process Postgres with
  pgvector.
