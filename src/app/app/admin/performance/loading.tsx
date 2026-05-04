import { Skeleton } from "@/components/ui/skeleton";

export default function AdminPerformanceLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header skeleton — matches PageHeader rhythm. */}
      <div className="bg-background px-6 pt-6 pb-5 md:px-8 md:pt-7">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-3.5 w-96 max-w-full" />
      </div>
      <div className="h-px bg-border" />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 md:px-8">
          <Skeleton className="h-3 w-64" />

          {/* Route-class table card */}
          <div className="rounded-lg border border-border bg-card p-5 space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-80 max-w-full" />
            <div className="space-y-2 pt-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-5 w-5 rounded-md" />
                  <Skeleton className="h-3.5 flex-1" style={{ maxWidth: 180 }} />
                  <Skeleton className="h-3.5 w-12" />
                  <Skeleton className="h-3.5 w-12" />
                  <Skeleton className="h-3.5 w-12" />
                  <Skeleton className="h-5 w-20 rounded-md" />
                  <Skeleton className="h-6 w-24 rounded-sm" />
                </div>
              ))}
            </div>
          </div>

          {/* Two-up: bundles + workers */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, k) => (
              <div
                key={k}
                className="rounded-lg border border-border bg-card p-5 space-y-3"
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-72 max-w-full" />
                <div className="space-y-2 pt-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-3.5 flex-1" />
                      <Skeleton className="h-3.5 w-16" />
                      <Skeleton className="h-5 w-16 rounded-md" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* How budgets work card */}
          <div className="rounded-lg border border-border bg-card p-5 space-y-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}
