import { getCloudflareContext } from "@opennextjs/cloudflare";
import { IMAGE_PREFIX, imageType } from "@/lib/storage";

// Not upstream's: upstream's images were public Vercel Blob URLs. Here they
// are objects in the R2 bucket bound as IMAGES, served by the Worker at the
// path the database stores (/images/<name>) — only image objects under
// images/, nothing else in the bucket.
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const name = key.map(decodeURIComponent).join("/");
  if (!name || name.split("/").some((part) => part === ".." || part === "") || !imageType(name)) {
    return new Response("Not found", { status: 404 });
  }
  const { env } = await getCloudflareContext({ async: true });
  const object = await env.IMAGES.get(IMAGE_PREFIX + name, { onlyIf: request.headers });
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  if (!headers.get("content-type")) headers.set("content-type", imageType(name)!);
  // A conditional request the object did not change for: no body.
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}
