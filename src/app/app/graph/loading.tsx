import { Skeleton } from "@/components/ui/skeleton";

export default function GraphLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 pt-6 pb-5 md:px-8">
        <Skeleton className="h-3 w-20 mb-2" />
        <Skeleton className="h-7 w-56 mb-2" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mx-auto w-full max-w-7xl px-6 py-6 space-y-3">
        <div className="flex gap-1.5">
          {[60, 70, 80, 50, 65].map((w, i) => <Skeleton key={i} className="h-6 rounded-full" style={{ width: w }} />)}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 pt-3">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      </div>
    </div>
  );
}
