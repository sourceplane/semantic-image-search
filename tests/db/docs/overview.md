# db-tests

The migrations' tests (the manifest and its checksums, the images table with pgvector at 768 dimensions, row-level security on every table in public and its guard; vitest on PGlite with pgvector)

The test suite for **db**. It deploys nothing: its lane installs, builds and runs the tests.

|              |                      |
| ------------ | -------------------- |
| Type         | `turbo-package`      |
| Source       | `tests/db`           |
| Package      | `@app/db-tests`      |
| Environments | `dev`: `quick-check` |

## Depends on

- (none)

## Depended on by

- (none)
