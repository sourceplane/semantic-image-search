# semantic-image-search — Vercel's Semantic Image Search on Cloudflare

**The template's app as it is — a page of images searched by what they
show, each titled and described by a vision model, the descriptions and the
search compared as embeddings — on one Cloudflare Worker, both models
Workers AI's, the images in R2, the searches cached in Workers KV and the
vectors in a Supabase project's pgvector behind Hyperdrive; the indexing its
deploy does; and the baseline that makes a copy of it somebody else's
product in one landing.**

| | |
|---|---|
| Status | ✅ Shipped (`baseline-v1`) — proven offline in Baseline CI; not yet live (risk SI-A) |
| Upstream | [vercel-labs/semantic-image-search](https://github.com/vercel-labs/semantic-image-search) (Apache-2.0), Vercel's [Semantic Image Search](https://vercel.com/templates/next.js/semantic-image-search), at `94eaed2` |
| Reference | [rag-chatbot](https://github.com/sourceplane/rag-chatbot) — Workers AI embeddings at 768 dimensions in Supabase's pgvector through Hyperdrive, migrations, db-migrate, row-level security; [blob-starter](https://github.com/sourceplane/blob-starter) — the R2 root and a delivery route; [kv-redis-starter](https://github.com/sourceplane/kv-redis-starter) — the KV root |
| Key | `SI` |

## Read in this order

1. [design.md](design.md) — the template, how each Vercel piece maps to
   Cloudflare and Supabase, indexing on deploy, the sample images, the
   repository and the build, and the alternatives rejected.
2. [implementation-plan.md](implementation-plan.md) — the milestones.
3. [risks-and-open-questions.md](risks-and-open-questions.md) — what is not
   proven, and what was accepted.
4. [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) — what shipped, and
   every departure from the upstream template.

## Milestones

| Milestone | What it lands | Task |
|---|---|---|
| SI0 — the spec | the repository, its intent, CI, tooling and spec index; this doc set | SI-1 |
| SI1 — the image search on Workers and Supabase | the template in `apps/web`, both models on Workers AI, the indexing pass, the images in R2, the cache in KV, the schema as migrations, the Supabase, Hyperdrive, R2 and KV roots, the sample images, the tests | SI-2 |
| SI2 — a baseline | the console card, the build document, the context pack and the baseline's tests | SI-3 |
