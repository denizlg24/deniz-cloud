import { Skeleton } from "@/components/ui/skeleton";
import type { ViewMode } from "@/lib/types";

interface FileGridSkeletonProps {
  view: ViewMode;
  count?: number;
}

export function FileGridSkeleton({ view, count = 12 }: FileGridSkeletonProps) {
  if (view === "list") {
    return (
      <div className="flex flex-col gap-1">
        {Array.from({ length: count }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: acceptable for skeletons
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-4 flex-1 max-w-48" />
            <Skeleton className="hidden h-3 w-16 sm:block" />
            <Skeleton className="hidden h-3 w-14 md:block" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: acceptable for skeletons
        <div key={i} className="flex flex-col items-center gap-2 p-3">
          <Skeleton className="size-10 rounded-lg" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-2 w-10" />
        </div>
      ))}
    </div>
  );
}
