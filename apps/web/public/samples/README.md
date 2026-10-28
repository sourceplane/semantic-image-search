# Sample images

Twelve flat illustrations drawn for this baseline — a slice of pizza, a stack
of pancakes, a fruit bowl, a cup of coffee, a sailboat at sunset, snowy
mountains, a city at night, a pine forest, a red bicycle, a sleeping cat, a
lighthouse and hot-air balloons — so a fresh deployment has something to
search. Upstream shipped no images (its scripts read a git-ignored
`images-to-index/` directory of your own). They are licensed with the app,
under the Apache License 2.0 (`apps/web/LICENSE`).

The indexer (`lib/ai/index-images.ts`) seeds each into the R2 bucket the first
time it runs; `lib/samples.ts` lists them. Add your own images to the bucket
under `images/` rather than here.
