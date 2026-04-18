import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { InviteActions } from "./invite_actions";

/**
 * Public invitation accept/decline page.
 *
 * Reached via a link like /invite/<token>. Shows the workspace name,
 * inviter email, and role offered. The user can accept or decline.
 *
 * If the token is invalid, expired, or already used the page shows
 * an appropriate message instead of the action buttons.
 */
export default async function InviteTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();

  // Look up the invitation
  const { data: invitation } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (!invitation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Invitation not found</CardTitle>
            <CardDescription>
              This invitation link is invalid or has already been used.
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-5 text-center">
            <Link
              href="/sign_in"
              className="text-sm text-primary hover:underline"
            >
              Sign in to your account
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check status
  const isPending = invitation.status === "pending";
  const isExpired =
    invitation.status === "expired" ||
    (isPending && new Date(invitation.expires_at) < new Date());

  // Resolve workspace name
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", invitation.workspace_id)
    .maybeSingle();

  // Resolve inviter email
  let inviterEmail: string | null = null;
  try {
    const admin = createAdminClient();
    const { data: inviterData } = await admin.auth.admin.getUserById(
      invitation.invited_by
    );
    inviterEmail = inviterData?.user?.email ?? null;
  } catch {
    // Fail silently — the page still works without the inviter email
  }

  const workspaceName = workspace?.name ?? "Unknown workspace";

  if (!isPending || isExpired) {
    const statusLabel =
      invitation.status === "accepted"
        ? "already been accepted"
        : invitation.status === "declined"
          ? "been declined"
          : "expired";

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Invitation unavailable</CardTitle>
            <CardDescription>
              This invitation to <strong>{workspaceName}</strong> has{" "}
              {statusLabel}.
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="pt-5 text-center">
            <Link
              href="/sign_in"
              className="text-sm text-primary hover:underline"
            >
              Sign in to your account
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>You&apos;re invited!</CardTitle>
          <CardDescription>
            {inviterEmail ? (
              <>
                <strong>{inviterEmail}</strong> has invited you to join
              </>
            ) : (
              <>You have been invited to join</>
            )}{" "}
            <strong>{workspaceName}</strong>.
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {workspaceName}
              </p>
              <p className="text-xs text-muted-foreground">
                Invited as
              </p>
            </div>
            <Badge variant="secondary" className="capitalize">
              {invitation.role}
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            This invitation was sent to{" "}
            <strong>{invitation.email}</strong> and expires on{" "}
            {new Date(invitation.expires_at).toLocaleDateString()}.
          </p>

          <InviteActions token={token} />
        </CardContent>
      </Card>
    </div>
  );
}
