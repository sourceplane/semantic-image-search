import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { manifest } from "@saas/db/manifest";
import { buildPlan, runMigrations } from "@saas/db/runner";

const migrationsDir = path.resolve(__dirname, "../../../packages/db/src/migrations");
const sqlOf = (rel: string) => readFileSync(path.join(migrationsDir, rel), "utf8");
// PGlite (Postgres compiled to WASM) with pgvector, the extension 010 creates.
const fresh = () => new PGlite({ extensions: { vector } });

describe("the migration manifest (packages/db)", () => {
  it("starts with the control migration and names every file with its checksum", () => {
    expect(manifest.migrations.map((m) => m.id)).toEqual([
      "000_control_baseline",
      "010_images",
      "020_row_level_security",
    ]);
    for (const entry of manifest.migrations) {
      const file = readFileSync(path.join(migrationsDir, entry.path));
      expect(createHash("sha256").update(file).digest("hex"), entry.id).toBe(entry.checksum);
    }
  });

  it("plans every migration as pending offline", async () => {
    const result = await runMigrations(manifest, { mode: "plan", migrationsDir, adapter: null });
    expect(result.failed).toBeNull();
    expect(result.applied).toEqual(manifest.migrations.map((m) => m.id));
  });

  it("skips what the database already recorded", () => {
    const applied = new Map([[manifest.migrations[0]!.id, manifest.migrations[0]!.checksum]]);
    const plan = buildPlan(manifest, applied, migrationsDir);
    expect(plan.alreadyApplied).toEqual([manifest.migrations[0]!.id]);
    expect(plan.pending.map((m) => m.id)).toEqual(manifest.migrations.slice(1).map((m) => m.id));
    expect(plan.checksumMismatches).toEqual([]);
  });
});

describe("the images table (010)", () => {
  it("is upstream's columns, the embedding at 768 dimensions, and the indexer's three", async () => {
    const db = fresh();
    await db.exec(sqlOf("010_images/up.sql"));
    const { rows } = await db.query<{ column_name: string; type: string; nullable: string }>(
      `select c.column_name, format_type(a.atttypid, a.atttypmod) as type, c.is_nullable as nullable
         from information_schema.columns c
         join pg_attribute a on a.attrelid = 'public.images'::regclass and a.attname = c.column_name
        where c.table_name = 'images' order by c.ordinal_position`,
    );
    expect(rows).toEqual([
      { column_name: "id", type: "character varying(191)", nullable: "NO" },
      { column_name: "title", type: "text", nullable: "NO" },
      { column_name: "description", type: "text", nullable: "NO" },
      { column_name: "path", type: "text", nullable: "NO" },
      { column_name: "content_hash", type: "text", nullable: "NO" },
      { column_name: "etag", type: "text", nullable: "NO" },
      { column_name: "model", type: "text", nullable: "NO" },
      { column_name: "embedding", type: "vector(768)", nullable: "NO" },
      { column_name: "created_at", type: "timestamp with time zone", nullable: "NO" },
    ]);
    const indexes = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where tablename = 'images' order by indexname",
    );
    const defs = indexes.rows.map((r) => r.indexdef).join("\n");
    expect(defs).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
    expect(defs).toMatch(/UNIQUE INDEX \S+ ON public\.images USING btree \(path\)/);
  }, 60_000);

  it("is idempotent, refuses a vector of another size, and ranks by cosine similarity", async () => {
    const db = fresh();
    await db.exec(sqlOf("010_images/up.sql"));
    await db.exec(sqlOf("010_images/up.sql"));
    const v = (hot: number) => `[${Array.from({ length: 768 }, (_, i) => (i === hot ? 1 : 0)).join(",")}]`;
    await db.query(
      `insert into images (id, title, description, path, content_hash, etag, model, embedding)
       values ('a', 'A', 'a', '/images/a.jpg', 'h1', 'e1', 'm', $1), ('b', 'B', 'b', '/images/b.jpg', 'h2', 'e2', 'm', $2)`,
      [v(0), v(1)],
    );
    await expect(
      db.query(
        `insert into images (id, title, description, path, content_hash, etag, model, embedding)
         values ('c', 'C', 'c', '/images/c.jpg', 'h3', 'e3', 'm', '[1,0,0]')`,
      ),
    ).rejects.toThrow(/expected 768 dimensions/);
    await expect(
      db.query(
        `insert into images (id, title, description, path, content_hash, etag, model, embedding)
         values ('d', 'D', 'd', '/images/a.jpg', 'h4', 'e4', 'm', $1)`,
        [v(2)],
      ),
    ).rejects.toThrow(/duplicate key value/);
    const ranked = await db.query<{ id: string; similarity: number }>(
      `select id, 1 - (embedding <=> $1) as similarity from images order by similarity desc`,
      [v(1)],
    );
    expect(ranked.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(ranked.rows[0]!.similarity).toBeCloseTo(1);
  }, 60_000);
});
