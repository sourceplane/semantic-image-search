import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/ai/models.ts: both models are Workers AI's, through the AI binding —
// the vision model in JSON mode with upstream's prompt and schema, the
// embedding model at the column's 768 dimensions.
const getCloudflareContext = vi.fn();
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));

const run = vi.fn();
const withAi = () => getCloudflareContext.mockResolvedValue({ env: { AI: { run } } });

describe("lib/ai/models.ts", () => {
  beforeEach(() => {
    run.mockReset();
    getCloudflareContext.mockReset();
  });

  it("asks Llama 4 Scout to describe the image, in JSON mode, with upstream's prompt", async () => {
    withAi();
    run.mockResolvedValue({ response: { image: { title: "Orbit", description: "A red planet." } } });
    const { describeImage, VISION_MODEL, VISION_PROMPT } = await import("@/lib/ai/models");
    const bytes = new TextEncoder().encode("jpeg bytes").buffer as ArrayBuffer;
    expect(await describeImage(bytes, "image/jpeg")).toEqual({ title: "Orbit", description: "A red planet." });
    expect(VISION_MODEL).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    const [model, inputs] = run.mock.calls[0]!;
    expect(model).toBe(VISION_MODEL);
    expect(inputs.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from("jpeg bytes").toString("base64")}` } },
        ],
      },
    ]);
    expect(VISION_PROMPT).toBe("Describe the image in detail.");
    expect(inputs.response_format.type).toBe("json_schema");
    expect(inputs.response_format.json_schema.properties.image.required).toEqual(["title", "description"]);
    expect(inputs.stream).toBeUndefined();
  });

  it("reads JSON mode's answer when it comes back as a string, and refuses one without a title", async () => {
    withAi();
    run.mockResolvedValueOnce({ response: JSON.stringify({ image: { title: "T", description: "D" } }) });
    run.mockResolvedValueOnce({ response: { image: { description: "no title" } } });
    const { describeImage } = await import("@/lib/ai/models");
    const bytes = new ArrayBuffer(4);
    expect(await describeImage(bytes, "image/png")).toEqual({ title: "T", description: "D" });
    await expect(describeImage(bytes, "image/png")).rejects.toThrow();
  });

  it("embeds with BGE base at 768 dimensions, and refuses a vector of another size", async () => {
    withAi();
    const v = Array.from({ length: 768 }, (_, i) => i / 768);
    run.mockResolvedValueOnce({ shape: [1, 768], data: [v] });
    run.mockResolvedValueOnce({ shape: [1, 1536], data: [new Array(1536).fill(0)] });
    const { embedText, EMBEDDING_MODEL } = await import("@/lib/ai/models");
    expect(await embedText("a red bicycle")).toEqual(v);
    expect(run.mock.calls[0]).toEqual([EMBEDDING_MODEL, { text: ["a red bicycle"] }]);
    expect(EMBEDDING_MODEL).toBe("@cf/baai/bge-base-en-v1.5");
    await expect(embedText("x")).rejects.toThrow(/1536 dimensions, not 768/);
  });

  it("says so when the Worker has no AI binding", async () => {
    getCloudflareContext.mockRejectedValue(new Error("no context"));
    const { embedText, AiNotConfiguredError } = await import("@/lib/ai/models");
    await expect(embedText("x")).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it("folds newlines in a query before embedding it, as upstream did", async () => {
    withAi();
    run.mockResolvedValue({ data: [new Array(768).fill(0)] });
    const { generateEmbedding } = await import("@/lib/ai/utils");
    await generateEmbedding("tasty\nfood");
    expect(run.mock.calls[0]![1]).toEqual({ text: ["tasty food"] });
  });
});
