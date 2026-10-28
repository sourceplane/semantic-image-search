import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// apps/web's wrangler.jsonc is COMMITTED: the composition checks that it
// exists before the build, in a fresh checkout, so it cannot be a file a build
// generates. It is the render of wrangler.template.jsonc from
// wiring.fixture.json, and the stage and prod deploy lanes re-render it from
// their live wiring documents (apps/web/component.yaml's buildCommand). These
// hold the committed file to the template, the live render to the documents it
// is given, and both to the bindings the app reads: the database, the images'
// bucket, the search cache and Workers AI.
const app = path.resolve(__dirname, "../../../apps/web");
const wire = path.resolve(__dirname, "../../../tooling/wire");

function renderFixture(env: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wire-"));
  try {
    const out = path.join(dir, "wrangler.jsonc");
    execFileSync(process.execPath, [
      path.join(wire, "render.mjs"),
      "--template", path.join(app, "wrangler.template.jsonc"),
      "--out", out,
      "--map", path.join(app, "wiring.fixture.json"),
      "--env", env,
    ]);
    return readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// JSONC → JSON: wrangler's comments are whole lines or trail a value, and no
// string in these files contains `//`.
function parse(jsonc: string): Record<string, unknown> {
  const json = jsonc
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
  return JSON.parse(json);
}

describe("apps/web wrangler config", () => {
  it("is committed as the fixture render of the template (pnpm run wire:fixture)", () => {
    expect(readFileSync(path.join(app, "wrangler.jsonc"), "utf8")).toBe(renderFixture("stage"));
  });

  it("keeps every resource id in the template a wiring token", () => {
    const template = readFileSync(path.join(app, "wrangler.template.jsonc"), "utf8");
    expect(template).not.toMatch(/"id":\s*"[0-9a-f]{32}"/);
    expect(template).toMatch(/@@wiring\(cloudflare-hyperdrive\/__ENV__:hyperdrive_id\)@@/);
    expect(template).toMatch(/@@wiring\(cloudflare-r2\/__ENV__:r2_bucket_name\)@@/);
    expect(template).toMatch(/@@wiring\(cloudflare-kv\/__ENV__:app_kv_id\)@@/);
  });

  it("binds the database, the bucket, the cache and Workers AI, and no var at all", () => {
    const config = parse(readFileSync(path.join(app, "wrangler.jsonc"), "utf8"));
    expect(config.ai).toEqual({ binding: "AI" });
    expect(config.hyperdrive).toEqual([expect.objectContaining({ binding: "HYPERDRIVE" })]);
    expect(config.r2_buckets).toEqual([
      { binding: "IMAGES", bucket_name: "stg-semantic-image-search-stage" },
    ]);
    expect(config.kv_namespaces).toEqual([{ binding: "CACHE", id: "0".repeat(31) + "1" }]);
    expect(config.vars).toBeUndefined();
  });

  it("names every binding the app's code reads (cloudflare-env.d.ts)", () => {
    const types = readFileSync(path.join(app, "cloudflare-env.d.ts"), "utf8");
    for (const binding of ["HYPERDRIVE: Hyperdrive", "IMAGES: R2Bucket", "CACHE: KVNamespace", "AI: Ai", "ASSETS: Fetcher"]) {
      expect(types).toContain(binding);
    }
  });

  it("renders a deploy lane its own environment from the live wiring document", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wire-"));
    try {
      const out = path.join(dir, "wrangler.jsonc");
      execFileSync(
        process.execPath,
        [
          path.join(wire, "live.mjs"),
          "--template", path.join(app, "wrangler.template.jsonc"),
          "--out", out,
          "--components", "cloudflare-hyperdrive,cloudflare-r2,cloudflare-kv",
          "--env", "prod",
        ],
        {
          env: {
            ...process.env,
            WIRING_CLOUDFLARE_HYPERDRIVE_PROD: JSON.stringify({
              hyperdrive_id: "f".repeat(32),
              hyperdrive_name: "prod-x-prod",
            }),
            WIRING_CLOUDFLARE_R2_PROD: JSON.stringify({ r2_bucket_name: "prod-x-prod" }),
            WIRING_CLOUDFLARE_KV_PROD: JSON.stringify({ app_kv_id: "e".repeat(32) }),
          },
        },
      );
      const rendered = readFileSync(out, "utf8");
      expect(rendered).not.toContain("__ENV__");
      expect(rendered).not.toContain("@@wiring");
      const config = parse(rendered);
      expect(config.hyperdrive).toEqual([expect.objectContaining({ id: "f".repeat(32) })]);
      expect(config.r2_buckets).toEqual([{ binding: "IMAGES", bucket_name: "prod-x-prod" }]);
      expect(config.kv_namespaces).toEqual([{ binding: "CACHE", id: "e".repeat(32) }]);
      expect(config.ai).toEqual({ binding: "AI" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a deploy render with no wiring document", () => {
    const env = { ...process.env };
    delete env.WIRING_CLOUDFLARE_HYPERDRIVE_STAGE;
    env.WIRING_CLOUDFLARE_R2_STAGE = JSON.stringify({ r2_bucket_name: "stg-x-stage" });
    env.WIRING_CLOUDFLARE_KV_STAGE = JSON.stringify({ app_kv_id: "e".repeat(32) });
    expect(() =>
      execFileSync(
        process.execPath,
        [
          path.join(wire, "live.mjs"),
          "--template", path.join(app, "wrangler.template.jsonc"),
          "--out", path.join(tmpdir(), "never-written.jsonc"),
          "--components", "cloudflare-hyperdrive,cloudflare-r2,cloudflare-kv",
          "--env", "stage",
        ],
        { env, stdio: "pipe" },
      ),
    ).toThrow();
  });
});
