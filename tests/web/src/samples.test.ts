import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { SAMPLE_IMAGES } from "@/lib/samples";

// The sample images a fresh deployment indexes: shipped as the Worker's
// static assets (public/samples/), seeded into R2 by the indexer from the
// list in lib/samples.ts — which must name exactly what is there.
const samples = path.resolve(__dirname, "../../../apps/web/public/samples");

describe("the sample images (public/samples, lib/samples.ts)", () => {
  it("lists every image in the directory, and nothing else", () => {
    const files = readdirSync(samples).filter((f) => f !== "README.md").sort();
    expect([...SAMPLE_IMAGES].sort()).toEqual(files);
    expect(files.length).toBe(12);
  });

  it("is twelve small JPEGs, none of them carrying EXIF", () => {
    for (const name of SAMPLE_IMAGES) {
      const bytes = readFileSync(path.join(samples, name));
      expect([bytes[0], bytes[1], bytes[2]], name).toEqual([0xff, 0xd8, 0xff]);
      expect(bytes.length, name).toBeLessThan(64 * 1024);
      expect(bytes.includes(Buffer.from("Exif\0")), name).toBe(false);
    }
  });

  it("says where they come from and what licence they carry", () => {
    const readme = readFileSync(path.join(samples, "README.md"), "utf8");
    expect(readme).toMatch(/drawn for this baseline/);
    expect(readme).toMatch(/Apache License 2\.0/);
  });
});
