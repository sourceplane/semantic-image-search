// The bindings wrangler.template.jsonc gives the Worker, as seen through
// `getCloudflareContext().env` from @opennextjs/cloudflare (which types `env`
// as the global `CloudflareEnv` interface for the app to augment). Regenerate
// with `wrangler types --env-interface CloudflareEnv` after changing the
// bindings.
/// <reference types="@cloudflare/workers-types" />
interface CloudflareEnv {
  HYPERDRIVE: Hyperdrive;
  IMAGES: R2Bucket;
  CACHE: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
}
