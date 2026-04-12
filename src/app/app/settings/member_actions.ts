"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import {
  listWorkspaceMembers,
  upsertMembership,
  removeMembership,
  type WorkspaceMembership,
  type WorkspaceRole,
} from "@/server/repositories/workspace_membership_repository";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

/**
 * Server actions for workspace member management.
 *
 * All of these are admin-only — the requireAdminRoleResult guard returns
 * a friendly ActionResult when a non-admin hits the action instead of
 * throwing. Membership changes are recorded in audit_events under the
 * workspace.member.* event family so we keep a durable trail of who
 * added, promoted, or removed whom.
 *
 * Invitation model (V1): admins add users by email. The server resolves
 * the email to an existing auth user via the Supabase admin API. If the
 * email has no matching user, the action returns an actionable error
 * rather than silently queuing a pending invite. A full "email invite
 * with signup link" flow is an explicit V2 upgrade.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── List ────────────────────────────────────────────────────────────────────

export interface MemberView {
  id: string;
  user_id: string;
  role: WorkspaceRole;
  email: string | null;
  invited_by: string | null;
  created_at: string;
  is_owner: boolean;
}

/**
 * List members of the active workspace. Admin-only.
 *
 * Returns emails alongside roles so the UI can render a usable list.
 * Uses the admin client for the auth.users email lookup because the
 * anon client can't read other users' identity rows.
 */
export async function listMembersAction(): Promise<ActionResult<MemberView[]>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const members = await listWorkspaceMembers(supabase, ctx.workspace.id);

    const views: MemberView[] = [];
    for (const m of members) {
      const { data: userData } = await admin.auth.admin.getUserById(m.user_id);
      views.push({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        email: userData?.user?.email ?? null,
        invited_by: m.invited_by,
        created_at: m.created_at,
        is_owner: m.user_id === ctx.workspace.owner_id,
      });
    }
    // Owner first, then admins, then members, then viewers, then by
    // creation time within each bucket.
    const rank: Record<WorkspaceRole, number> = {
      owner: 0, admin: 1, member: 2, viewer: 3,
    };
    views.sort((a, b) => {
      const ra = rank[a.is_owner ? "owner" : a.role];
      const rb = rank[b.is_owner ? "owner" : b.role];
      if (ra !== rb) return ra - rb;
      return a.created_at.localeCompare(b.created_at);
    });

    return { ok: true, data: views };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list members" };
  }
}

// ─── Invite by email ─────────────────────────────────────────────────────────

export async function inviteMemberAction(
  email: string,
  role: Exclude<WorkspaceRole, "owner">
): Promise<ActionResult<{ user_id: string }>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return { ok: false, error: "Email is required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, error: "Enter a valid email address" };
  }
  if (!["viewer", "member", "admin"].includes(role)) {
    return { ok: false, error: "Invalid role" };
  }

  try {
    const admin = createAdminClient();
    // Resolve the email to an auth user. Supabase's admin listUsers
    // supports server-side filtering by email. Page size of 1 is enough
    // because emails are unique.
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (error) return { ok: false, error: error.message };
    const matched = data.users.find(
      (u) => u.email?.toLowerCase() === cleanEmail
    );
    if (!matched) {
      return {
        ok: false,
        error: "No user found with that email. They must sign up first, then an admin can add them.",
      };
    }
    if (matched.id === ctx.workspace.owner_id) {
      return { ok: false, error: "This user is already the workspace owner." };
    }

    const supabase = await createClient();
    const membership = await upsertMembership(supabase, {
      workspace_id: ctx.workspace.id,
      user_id: matched.id,
      role,
      invited_by: ctx.user.id,
    });

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "workspace.member.invited",
      metadata: {
        invited_user_id: matched.id,
        invited_email: cleanEmail,
        role,
      },
    });

    revalidatePath("/app/settings");
    return { ok: true, data: { user_id: membership.user_id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to invite member" };
  }
}

// ─── Change role ─────────────────────────────────────────────────────────────

export async function updateMemberRoleAction(
  userId: string,
  role: Exclude<WorkspaceRole, "owner">
): Promise<ActionResult> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  if (!["viewer", "member", "admin"].includes(role)) {
    return { ok: false, error: "Invalid role" };
  }
  // The canonical owner cannot have their role downgraded through this
  // surface. Ownership transfer is an explicit separate operation (not in
  // V1) — surfacing a "change owner's role" button would mislead admins.
  if (userId === ctx.workspace.owner_id) {
    return { ok: false, error: "The workspace owner's role cannot be changed here." };
  }

  try {
    const supabase = await createClient();
    await upsertMembership(supabase, {
      workspace_id: ctx.workspace.id,
      user_id: userId,
      role,
      invited_by: ctx.user.id,
    });

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "workspace.member.role_changed",
      metadata: { target_user_id: userId, new_role: role },
    });

    revalidatePath("/app/settings");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to change role" };
  }
}

// ─── Remove ──────────────────────────────────────────────────────────────────

export async function removeMemberAction(
  userId: string
): Promise<ActionResult> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  if (userId === ctx.workspace.owner_id) {
    return { ok: false, error: "The workspace owner cannot be removed." };
  }
  if (userId === ctx.user.id) {
    return { ok: false, error: "You cannot remove yourself. Ask another admin." };
  }

  try {
    const supabase = await createClient();
    await removeMembership(supabase, ctx.workspace.id, userId);

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "workspace.member.removed",
      metadata: { target_user_id: userId },
    });

    revalidatePath("/app/settings");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove member" };
  }
}

// Re-export the type for client callers so they don't have to double-import.
export type { WorkspaceMembership };
