import { Skeleton } from "@/components/ui/skeleton";

export default function ProposalsLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-background px-6 pt-6 pb-4 border-b border-border">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-1.5 h-3 w-80" />
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 rounded" style={{ width: `${40 + (i % 3) * 15}%` }} />
                  <Skeleton className="h-3 w-32 rounded" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full rounded" />
              <Skeleton className="h-3 rounded" style={{ width: `${60 + (i % 2) * 15}%` }} />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
