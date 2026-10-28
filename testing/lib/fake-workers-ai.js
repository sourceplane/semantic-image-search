// A stand-in for Workers AI, for `wrangler dev` with no Cloudflare account.
//
// Workers AI has no local mode: the AI binding always calls the account, and
// the e2e has none. So the e2e binds `AI` to THIS Worker instead — a service
// binding to its default entrypoint, whose `run(model, inputs, options)` is
// reached over RPC exactly as the real binding's is — and the app's own code
// (lib/ai/models.ts) cannot tell the difference in shape. What it answers is
// deterministic, not intelligent, and that is the point: the e2e asserts the
// app's path end to end, so every answer must be predictable.
//
//   @cf/meta/llama-4-scout-17b-16e-instruct, in JSON mode ONLY, with ONE
//   image as a base64 data URI in the user message — the app's one vision
//   call (describeImage). It answers `{ image: { title, description } }` from
//   ./descriptions.json, keyed by the sha256 of the image's decoded bytes,
//   which the e2e writes from testing/fixtures/sample-descriptions.json — so
//   an image reaches it whole or is not recognised. An image it does not
//   know is refused, as is a call without `response_format` or a stream.
//
//   @cf/baai/bge-base-en-v1.5, `{ text: [...] }` → `{ shape, data }`, 768
//   numbers per text: a bag of the text's content words, each hashed (FNV-1a)
//   into one of 768 dimensions, normalised — so two texts are as similar as
//   the words they share, and a search for words an image's description has
//   finds it, while one for words none has finds nothing.
//
// Every call is logged as one `fake-workers-ai {…}` line, which the e2e reads
// back from wrangler's output.
import { WorkerEntrypoint } from "cloudflare:workers";
import DESCRIPTIONS from "./descriptions.json";

const VISION = "@cf/meta/llama-4-scout-17b-16e-instruct";
const EMBEDDING = "@cf/baai/bge-base-en-v1.5";
const DIMENSIONS = 768;
const STOP = new Set(
  "a an and the of on in at by to with for from under over above across up its is are".split(" "),
);

function embed(text) {
  const v = new Array(DIMENSIONS).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z]+/g) ?? []) {
    if (STOP.has(word)) continue;
    let h = 2166136261;
    for (const c of word) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    v[h % DIMENSIONS] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

async function sha256(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const log = (entry) => console.log(`fake-workers-ai ${JSON.stringify(entry)}`);
const refuse = (entry, why) => {
  log({ ...entry, refused: why });
  throw new Error(`fake Workers AI: ${why}`);
};

export default class FakeWorkersAi extends WorkerEntrypoint {
  async run(model, inputs, _options) {
    if (model === EMBEDDING) {
      const texts = inputs?.text;
      if (!Array.isArray(texts) || texts.length === 0) refuse({ model, kind: "embed" }, "no text to embed");
      log({ model, kind: "embed", texts });
      return { shape: [texts.length, DIMENSIONS], data: texts.map(embed) };
    }
    if (model !== VISION) refuse({ model }, "unknown model");
    const entry = { model, kind: "describe" };
    if (inputs?.stream) refuse(entry, "the app asked to stream; the app's vision call is whole");
    if (inputs?.response_format?.type !== "json_schema") refuse(entry, "not JSON mode");
    const messages = inputs.messages ?? [];
    const parts = messages.filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const images = parts.filter((p) => p?.type === "image_url");
    const prompt = parts.filter((p) => p?.type === "text").map((p) => p.text).join("");
    if (images.length !== 1) refuse(entry, `want one image in the user message, got ${images.length}`);
    const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(images[0].image_url?.url ?? "");
    if (!m) refuse(entry, "the image is not a base64 data URI");
    const hash = await sha256(m[2]);
    const known = DESCRIPTIONS[hash];
    const schema = Object.keys(inputs.response_format.json_schema?.properties ?? {});
    if (!known) refuse({ ...entry, hash }, "an image it was not given a description for");
    log({ ...entry, hash, contentType: m[1], name: known.name, prompt, schema, roles: messages.map((x) => x.role) });
    return {
      response: { image: { title: known.title, description: known.description } },
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  async fetch() {
    return new Response("a stand-in for Workers AI; bind it as AI and call run()", { status: 404 });
  }
}
