import { Skeleton } from "@/components/ui/skeleton";

// Instant skeleton for the boxes bento overview so navigation feels immediate
// while the server resolves the box list.
export default function BoxesLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Skeleton className="h-44 w-full rounded-3xl" />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-3xl" />
        ))}
      </div>
    </div>
  );
}
