// Where the images live: the R2 bucket bound as IMAGES (upstream: a Vercel
// Blob store), one object per image under `images/`, served by the Worker at
// the same path (app/images/[...key]/route.ts). An image's `path` in the
// database is that URL, as upstream's was its Blob URL.
export const IMAGE_PREFIX = "images/";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** The image type of an object key, or null for a key that is not an image. */
export function imageType(key: string): string | null {
  const dot = key.lastIndexOf(".");
  return dot < 0 ? null : (TYPES[key.slice(dot).toLowerCase()] ?? null);
}

/** The URL an R2 key is served at on this Worker. */
export const pathOf = (key: string): string => `/${key}`;
