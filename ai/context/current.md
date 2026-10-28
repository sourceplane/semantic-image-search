# semantic-image-search — where this repository stands

The entry page for anyone (or any agent) picking this repository up. It is
this repository's own state and does not ship to a product built from it; the
two pages that do are [operations.md](operations.md) and
[deployment.md](deployment.md).

## What it is

Vercel's Semantic Image Search (`semantic-image-search`) on Cloudflare
Workers + Static Assets through `@opennextjs/cloudflare`: a page of images
searched by what they show — each image titled and described by a vision
model, the description embedded, a search embedded and ranked by cosine
similarity in pgvector beside a plain text match. The images are in an R2
bucket the Worker serves, the searches cached in Workers KV, the vectors in
a Supabase project's Postgres reached through Hyperdrive, and both models
Workers AI's, through the Worker's `AI` binding. Packaged as an Orun
baseline: `orun new --blueprint repo-blueprint.yaml` builds a new product in
its own repository and takes it to live on stage and prod in one landing
(`01-product`) — the Supabase project, the Hyperdrive config, the
migrations, the bucket and the namespace, then the Worker, whose deploy
smoke indexes its twelve sample images — and records what went live
(`02-docs`). No AI vendor key.

## Release

| | |
|---|---|
| Latest tag | `baseline-v1` (SI1) |
| Proven live | No. Everything short of the platform is proven offline in Baseline CI, with stand-ins for Workers AI and Supabase's Management API. The real models, a deploy with the brokered token and its `AI` binding, the Terraform applies (the R2 bucket among them) and db-migrate's, and a live bootstrap are still to come (risks SI-A, SI-B, SI-C) |

## Where to read

| Question | Page |
|---|---|
| What shipped, and every departure from upstream | `specs/epics/semantic-image-search/IMPLEMENTATION-STATUS.md` |
| Why it is built this way | [decisions.md](decisions.md), then `specs/epics/semantic-image-search/design.md` |
| What could still go wrong | [open-risks.md](open-risks.md), then `specs/epics/semantic-image-search/risks-and-open-questions.md` |
| How to instantiate it | `BOOTSTRAP.md`, `docs/phases/` |
| What each component is | `docs/` beside each `component.yaml` — `apps/web`, `packages/db`, `infra/db-migrate`, `infra/terraform/{supabase,cloudflare-hyperdrive,cloudflare-r2,cloudflare-kv}`, `tests/{web,db}` (generated; `python3 tooling/catalog/gen-component-docs.py`) |

## Next

1. Bootstrap one product from `baseline-v1` against a workspace with
   Cloudflare (R2 enabled) and Supabase connected (two free project slots,
   SI-E): the first run of the real models and of the `AI` binding under the
   brokered deploy token, the first Terraform and db-migrate applies, and the
   first search a real embedding model ranks (closes SI-A, SI-B, SI-C).
