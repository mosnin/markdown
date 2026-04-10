import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header skeleton */}
      <div className="bg-background px-6 pt-6 pb-4 border-b border-border">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="mt-1.5 h-3 w-64" />
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
          {/* Search input skeleton */}
          <Skeleton className="h-12 w-full rounded-lg" />

          {/* Result skeletons */}
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 rounded" style={{ width: `${45 + (i % 3) * 15}%` }} />
                  <Skeleton className="h-3 w-1/4 rounded" />
                  <Skeleton className="h-3 rounded" style={{ width: `${55 + (i % 2) * 20}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
