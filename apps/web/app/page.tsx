import { CardGridSkeleton } from "@/components/card-grid-skeleton";
import { SourceLink } from "@/components/source-link";
import { SearchBox } from "@/components/search-box";
import { SuspendedImageSearch } from "@/components/suspended-image-search";
import { SITE_NAME } from "@/lib/site";
import { Suspense } from "react";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = (await searchParams).q;
  return (
    <main className="p-8 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-semibold text-2xl">{SITE_NAME}</h1>
        </div>
        <SourceLink />
      </div>
      <div>
        <p>
          Search these images by what they show, not by their file names: a
          vision model on Workers AI titled and described each one, and the
          description and your search are compared as embeddings. Try searching
          for something semantically, like &quot;tasty food&quot;.
        </p>
      </div>
      <div className="">
        <div className="pt-2">
          <SearchBox query={query} />
        </div>
        <Suspense fallback={<CardGridSkeleton />} key={query}>
          <SuspendedImageSearch query={query} />
        </Suspense>
      </div>
    </main>
  );
}
