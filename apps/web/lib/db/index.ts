import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Not upstream's. Upstream opened one @vercel/postgres pool at module scope
// (`drizzle(sql)`). On Cloudflare the database is the HYPERDRIVE binding's
// (Hyperdrive pools the real Postgres connections at the edge), and a socket
// opened in one request cannot be used by another ("Cannot perform I/O on
// behalf of a different request"), so each call builds its own client,
// hands drizzle to the caller, and closes it.
//
// Without a Cloudflare context — tests, scripts — DATABASE_URL is the
// connection string. `next dev` has the context (initOpenNextCloudflareForDev
// in next.config.mjs) and so uses the binding's localConnectionString from
// wrangler.jsonc.
async function connectionString(): Promise<string> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    if (env.HYPERDRIVE?.connectionString) {
      return env.HYPERDRIVE.connectionString;
    }
  } catch {
    // Not running under OpenNext: fall through to DATABASE_URL.
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set and no HYPERDRIVE binding is available");
  }
  return url;
}

export type Db = PostgresJsDatabase;

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  // Hyperdrive pools on its side; a Worker request holds few connections,
  // skips the pg_types round trip and sends plain (unprepared) statements.
  const client = postgres(await connectionString(), {
    max: 5,
    fetch_types: false,
    prepare: false,
  });
  try {
    return await fn(drizzle(client));
  } finally {
    await client.end({ timeout: 5 });
  }
}
