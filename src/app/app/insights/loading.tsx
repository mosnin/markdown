import { Skeleton } from "@/components/ui/skeleton";

export default function InsightsLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="mx-auto w-full max-w-4xl px-6 py-5 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
