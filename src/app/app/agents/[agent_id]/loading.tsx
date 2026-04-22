import { Skeleton } from "@/components/ui/skeleton";

export default function AgentDetailLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header skeleton */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2 flex-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-8 w-24 shrink-0" />
        </div>
      </div>
      {/* Tab bar skeleton */}
      <div className="border-b border-border px-6 py-0">
        <div className="flex gap-6 py-3">
          {[80, 60, 70, 55, 65, 75].map((w, i) => (
            <Skeleton key={i} className="h-4" style={{ width: w }} />
          ))}
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
