import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";

// Not upstream's. Upstream called OpenAI through the AI SDK: GPT-4o wrote each
// image's title and description (lib/ai/1-generate-metadata.ts) and
// text-embedding-3-small embedded them and every query (1536 dimensions).
// Here both models are Workers AI's, through the Worker's `AI` binding
// (wrangler.jsonc): the Cloudflare account the app deploys into is the whole
// AI vendor, so a fresh deploy indexes and searches with no key of anyone
// else's.
//
//   vision      Llama 4 Scout — natively multimodal on Workers AI — in JSON
//               mode, with upstream's prompt and upstream's schema (an
//               artistic title and a one-sentence description).
//   embeddings  BGE base en v1.5, 768 dimensions — the size of the
//               `images.embedding` column (migration 010). Changing the model
//               is a migration AND a re-index of every image: vectors from
//               two models do not share a space, even at the same size. That
//               is also why there is no OpenAI option: a query embedded by one
//               model cannot be compared with images embedded by another.
export const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;

export class AiNotConfiguredError extends Error {
  constructor() {
    super("Workers AI is not available: the Worker has no AI binding (wrangler.jsonc)");
    this.name = "AiNotConfiguredError";
  }
}

async function aiBinding(): Promise<Ai> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    if (env.AI) return env.AI;
  } catch {
    // Not running under OpenNext (a script, a test): no binding.
  }
  throw new AiNotConfiguredError();
}

// Upstream's generateObject schema, verbatim: `{ image: { title, description } }`.
export const metadataSchema = z.object({
  image: z.object({
    title: z.string().min(1).describe("an artistic title for the image"),
    description: z.string().min(1).describe("A one sentence description of the image"),
  }),
});
export type ImageMetadata = z.infer<typeof metadataSchema>["image"];

// The same schema as JSON Schema, for Workers AI's JSON mode.
const METADATA_JSON_SCHEMA = {
  type: "object",
  properties: {
    image: {
      type: "object",
      properties: {
        title: { type: "string", description: "an artistic title for the image" },
        description: { type: "string", description: "A one sentence description of the image" },
      },
      required: ["title", "description"],
    },
  },
  required: ["image"],
};

// Upstream's prompt (lib/ai/1-generate-metadata.ts).
export const VISION_PROMPT = "Describe the image in detail.";

/** A vision model's title and description for one image's bytes. */
export async function describeImage(bytes: ArrayBuffer, contentType: string): Promise<ImageMetadata> {
  const ai = await aiBinding();
  const url = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  const out = (await ai.run(VISION_MODEL as keyof AiModels, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          { type: "image_url", image_url: { url } },
        ],
      },
    ],
    response_format: { type: "json_schema", json_schema: METADATA_JSON_SCHEMA },
    max_tokens: 512,
  } as never)) as { response?: unknown };
  // JSON mode answers the object itself; some models answer it as a string.
  const response = typeof out?.response === "string" ? JSON.parse(out.response) : out?.response;
  return metadataSchema.parse(response).image;
}

/** One text's embedding, `EMBEDDING_DIMENSIONS` wide. */
export async function embedText(value: string): Promise<number[]> {
  const ai = await aiBinding();
  const out = (await ai.run(EMBEDDING_MODEL as keyof AiModels, { text: [value] } as never)) as {
    data?: number[][];
  };
  const vector = out?.data?.[0];
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `${EMBEDDING_MODEL} answered a vector of ${Array.isArray(vector) ? vector.length : "no"} dimensions, not ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return vector;
}
