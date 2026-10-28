import { defineConfig } from "vitest/config";
import * as path from "node:path";

const app = path.resolve(__dirname, "../../apps/web");

export default defineConfig({
  resolve: {
    alias: {
      "@": app,
      // The app's own copy, so a test's vi.mock("@opennextjs/cloudflare")
      // replaces the module the app imports: pnpm installs the adapter once
      // per set of peers (Next.js among them), and this package has none.
      "@opennextjs/cloudflare": path.join(app, "node_modules/@opennextjs/cloudflare"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
