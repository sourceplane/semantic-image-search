// The product's name, written once: the page's <title> and its heading read
// it. A product built from this repository gets it rewritten to its own name
// at instantiation, so keep it literal and on one line. Upstream wrote it
// inline: "Semantic Image Search Demo" in app/layout.tsx's metadata and
// "Semantic Search" in app/page.tsx's heading.
export const SITE_NAME = "Semantic Image Search";

// This product's own source repository: the page's link, where upstream had
// its "Deploy to Vercel" button.
export const SOURCE_URL = "https://github.com/sourceplane/semantic-image-search";

// The public origin the page's absolute links (the Open Graph image) resolve
// against: NEXT_PUBLIC_SITE_URL, which the deploy's build sets to the
// environment's own Worker URL (component.yaml). Upstream used VERCEL_URL.
export function siteUrl(): URL {
  return new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
}
