"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requireAdminRoleResult,
} from "@/server/auth/require_role";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  listWorkspaceMembers,
  upsertMembership,
  removeMembership,
  type WorkspaceRole,
} from "@/server/repositories/workspace_membership_repository";
import {
  createInvitation,
  listPendingInvitations,
  revokeInvitation,
  acceptInvitation,
} from "@/server/services/workspace_invitation_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import { checkRateLimit } from "@/server/services/rate_limit_service";

/**
 * Server actions for workspace invitations and member management.
 *
 * All mutation actions that modify membership or invitations are admin-only
 * (except acceptInvitationAction which is for any authenticated user).
 *
 * Rate limiting: inviteMemberAction is limited to 10 per hour per user
 * to prevent invite-spam.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemberView {
  id: string;
  user_id: string;
  role: WorkspaceRole;
  email: string | null;
  invited_by: string | null;
  created_at: string;
  is_owner: boolean;
}

export interface InvitationView {
  id: string;
  email: string;
  role: string;
  status: string;
  invited_by: string;
  inviter_email: string | null;
  expires_at: string;
  created_at: string;
}

// ─── List members ───────────────────────────────────────────────────────────

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

// ─── List pending invitations ───────────────────────────────────────────────

export async function listPendingInvitationsAction(): Promise<ActionResult<InvitationView[]>> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const invitations = await listPendingInvitations(supabase, ctx.workspace.id);

    const views: InvitationView[] = [];
    for (const inv of invitations) {
      let inviterEmail: string | null = null;
      if (inv.invited_by) {
        const { data: userData } = await admin.auth.admin.getUserById(inv.invited_by);
        inviterEmail = userData?.user?.email ?? null;
      }
      views.push({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        invited_by: inv.invited_by,
        inviter_email: inviterEmail,
        expires_at: inv.expires_at,
        created_at: inv.created_at,
      });
    }

    return { ok: true, data: views };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to list invitations" };
  }
}

// ─── Invite member by email ─────────────────────────────────────────────────

export async function inviteMemberAction(
  email: string,
  role: "viewer" | "member" | "admin"
): Promise<ActionResult<{ invitationId: string }>> {
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
    // Rate limit: 10 invitations per hour per user
    const supabase = await createClient();
    const rl = await checkRateLimit(
      supabase,
      `workspace_invite:user:${ctx.user.id}`,
      { limit: 10, windowSeconds: 3600 }
    );
    if (!rl.allowed) {
      return {
        ok: false,
        error: `Invitation rate limit reached. Try again in ${rl.retryAfterSeconds} seconds.`,
      };
    }

    const inviterName =
      (ctx.user.user_metadata?.full_name as string | undefined) ??
      (ctx.user.user_metadata?.name as string | undefined) ??
      ctx.user.email ??
      "A teammate";

    const invitation = await createInvitation(supabase, {
      workspaceId: ctx.workspace.id,
      email: cleanEmail,
      role,
      invitedBy: ctx.user.id,
      workspaceName: ctx.workspace.name,
      inviterName,
    });

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "member.invited",
      metadata: {
        invitation_id: invitation.id,
        invited_email: cleanEmail,
        role,
      },
    });

    revalidatePath("/app/settings/workspace/members");
    return { ok: true, data: { invitationId: invitation.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send invitation" };
  }
}

// ─── Revoke invitation ──────────────────────────────────────────────────────

export async function revokeInvitationAction(
  invitationId: string
): Promise<ActionResult> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    await revokeInvitation(supabase, invitationId, ctx.user.id);

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "member.revoked",
      metadata: { invitation_id: invitationId },
    });

    revalidatePath("/app/settings/workspace/members");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to revoke invitation" };
  }
}

// ─── Accept invitation ──────────────────────────────────────────────────────

export async function acceptInvitationAction(
  token: string
): Promise<ActionResult<{ workspaceId: string }>> {
  const ctx = await requireAuthenticatedUser();

  // An authenticated user always has a verified email in this product
  // (email is the sole sign-in identifier). Guard explicitly so the
  // email-match check below never silently passes on an empty string.
  const userEmail = ctx.user.email;
  if (!userEmail) {
    return {
      ok: false,
      error: "Your account has no email address; cannot accept invitation.",
    };
  }

  try {
    const supabase = await createClient();
    const invitation = await acceptInvitation(
      supabase,
      token,
      ctx.user.id,
      userEmail
    );

    await createAuditEvent(supabase, {
      workspace_id: invitation.workspace_id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: invitation.workspace_id,
      event_type: "member.accepted",
      metadata: {
        invitation_id: invitation.id,
        email: invitation.email,
        role: invitation.role,
      },
    });

    return { ok: true, data: { workspaceId: invitation.workspace_id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to accept invitation" };
  }
}

// ─── Remove member ──────────────────────────────────────────────────────────

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
      event_type: "member.removed",
      metadata: { target_user_id: userId },
    });

    revalidatePath("/app/settings/workspace/members");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove member" };
  }
}

// ─── Change role ────────────────────────────────────────────────────────────

export async function changeMemberRoleAction(
  userId: string,
  newRole: "viewer" | "member" | "admin"
): Promise<ActionResult> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  if (!["viewer", "member", "admin"].includes(newRole)) {
    return { ok: false, error: "Invalid role" };
  }
  if (userId === ctx.workspace.owner_id) {
    return { ok: false, error: "The workspace owner's role cannot be changed here." };
  }

  try {
    const supabase = await createClient();
    await upsertMembership(supabase, {
      workspace_id: ctx.workspace.id,
      user_id: userId,
      role: newRole,
      invited_by: ctx.user.id,
    });

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "workspace",
      object_id: ctx.workspace.id,
      event_type: "member.role_changed",
      metadata: { target_user_id: userId, new_role: newRole },
    });

    revalidatePath("/app/settings/workspace/members");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to change role" };
  }
}
