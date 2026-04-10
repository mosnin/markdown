import { Skeleton } from "@/components/ui/skeleton";

export default function AppHomeLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header skeleton */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-36" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Body skeleton */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-6">
          {/* Status tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-12" />
              </div>
            ))}
          </div>

          {/* Recent notes */}
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 rounded" style={{ width: `${50 + (i % 3) * 12}%` }} />
                  <Skeleton className="h-3 rounded" style={{ width: `${30 + (i % 2) * 20}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
