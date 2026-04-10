import { Search } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { WorkspaceSearchPagePanel } from "@/components/product/box_search_panel";
import { PageHeader } from "@/components/product/page_header";
import { EmptyState } from "@/components/product/empty_state";

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
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title="No boxes to search"
              description="Create a box and add notes before searching."
            />
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
