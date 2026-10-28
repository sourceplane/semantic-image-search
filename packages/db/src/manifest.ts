import type { MigrationManifest } from "./types.js";

// Every migration the runner applies, in order, with the sha256 of its file.
// `pnpm --filter @saas/db run manifest:check` verifies the checksums;
// `manifest:fix` rewrites them after a migration file changes (only ever
// before that migration has been applied anywhere — an applied migration's
// checksum is immutable).
export const manifest: MigrationManifest = {
  version: 1,
  migrations: [
    {
      id: "000_control_baseline",
      context: "control",
      path: "000_control/up.sql",
      checksum:
        "2a5d7f30684c99e3ff441ca8a2c38038dedd1bab4db4a40e92cd36bb22be297f",
      description:
        "Baseline control migration — creates the migration tracking schema",
    },
    {
      id: "010_images",
      context: "app",
      path: "010_images/up.sql",
      checksum: 
        "d40a6b97c5e285c6054f377fcc92808f7f2ab10cd4bc254d500d97de01be3362",
      description:
        "pgvector and the images table: upstream's columns, the embedding at Workers AI's 768 dimensions with its HNSW cosine index, and the indexer's path (unique), content_hash, etag and model",
    },
    {
      id: "020_row_level_security",
      context: "app",
      path: "020_row_level_security/up.sql",
      checksum: 
        "249e956e70c6bdb7df68238ddd1d513a7c8ba9742a69bda49ac1df430abced22",
      description:
        "Row-level security on every table in public (images) — closed to Supabase's Data API (anon, authenticated), open to the app, which owns it; refuses to run if the app's role would be locked out",
    },
  ],
};
