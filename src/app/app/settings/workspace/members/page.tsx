import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdminRole } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listWorkspaceMembers } from "@/server/repositories/workspace_membership_repository";
import { listPendingInvitations } from "@/server/services/workspace_invitation_service";
import { Separator } from "@/components/ui/separator";
import { MembersManager } from "./members_manager";
import type { MemberView, InvitationView } from "./actions";

/**
 * Workspace members admin page.
 *
 * Lists current members, pending invitations, and provides an invite
 * form. Admin-only — `requireAdminRole()` at the top of the page.
 */
export default async function WorkspaceMembersPage() {
  const ctx = await requireAdminRole();
  const supabase = await createClient();
  const admin = createAdminClient();

  const [members, invitations] = await Promise.all([
    listWorkspaceMembers(supabase, ctx.workspace.id),
    listPendingInvitations(supabase, ctx.workspace.id),
  ]);

  // Resolve emails for members
  const memberViews: MemberView[] = [];
  for (const m of members) {
    const { data: userData } = await admin.auth.admin.getUserById(m.user_id);
    memberViews.push({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      email: userData?.user?.email ?? null,
      invited_by: m.invited_by,
      created_at: m.created_at,
      is_owner: m.user_id === ctx.workspace.owner_id,
    });
  }

  // Resolve inviter emails for invitations
  const invitationViews: InvitationView[] = [];
  for (const inv of invitations) {
    let inviterEmail: string | null = null;
    if (inv.invited_by) {
      const { data: userData } = await admin.auth.admin.getUserById(inv.invited_by);
      inviterEmail = userData?.user?.email ?? null;
    }
    invitationViews.push({
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background px-6 pt-6 pb-4">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/app/settings"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to settings
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Members
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage workspace members and invitations. Invite teammates by
          email — they will receive a link to accept or decline the
          invitation.
        </p>
      </div>
      <Separator />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <MembersManager
            initialMembers={memberViews}
            initialInvitations={invitationViews}
            currentUserId={ctx.user.id}
            workspaceName={ctx.workspace.name}
          />
        </div>
      </div>
    </div>
  );
}
