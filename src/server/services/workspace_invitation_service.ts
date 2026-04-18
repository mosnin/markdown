import { type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

/**
 * Workspace invitation service.
 *
 * Supports the email-based invitation flow: admins invite users by email,
 * each invitation gets a unique token, and the recipient can accept or
 * decline via a public page. Accepted invitations create a membership
 * row in workspace_memberships.
 *
 * Tokens are 32-byte hex strings (64 chars), generated via Node's
 * crypto.randomBytes for cryptographic strength.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  email: string;
  role: "viewer" | "member" | "admin";
  token: string;
  invited_by: string;
  status: "pending" | "accepted" | "declined" | "expired";
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface CreateInvitationInput {
  workspaceId: string;
  email: string;
  role: "viewer" | "member" | "admin";
  invitedBy: string;
}

// ─── Token generation ───────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure invitation token.
 * 32 bytes = 64 hex characters. Exported for testing.
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// ─── Create ─────────────────────────────────────────────────────────────────

/**
 * Create a workspace invitation. Generates a secure token and inserts
 * the invitation row. If an active (pending) invitation already exists
 * for the same workspace+email, Postgres will reject the insert via the
 * UNIQUE(workspace_id, email, status) constraint — the caller should
 * handle or surface that as a "already invited" message.
 */
export async function createInvitation(
  supabase: SupabaseClient,
  input: CreateInvitationInput
): Promise<WorkspaceInvitation> {
  const token = generateToken();

  const { data, error } = await supabase
    .from("workspace_invitations")
    .insert({
      workspace_id: input.workspaceId,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      token,
      invited_by: input.invitedBy,
    })
    .select()
    .single();

  if (error) {
    if (/duplicate key|23505/i.test(error.message)) {
      throw new Error(
        "An invitation for this email is already pending in this workspace."
      );
    }
    throw new Error(error.message);
  }

  return data as WorkspaceInvitation;
}

// ─── Accept ─────────────────────────────────────────────────────────────────

/**
 * Accept an invitation by token. Validates the token exists, is still
 * pending, and has not expired. On success, creates a workspace_membership
 * row and marks the invitation as accepted.
 *
 * Returns the accepted invitation for audit/display purposes.
 */
export async function acceptInvitation(
  supabase: SupabaseClient,
  token: string,
  userId: string
): Promise<WorkspaceInvitation> {
  // 1. Look up the invitation
  const { data: invitation, error: lookupErr } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("token", token)
    .eq("status", "pending")
    .maybeSingle();

  if (lookupErr) throw new Error(lookupErr.message);
  if (!invitation) throw new Error("Invitation not found or already used.");

  const inv = invitation as WorkspaceInvitation;

  // 2. Check expiry
  if (new Date(inv.expires_at) < new Date()) {
    // Mark as expired
    await supabase
      .from("workspace_invitations")
      .update({ status: "expired" })
      .eq("id", inv.id);
    throw new Error("This invitation has expired.");
  }

  // 3. Check if user is already a member
  const { data: existingMember } = await supabase
    .from("workspace_memberships")
    .select("user_id")
    .eq("workspace_id", inv.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingMember) {
    throw new Error("User is already a member of this workspace");
  }

  // 4. Create the membership
  const { error: memberErr } = await supabase
    .from("workspace_memberships")
    .upsert(
      {
        workspace_id: inv.workspace_id,
        user_id: userId,
        role: inv.role,
        invited_by: inv.invited_by,
        accepted_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" }
    );

  if (memberErr) throw new Error(memberErr.message);

  // 5. Mark accepted
  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("workspace_invitations")
    .update({ status: "accepted", accepted_at: now })
    .eq("id", inv.id)
    .select()
    .single();

  if (updateErr) throw new Error(updateErr.message);

  return updated as WorkspaceInvitation;
}

// ─── Decline ────────────────────────────────────────────────────────────────

/**
 * Decline an invitation by token.
 */
export async function declineInvitation(
  supabase: SupabaseClient,
  token: string
): Promise<WorkspaceInvitation> {
  const { data, error } = await supabase
    .from("workspace_invitations")
    .update({ status: "declined" })
    .eq("token", token)
    .eq("status", "pending")
    .select()
    .single();

  if (error) throw new Error("Invitation not found or already used.");

  return data as WorkspaceInvitation;
}

// ─── List pending (admin view) ──────────────────────────────────────────────

/**
 * List all pending invitations for a workspace. Used by admins to see
 * outstanding invitations.
 */
export async function listPendingInvitations(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceInvitation[]> {
  const { data, error } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as WorkspaceInvitation[];
}

// ─── Revoke ─────────────────────────────────────────────────────────────────

/**
 * Revoke a pending invitation by ID. The actor must be a workspace admin
 * (enforced at the action layer, not here).
 */
export async function revokeInvitation(
  supabase: SupabaseClient,
  invitationId: string,
  _actorId: string
): Promise<void> {
  const { error } = await supabase
    .from("workspace_invitations")
    .update({ status: "expired" })
    .eq("id", invitationId)
    .eq("status", "pending");

  if (error) throw new Error(error.message);
}

// ─── List for user ──────────────────────────────────────────────────────────

/**
 * List all pending invitations for a user (by email). Used on the
 * user's dashboard or invitation acceptance page to show what's waiting.
 */
export async function listInvitationsForUser(
  supabase: SupabaseClient,
  email: string
): Promise<WorkspaceInvitation[]> {
  const { data, error } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("email", email.trim().toLowerCase())
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as WorkspaceInvitation[];
}
