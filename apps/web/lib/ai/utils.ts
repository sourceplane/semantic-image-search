import { embedText } from "./models";

// Upstream's query embedding (lib/ai/utils.ts's generateEmbedding): newlines
// folded to spaces, then embedded — with Workers AI's model now
// (lib/ai/models.ts), the one the images were embedded with.
export const generateEmbedding = async (value: string): Promise<number[]> => {
  const input = value.replaceAll("\n", " ");
  return embedText(input);
};
