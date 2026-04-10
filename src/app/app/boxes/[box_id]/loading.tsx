import { Skeleton } from "@/components/ui/skeleton";

export default function BoxLoading() {
  return (
    <div className="flex h-full overflow-hidden">
      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Box header skeleton */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-3 w-64" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          </div>
        </div>

        {/* Tabs skeleton */}
        <div className="border-b border-border px-6 flex gap-4">
          {["Notes", "Tree", "Guide", "Graph", "Search"].map((tab) => (
            <div key={tab} className="py-3">
              <Skeleton className="h-3.5 rounded" style={{ width: `${tab.length * 8}px` }} />
            </div>
          ))}
        </div>

        {/* Note list skeleton */}
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-3xl flex flex-col gap-2 px-6 py-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
                <div className="flex-1 space-y-1.5">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 rounded" style={{ width: `${40 + (i % 3) * 15}%` }} />
                    <Skeleton className="h-3 w-16 rounded" />
                  </div>
                  <Skeleton className="h-3 rounded" style={{ width: `${50 + (i % 2) * 20}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel skeleton */}
      <div className="hidden lg:flex lg:h-full lg:w-72 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background">
        <div className="border-b border-border px-4 py-2.5">
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="px-4 py-3 space-y-2">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
        <div className="border-t border-border px-4 py-3 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </div>
  );
}
