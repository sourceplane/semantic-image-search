#!/usr/bin/env node
// Applies packages/db's migrations, in the manifest's order, to a LOCAL
// Postgres — the database `next dev` and `wrangler dev` reach through the
// HYPERDRIVE binding's localConnectionString (apps/web/wrangler.jsonc). On
// stage and prod, db-migrate applies them; this is for working locally.
//
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/images \
//     node tooling/migrations/apply-local.mjs
//
// (`pnpm --filter @app/web db:migrate:local` runs it.) Every migration is
// idempotent, so applying them again changes nothing. Needs `psql`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const db = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/db/src");

/** The migration files, in the order packages/db/src/manifest.ts lists them. */
export function migrationFiles() {
  const manifest = readFileSync(resolve(db, "manifest.ts"), "utf8");
  return [...manifest.matchAll(/path:\s*"([^"]+)"/g)].map((m) => resolve(db, "migrations", m[1]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("apply-local: set DATABASE_URL to the local Postgres (apps/web/.env.example)");
    process.exit(2);
  }
  for (const file of migrationFiles()) {
    execFileSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
    console.log(`apply-local: ${file.slice(db.length + "/migrations/".length)}`);
  }
}
