import dynamic from "next/dynamic";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { PageHeader } from "@/components/product/page_header";
import { WorkspaceSearchClient } from "./search_client";

const LocalIndexBootstrap = dynamic(
  () =>
    import("@/components/product/local_index_bootstrap").then(
      (m) => m.LocalIndexBootstrap
    ),
  { ssr: false }
);

/**
 * Workspace search page.
 *
 * Cross-type search over notes, files, skills, agents, folders, and
 * boxes. The heavy lifting lives in src/server/services/workspace_search_service.ts
 * (`searchWorkspace`) and the dispatching action in ./actions.ts.
 *
 * Access model: any authenticated workspace member can search; results
 * are naturally scoped by RLS (workspace_memberships) so viewers /
 * members / admins each only see hits from workspaces they belong to.
 */
export default async function SearchPage() {
  // Any workspace role is permitted to search — finding is a read.
  const ctx = await requireAuthenticatedUser();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Search"
        description={`Find anything in ${ctx.workspace.name} — notes, files, skills, agents, folders, or boxes.`}
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
          <WorkspaceSearchClient />
        </div>
      </div>
      <LocalIndexBootstrap />
    </div>
  );
}
