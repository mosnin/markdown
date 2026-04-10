import { Skeleton } from "@/components/ui/skeleton";

export default function NoteLoading() {
  return (
    <div className="flex h-full overflow-hidden">
      {/* Editor area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Title area */}
        <div className="px-8 pb-3 pt-6">
          <Skeleton className="h-9 w-2/3 rounded" />
          <div className="mt-2 flex items-center gap-3">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border px-8 py-1.5">
          <div className="flex gap-1">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
          <Skeleton className="h-3 w-20 rounded" />
        </div>

        {/* Content area */}
        <div className="flex-1 px-8 py-6 space-y-3">
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 rounded" style={{ width: "85%" }} />
          <Skeleton className="h-4 rounded" style={{ width: "92%" }} />
          <Skeleton className="h-4 w-3/4 rounded" />
          <div className="py-2" />
          <Skeleton className="h-4 full rounded" />
          <Skeleton className="h-4 rounded" style={{ width: "78%" }} />
          <Skeleton className="h-4 rounded" style={{ width: "88%" }} />
        </div>
      </div>

      {/* Right panel */}
      <aside className="hidden xl:flex xl:h-full xl:w-72 xl:shrink-0 xl:flex-col xl:border-l xl:border-border">
        <div className="border-b border-border px-4 py-2.5">
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="px-4 py-3 space-y-3">
          <Skeleton className="h-3 w-24" />
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2 items-start">
                <Skeleton className="h-3.5 w-3.5 shrink-0 rounded mt-0.5" />
                <Skeleton className="h-3 rounded flex-1" />
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
