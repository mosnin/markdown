import { type SupabaseClient } from "@supabase/supabase-js";
import { type Workspace } from "@/server/domain/types/workspace";
import { RepositoryError } from "@/server/domain/errors";

/**
 * Workspace membership repository.
 *
 * Backs the viewer/member/admin access model. Owner-like behaviour (the
 * canonical workspace.owner_id) stays in workspace_repository; this file
 * owns everything that relates to *other* users joining a workspace.
 */

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface WorkspaceMembership {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Exclude<WorkspaceRole, "owner">;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipWithEmail extends WorkspaceMembership {
  /** auth.users.email — resolved by the admin API. */
  email: string | null;
}

/**
 * List every workspace the given user can access, honouring membership
 * (any role) rather than strict ownership. Result order is stable
 * (workspace created_at ascending) so the UI default selection is
 * predictable across sessions.
 *
 * This is the multi-user replacement for `listWorkspacesByOwner` at any
 * seam that only cares about "can the user access this workspace".
 */
export async function listAccessibleWorkspaces(
  supabase: SupabaseClient,
  user_id: string
): Promise<Array<Workspace & { role: WorkspaceRole }>> {
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("role, workspace:workspaces(*)")
    .eq("user_id", user_id);

  if (error || !data) return [];

  const rows = data
    .map((m: { role: string; workspace: Workspace | Workspace[] | null }) => {
      const ws = Array.isArray(m.workspace) ? m.workspace[0] : m.workspace;
      if (!ws || ws.status === "trashed") return null;
      return {
        ...ws,
        // Promote the canonical owner to 'owner' role for display /
        // gating code, even though the backfill gave them 'admin'
        // membership.
        role: ws.owner_id === user_id ? ("owner" as const) : (m.role as WorkspaceRole),
      };
    })
    .filter((x): x is Workspace & { role: WorkspaceRole } => x !== null);

  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return rows;
}

/**
 * Resolve the caller's role on a specific workspace, or null if they
 * are not a member. Used by the service layer when gating write
 * operations (member / admin can write, viewer cannot).
 */
export async function getWorkspaceRole(
  supabase: SupabaseClient,
  workspace_id: string,
  user_id: string
): Promise<WorkspaceRole | null> {
  // Owner short-circuit: owner_id is always treated as 'owner' regardless
  // of the membership row, so the canonical owner cannot lose admin power
  // by accidental role edits.
  const { data: ws } = await supabase
    .from("workspaces")
    .select("owner_id")
    .eq("id", workspace_id)
    .maybeSingle();
  if (ws && ws.owner_id === user_id) return "owner";

  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspace_id)
    .eq("user_id", user_id)
    .maybeSingle();
  if (error || !data) return null;
  return data.role as WorkspaceRole;
}

/** List members of a workspace. Caller must be an admin. */
export async function listWorkspaceMembers(
  supabase: SupabaseClient,
  workspace_id: string
): Promise<WorkspaceMembership[]> {
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("*")
    .eq("workspace_id", workspace_id)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as WorkspaceMembership[];
}

/**
 * Insert or update a membership. Used by admin "invite" / "change role"
 * flows. `invited_by` is set to the acting admin so membership history
 * is auditable at the row level.
 */
export async function upsertMembership(
  supabase: SupabaseClient,
  input: {
    workspace_id: string;
    user_id: string;
    role: Exclude<WorkspaceRole, "owner">;
    invited_by: string;
  }
): Promise<WorkspaceMembership> {
  const { data, error } = await supabase
    .from("workspace_memberships")
    .upsert(
      {
        workspace_id: input.workspace_id,
        user_id: input.user_id,
        role: input.role,
        invited_by: input.invited_by,
        // Direct-add V1: invitation is accepted at creation time since
        // the acting admin adds a known auth user.
        accepted_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" }
    )
    .select()
    .single();
  if (error || !data) {
    throw new RepositoryError("upsertMembership", error);
  }
  return data as WorkspaceMembership;
}

/** Remove a user from a workspace. */
export async function removeMembership(
  supabase: SupabaseClient,
  workspace_id: string,
  user_id: string
): Promise<void> {
  const { error } = await supabase
    .from("workspace_memberships")
    .delete()
    .eq("workspace_id", workspace_id)
    .eq("user_id", user_id);
  if (error) throw new RepositoryError("removeMembership", error);
}
