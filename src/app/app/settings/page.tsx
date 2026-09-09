import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceById } from "@/server/repositories/workspace_repository";
import { listProjects } from "@/server/repositories/project_repository";
import {
  getWorkspacePlan,
  getSubscriptionStatus,
  checkProjectLimit,
} from "@/server/services/subscription_service";
import {
  ProfileSection,
  AppearanceSection,
  SecuritySection,
  WorkspaceSection,
  BillingSection,
} from "./settings_client";
import type { Theme } from "./actions";
import { DeleteAccountButton } from "./delete_account_button";
import { SettingsSubnav } from "./settings_subnav";
import { MembersSection } from "./members_section";
import { canAdmin } from "@/server/auth/require_role";
import { ConnectedAppsSection } from "./connected_apps_section";
import { DeveloperAppsSection } from "./developer_apps_section";
import { PageTransition } from "@/components/product/page_transition";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

/**
 * Workspace settings.
 *
 * Scoped to what a relay workspace actually has: who you are, who else is in
 * it, what it costs, and which apps can reach it. The sections that configured
 * the previous product — knowledge-graph backfill, web-tool budgets, note and
 * box quotas, agent tone preferences — were removed with it rather than left
 * behind as controls that toggle nothing.
 */
function DangerZoneSection() {
  return (
    <Card
      id="settings-danger"
      className="border-destructive/50 bg-destructive/5"
    >
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold text-destructive">
          Danger zone
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Irreversible actions. Proceed with caution.
        </CardDescription>
      </CardHeader>
      <Separator className="bg-destructive/20" />
      <CardContent className="px-6 pt-5 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Delete account</p>
            <p className="text-xs text-muted-foreground">
              Permanently delete your account and all associated data. This
              cannot be undone.
            </p>
          </div>
          <DeleteAccountButton />
        </div>
      </CardContent>
    </Card>
  );
}

export default async function SettingsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const [workspace, plan, subscriptionStatus, projectLimit, projects] =
    await Promise.all([
      getWorkspaceById(supabase, ctx.workspace.id),
      getWorkspacePlan(supabase, ctx.workspace.id),
      getSubscriptionStatus(supabase, ctx.workspace.id),
      checkProjectLimit(supabase, ctx.workspace.id),
      listProjects(supabase, ctx.workspace.id).catch(() => []),
    ]);

  const sessionCount = projects.reduce(
    (total, project) => total + (project.session_count ?? 0),
    0,
  );

  return (
    <PageTransition className="flex h-full flex-col overflow-hidden">
      <div className="bg-background">
        <div className="px-6 pt-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your account, your workspace, and the apps that can reach it.
          </p>
        </div>
        <Separator />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <SettingsSubnav />

        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-2xl space-y-6 px-6 py-6">
            <ProfileSection
              email={ctx.user.email ?? ""}
              displayName={
                (ctx.user.user_metadata?.full_name as string | undefined) ??
                (ctx.user.user_metadata?.name as string | undefined)
              }
            />

            <WorkspaceSection
              initialName={workspace?.name ?? ctx.workspace.name}
              initialDescription={workspace?.description ?? null}
              initialAgentInstructions={workspace?.agent_instructions ?? null}
            />

            {/*
              Admin-only. Viewers and members do not see the surface at all,
              which is cleaner than rendering disabled controls — and the
              server actions re-check the role regardless.
            */}
            {canAdmin(ctx.workspace.role) && (
              <MembersSection
                workspaceName={ctx.workspace.name}
                currentUserId={ctx.user.id}
              />
            )}

            <BillingSection
              plan={plan}
              subscriptionStatus={subscriptionStatus}
              projectCount={projectLimit.current}
              projectMax={projectLimit.max}
              sessionCount={sessionCount}
            />

            <AppearanceSection
              currentTheme={ctx.user.user_metadata?.theme as Theme | undefined}
            />

            <ConnectedAppsSection />

            {/*
              Third-party OAuth app registration, paired with the RFC 7591
              endpoint at /api/oauth/register for scripted registration.
            */}
            <DeveloperAppsSection />

            <SecuritySection />

            <DangerZoneSection />
          </div>
        </ScrollArea>
      </div>
    </PageTransition>
  );
}
