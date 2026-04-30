"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { setActiveWorkspaceAction } from "./actions";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

interface WorkspaceListProps {
  workspaces: WorkspaceRow[];
  activeWorkspaceId: string;
}

/**
 * Lists every workspace the user owns, with a clear Active badge and
 * a Switch action for each non-active row. Selecting a workspace writes
 * the cookie via setActiveWorkspaceAction and refreshes the route tree.
 */
export function WorkspaceList({
  workspaces,
  activeWorkspaceId,
}: WorkspaceListProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleSwitch(id: string) {
    if (id === activeWorkspaceId) return;
    startTransition(async () => {
      const result = await setActiveWorkspaceAction(id);
      if (result.ok) {
        router.push("/app");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
      {workspaces.map((w) => {
        const isActive = w.id === activeWorkspaceId;
        return (
          <div
            key={w.id}
            className={cn(
              "flex items-center gap-3 px-4 py-3",
              isActive && "bg-accent/30",
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {w.name}
              </p>
              <p className="mt-0.5 text-[11px] font-mono text-muted-foreground/70">
                {w.slug}
              </p>
            </div>
            {isActive ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300">
                <Check className="h-3 w-3" aria-hidden="true" />
                Active
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSwitch(w.id)}
                disabled={pending}
                className="shrink-0 text-xs"
              >
                Switch
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
