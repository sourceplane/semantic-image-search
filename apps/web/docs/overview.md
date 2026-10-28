# web

Vercel's Semantic Image Search (Next.js on Cloudflare Workers + Static Assets via @opennextjs/cloudflare, Workers AI describing and embedding the images, pgvector on Supabase through Hyperdrive, the images in R2 and the search cache in KV, per environment)

A Cloudflare Worker with Static Assets (server rendering plus static files), deployed per environment by its CI lane.

|              |                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Type         | `cloudflare-workers-assets-turbo`                                                                                  |
| Source       | `apps/web`                                                                                                         |
| Package      | `@app/web`                                                                                                         |
| Environments | `dev`: `verify` · `stage`: `verify`, `deploy` on a push to `main` · `prod`: `verify`, `deploy` on a push to `main` |

## Depends on

- **cloudflare-hyperdrive** — Provisions Cloudflare Hyperdrive resources for stage and prod Supabase Postgres databases
- **db-migrate** — Applies database migrations to stage and prod Supabase instances
- **cloudflare-r2** — Provisions the Cloudflare R2 bucket the app binds (stage and prod)
- **cloudflare-kv** — Provisions the Cloudflare KV namespace the app binds (stage and prod)

## Depended on by

- (none)
