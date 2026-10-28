import { indexImages } from "@/lib/ai/index-images";

// Not upstream's: upstream's three indexing scripts as one idempotent pass
// (lib/ai/index-images.ts), on the Worker's own bindings. Every deploy's
// smoke step POSTs here until nothing remains (apps/web/component.yaml); you
// may too, after adding images to the bucket. An image already indexed costs
// no model call, so a POST with nothing new does no work worth abusing; it
// only ever describes what is in this deployment's own bucket.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const result = await indexImages(new URL(request.url).origin);
    return Response.json(result, {
      status: result.ok ? 200 : 500,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("index: the pass failed", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
