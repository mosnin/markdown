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
      <PageShell>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invitation not found</CardTitle>
            <CardDescription>
              This invitation link is invalid or has already been used.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/sign_in"
              className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
            >
              Sign in to your account →
            </Link>
          </CardContent>
        </Card>
      </PageShell>
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
      <PageShell>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invitation unavailable</CardTitle>
            <CardDescription>
              This invitation to{" "}
              <span className="font-medium text-foreground">{workspaceName}</span>{" "}
              has {statusLabel}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/sign_in"
              className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
            >
              Sign in to your account →
            </Link>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-overline text-muted-foreground">Invitation</p>
          <CardTitle className="text-lg">You&apos;re invited</CardTitle>
          <CardDescription>
            {inviterEmail ? (
              <>
                <span className="font-medium text-foreground">
                  {inviterEmail}
                </span>{" "}
                has invited you to join{" "}
              </>
            ) : (
              <>You have been invited to join </>
            )}
            <span className="font-medium text-foreground">{workspaceName}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {workspaceName}
              </p>
              <p className="text-xs text-muted-foreground">Invited as</p>
            </div>
            <Badge variant="secondary" className="capitalize">
              {invitation.role}
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground">
            Sent to{" "}
            <span className="font-medium text-foreground">
              {invitation.email}
            </span>
            . Expires on {new Date(invitation.expires_at).toLocaleDateString()}.
          </p>

          <InviteActions token={token} />
        </CardContent>
      </Card>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-12">
      <Link href="/" className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="block h-5 w-5 rounded-[3px] bg-brand"
        />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Poggle
        </span>
      </Link>
      {children}
    </div>
  );
}
