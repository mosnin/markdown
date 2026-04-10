import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-background px-6 pt-6 pb-4">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-1.5 h-3 w-72" />
      </div>
      <div className="h-px bg-border" />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-4 space-y-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-md px-3 py-2.5"
            >
              <Skeleton className="h-4 w-4 shrink-0 rounded" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3.5 rounded" style={{ width: `${35 + (i % 4) * 12}%` }} />
                <Skeleton className="h-3 w-28 rounded" />
              </div>
              <Skeleton className="h-3 w-16 shrink-0 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
