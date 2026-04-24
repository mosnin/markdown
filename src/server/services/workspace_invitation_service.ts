import { type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { logger } from "@/lib/logger";

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
 *
 * Email delivery: after a successful DB insert the service attempts to
 * send an invitation email via Resend's HTTP API (native fetch, no SDK).
 * Email failures are logged but never roll back the invitation — the
 * invitation link itself is usable as long as the row exists.
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
  /**
   * Display name of the workspace. Used in the invitation email subject
   * and body. Optional so callers without the workspace loaded (tests,
   * admin scripts) can still create invitations; a generic fallback is
   * used when absent.
   */
  workspaceName?: string;
  /**
   * Display name of the inviter (falls back to "A teammate" in emails).
   */
  inviterName?: string;
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

  // Fire the invitation email. Failures here are logged but never
  // propagate — the invitation row already exists and the admin can
  // always resend or share the link directly.
  await sendInvitationEmail(
    input.email.trim().toLowerCase(),
    token,
    input.workspaceName ?? "your workspace",
    input.inviterName ?? "A teammate"
  );

  return data as WorkspaceInvitation;
}

// ─── Email delivery ─────────────────────────────────────────────────────────

/**
 * Send an invitation email via Resend's HTTP API.
 *
 * - No-ops (logs info) when RESEND_API_KEY is unset — common in dev/CI.
 * - Reads NEXT_PUBLIC_SITE_URL to build the invite link.
 * - Reads RESEND_FROM_DOMAIN with a sensible default so we can swap
 *   sending domains without a code change.
 * - Wraps the fetch in try/catch; email failures must NOT roll back
 *   the invitation (the caller has already committed the DB row).
 *
 * Private to this module — not exported.
 */
async function sendInvitationEmail(
  email: string,
  token: string,
  workspaceName: string,
  inviterName: string
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.info(
      { email_hint: email.split("@")[1] ?? "redacted", workspaceName },
      "invitation_email_skipped_no_api_key"
    );
    return;
  }

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://contextstore.dev"
  ).replace(/\/$/, "");
  const inviteUrl = `${siteUrl}/invite/${token}`;
  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? "mail.contextstore.dev";

  const subject = `You're invited to ${workspaceName} on Context Store`;
  const safeWorkspace = escapeHtml(workspaceName);
  const safeInviter = escapeHtml(inviterName);
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">You're invited to ${safeWorkspace}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#333;">${safeInviter} invited you to join <strong>${safeWorkspace}</strong> on Context Store.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#333;">Click the button below to accept the invitation. This link will expire in 7 days.</p>
          <p style="margin:0 0 24px;"><a href="${inviteUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:500;">Accept invitation</a></p>
          <p style="margin:0;font-size:12px;color:#666;line-height:1.5;">Or copy this link into your browser:<br/><span style="word-break:break-all;color:#444;">${inviteUrl}</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = `${inviterName} invited you to join ${workspaceName} on Context Store.\n\nAccept the invitation (expires in 7 days):\n${inviteUrl}\n`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `Context Store <invites@${fromDomain}>`,
        to: [email],
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch((err) => { logger.warn({ err }, "failed to read workspace invitation send error response body"); return ""; });
      logger.error(
        {
          status: res.status,
          // Truncate error body so a verbose provider response doesn't
          // dominate log lines.
          body: bodyText.slice(0, 500),
          workspaceName,
        },
        "invitation_email_failed"
      );
      return;
    }

    logger.info(
      { workspaceName, email_hint: email.split("@")[1] ?? "redacted" },
      "invitation_email_sent"
    );
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        workspaceName,
      },
      "invitation_email_error"
    );
  }
}

/** Minimal HTML escape for values interpolated into the email template. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
