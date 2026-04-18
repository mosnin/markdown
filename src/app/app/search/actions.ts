"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  searchWorkspace,
  type WorkspaceSearchHit,
} from "@/server/services/workspace_search_service";
import { recordSearchQuery } from "@/server/services/workspace_analytics_service";

export type SearchActionResult =
  | { ok: true; data: WorkspaceSearchHit[] }
  | { ok: false; error: string };

/**
 * Cross-type workspace search.
 *
 * Results are filtered by the caller's workspace membership at the RLS
 * layer: every query runs with the user's Supabase client, so they can
 * only read rows they have a membership row on. Viewer role is still
 * allowed to search — finding is a read operation.
 */
export async function searchWorkspaceAction(
  query: string
): Promise<SearchActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    // Thread the active branch through so soft-trashed rows on the
    // branch disappear from search and branch-created rows surface to
    // their author. See docs/branch_local_structural_creation_v1.md.
    const hits = await searchWorkspace(supabase, ctx.workspace.id, query, {
      branchId: ctx.activeBranchId ?? null,
    });

    // Fire-and-forget analytics recording — never block the response.
    recordSearchQuery(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      query,
      resultCount: hits.length,
      searchType: "keyword",
    }).catch(() => {});

    return { ok: true, data: hits };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Search failed",
    };
  }
}
