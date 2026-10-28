# Epics

Orun-style work programs. Each epic is a folder carrying `epic.yaml` (the
declaration the platform reads: slug, key prefix, milestones with exit
criteria and task keys) beside its doc set. The pull request that adds the
folder is the adoption; the merge creates the epic in the workspace.

| Epic | Cluster | Status | What it is |
|------|---------|--------|------------|
| [`semantic-image-search/`](./semantic-image-search/) | **SI** | In progress (SI0) | Vercel's Semantic Image Search — images found by what they show — on Cloudflare Workers with Workers AI, R2, Workers KV and Supabase pgvector through Hyperdrive, indexed by its own deploy, and an Orun baseline that instantiates it in one landing (SI2) |

As-built ≠ intent: what shipped lives in each epic's `IMPLEMENTATION-STATUS.md`.
