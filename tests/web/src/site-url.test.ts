import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

// The page's Open Graph image link is absolute, resolved against the layout's
// `metadataBase`. Upstream built it from VERCEL_URL, so it was undefined
// anywhere else. Here the origin is NEXT_PUBLIC_SITE_URL, which the deploy's
// build sets to the environment's own Worker URL (component.yaml).
const app = path.resolve(__dirname, "../../../apps/web");

describe("the page's public origin (lib/site.ts, app/layout.tsx)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is NEXT_PUBLIC_SITE_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://acme-images-web-stage.acme.workers.dev");
    const { siteUrl } = await import("@/lib/site");
    expect(String(siteUrl())).toBe("https://acme-images-web-stage.acme.workers.dev/");
  });

  it("is localhost without it, and never upstream's demo", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined as unknown as string);
    const { siteUrl } = await import("@/lib/site");
    expect(String(siteUrl())).toBe("http://localhost:3000/");
    for (const file of ["app/layout.tsx", "lib/site.ts"]) {
      expect(readFileSync(path.join(app, file), "utf8"), file).not.toMatch(/vercel\.app/);
    }
  });

  it("is what the layout's metadata is built on, with the site's name as the title", () => {
    const layout = readFileSync(path.join(app, "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/metadataBase: siteUrl\(\),/);
    expect(layout).toMatch(/title: SITE_NAME,/);
  });

  it("is set by the deploy's build to this environment's Worker URL", () => {
    // Read off component.yaml itself — the worker name and subdomain are the
    // product's, whatever it is called.
    const component = readFileSync(path.join(app, "component.yaml"), "utf8");
    const workerName = /^\s*workerName:\s*(\S+)\s*$/m.exec(component)?.[1];
    const subdomain = /^\s*workersDevSubdomain:\s*(\S+)\s*$/m.exec(component)?.[1];
    expect(workerName && subdomain).toBeTruthy();
    const build = /^\s*buildCommand:\s*(.+)$/m.exec(component)?.[1] ?? "";
    expect(build).toContain(
      `NEXT_PUBLIC_SITE_URL="\${SITE_URL:-https://${workerName}-\${ORUN_ENVIRONMENT}.${subdomain}.workers.dev}" pnpm exec turbo run build`,
    );
  });
});

describe("the site's name and source link (lib/site.ts)", () => {
  it("is one seam the page's heading reads too, where upstream spelled it twice", () => {
    const page = readFileSync(path.join(app, "app/page.tsx"), "utf8");
    expect(page).toContain("{SITE_NAME}");
    expect(page).not.toMatch(/Semantic Search<|Semantic Image Search Demo/);
  });

  it("links to this product's own repository, not Vercel's deploy button", async () => {
    const { SOURCE_URL } = await import("@/lib/site");
    expect(SOURCE_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    const page = readFileSync(path.join(app, "app/page.tsx"), "utf8");
    expect(page).toContain("<SourceLink />");
    expect(page).not.toMatch(/DeployButton|vercel\.com/);
    const link = readFileSync(path.join(app, "components/source-link.tsx"), "utf8");
    expect(link).toContain("href={SOURCE_URL}");
  });
});
