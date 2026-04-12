"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  searchWorkspace,
  type WorkspaceSearchHit,
} from "@/server/services/workspace_search_service";

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
    const hits = await searchWorkspace(supabase, ctx.workspace.id, query);
    return { ok: true, data: hits };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Search failed",
    };
  }
}
