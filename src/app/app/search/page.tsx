import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { WorkspaceSearchPanel } from "@/components/product/workspace_search_panel";

export default async function SearchPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Search</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Search notes within any box in your workspace
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          {boxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create a box to start searching notes.
            </p>
          ) : (
            <WorkspaceSearchPanel
              boxes={boxes.map((b) => ({ id: b.id, name: b.name }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
