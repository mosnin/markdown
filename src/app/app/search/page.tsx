import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { PageHeader } from "@/components/product/page_header";
import { WorkspaceSearchPagePanel } from "@/components/product/box_search_panel";

export default async function SearchPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Search"
        description="Search notes by title, content, or tags across your workspace."
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
          {boxes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                Create a box to start searching notes.
              </p>
            </div>
          ) : (
            <WorkspaceSearchPagePanel
              boxes={boxes.map((b) => ({ id: b.id, name: b.name }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
