# semantic-image-search — open risks

What is not yet proven or not yet decided. The full write-up of every risk,
including the accepted ones, is
`specs/epics/semantic-image-search/risks-and-open-questions.md`; this page lists only
what is still live, so it should be short.

| ID | Risk | State | What closes it |
|---|---|---|---|
| SI-A | `baseline-v1` is not yet proven live | OPEN | A bootstrap against a workspace with Cloudflare (R2 enabled) and Supabase connected |
| SI-B | The models are verified only against a stand-in: what Llama 4 Scout writes for the samples in JSON mode, and how BGE ranks a real search against the 0.5 similarity bar | OPEN | Searching the deployed Worker; the bar is one constant (`lib/db/api.ts`) |
| SI-C | The R2 and KV roots, the `r2-data` mint and the `AI` binding under the brokered deploy token have not run together in one product | OPEN | The first bootstrap's convergence |

Accepted, and worth knowing before you change them: SI-D (`/api/index` is
open — it describes only the environment's own bucket, and nothing it has
seen), SI-E (two Supabase projects per product — the organization needs room
for both), SI-F (a sample the list names is put back by the next pass).
