import { sql } from "drizzle-orm";
import { withDb } from "@/lib/db";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/models";

// Not upstream's: the deploy's smoke check and the bootstrap's probe read
// this. A page that renders proves the Worker deployed; this proves what a
// search needs and the page never shows until somebody searches — the
// HYPERDRIVE binding names a real config, Hyperdrive reaches the Supabase
// database, db-migrate applied the schema (the images table, its embedding
// column at the embedding model's size) — and how many images are indexed.
// It calls no model.
export const dynamic = "force-dynamic";

// drizzle's execute() answers postgres-js's row list, or `{ rows }` on other
// drivers (the tests' PGlite).
const rowsOf = <T,>(result: unknown): T[] =>
  (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];

export async function GET() {
  try {
    return await withDb(async (db) => {
      const [row] = rowsOf<{ dims: number | null }>(
        await db.execute(
          sql`select (select a.atttypmod from pg_attribute a
                       where a.attrelid = to_regclass('public.images') and a.attname = 'embedding') as dims`,
        ),
      );
      const migrated = row?.dims === EMBEDDING_DIMENSIONS;
      const images = migrated
        ? (rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from images`))[0]?.n ?? 0)
        : 0;
      return Response.json(
        { ok: migrated, database: "reachable", schema: migrated ? "migrated" : "missing", images },
        { status: migrated ? 200 : 503, headers: { "cache-control": "no-store" } },
      );
    });
  } catch (error) {
    console.error("health: database check failed", error);
    return Response.json(
      { ok: false, database: "unreachable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
