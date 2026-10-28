import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Upstream allow-listed its own Vercel Blob store's host for next/image's
  // optimizer. The images are the Worker's own now — served from the R2
  // bucket at /images/<name> (app/images/[...key]/route.ts) — and Next's
  // optimizer needs sharp, a native addon a Worker cannot load, so next/image
  // renders them as they are.
  images: { unoptimized: true },
  // Required by @opennextjs/cloudflare, which bundles `.next/standalone/**`
  // into the Worker; traced from the monorepo root so workspace dependencies
  // resolve from the root node_modules.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

// `next dev` reaches the Worker's bindings through wrangler's platform proxy
// (apps/web/wrangler.jsonc, committed): HYPERDRIVE on the Postgres its
// localConnectionString names, IMAGES and CACHE on wrangler's local R2 and
// KV, and AI — Workers AI, which has no local mode — on your Cloudflare
// account, so `wrangler login` once. Only under `next dev`: the proxy would
// open that remote session at `next build` too, and the build touches no
// binding (the page renders per request), so it must not need a Cloudflare
// credential.
export default function config(phase) {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    initOpenNextCloudflareForDev();
  }
  return nextConfig;
}
