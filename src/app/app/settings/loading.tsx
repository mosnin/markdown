import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-background px-6 pt-6 pb-4 border-b border-border">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="mt-1.5 h-3 w-64" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar skeleton */}
        <div className="hidden w-52 shrink-0 flex-col gap-1 border-r border-border p-3 md:flex">
          {["Profile", "Billing", "Appearance", "Notifications", "Connections", "Security"].map((item) => (
            <div key={item} className="flex items-center gap-2 rounded-md px-2.5 py-2">
              <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
              <Skeleton className="h-3.5 rounded flex-1" style={{ maxWidth: `${item.length * 8}px` }} />
            </div>
          ))}
        </div>

        {/* Content skeleton */}
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-2xl space-y-6 px-6 py-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-border bg-card">
                <div className="px-6 pt-6 pb-4 space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <div className="h-px bg-border" />
                <div className="px-6 py-5 space-y-4">
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-9 w-full rounded-md" />
                  </div>
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-9 w-full rounded-md" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
