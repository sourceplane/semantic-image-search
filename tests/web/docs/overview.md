# web-tests

The app's tests (the models on Workers AI, the indexer over the real schema with R2 in memory, the search and its KV cache, the image, health and index routes, the sample images, the wrangler config and its wiring, the name seam and the origin; vitest, PGlite with pgvector)

The test suite for **web**. It deploys nothing: its lane installs, builds and runs the tests.

|              |                      |
| ------------ | -------------------- |
| Type         | `turbo-package`      |
| Source       | `tests/web`          |
| Package      | `@app/web-tests`     |
| Environments | `dev`: `quick-check` |

## Depends on

- (none)

## Depended on by

- (none)
