// The sample images a fresh deployment indexes, shipped with the Worker as
// static assets (public/samples/) and seeded into the R2 bucket by the
// indexer (lib/ai/index-images.ts). Upstream shipped none: its scripts read a
// git-ignored `images-to-index/` directory of your own. These twelve were
// drawn for this baseline (public/samples/README.md) and are licensed with
// it. tests/web checks this list against the directory.
export const SAMPLE_IMAGES = [
  "bicycle.jpg",
  "city-night.jpg",
  "coffee.jpg",
  "forest.jpg",
  "fruit-bowl.jpg",
  "hot-air-balloons.jpg",
  "lighthouse.jpg",
  "mountains.jpg",
  "pancakes.jpg",
  "pizza.jpg",
  "sailboat.jpg",
  "sleeping-cat.jpg",
] as const;
