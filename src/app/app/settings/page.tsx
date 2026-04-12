import { Bell, Building2, CreditCard, Key, Palette, Shield, User } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConnectionsPanel } from "@/components/product/connections_panel";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listConnectionsWithScopes } from "@/server/services/connection_service";
import { getWorkspaceById } from "@/server/repositories/workspace_repository";
import {
  getWorkspacePlan,
  getSubscriptionStatus,
  checkNoteLimit,
  checkBoxLimit,
} from "@/server/services/subscription_service";
import {
  ProfileSection,
  AppearanceSection,
  SecuritySection,
  NotificationsSection,
  WorkspaceSection,
  BillingSection,
} from "./settings_client";
import type { Theme, NotificationPreferences } from "./actions";
import { DeleteAccountButton } from "./delete_account_button";

// Settings section nav is rendered by SettingsSidebar (see
// src/components/product/settings_sidebar.tsx). Keeping the sections
// list there in one place avoids the two-menu look on the settings
// page — the main sidebar swaps to the settings nav while you're on
// this route.

// ─── Danger zone ──────────────────────────────────────────────────────────────

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

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function SettingsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const [boxes, connections, workspace, plan, subscriptionStatus, noteLimit, boxLimit] =
    await Promise.all([
      listBoxesByWorkspace(supabase, ctx.workspace.id),
      listConnectionsWithScopes(supabase, ctx.workspace.id),
      getWorkspaceById(supabase, ctx.workspace.id),
      getWorkspacePlan(supabase, ctx.workspace.id),
      getSubscriptionStatus(supabase, ctx.workspace.id),
      checkNoteLimit(supabase, ctx.workspace.id),
      checkBoxLimit(supabase, ctx.workspace.id),
    ]);

  const savedNotifications = ctx.user.user_metadata?.notifications as
    | NotificationPreferences
    | undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="bg-background">
        <div className="px-6 pt-6 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your account, preferences, and integrations.
          </p>
        </div>
        <Separator />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Settings navigation moved into the main sidebar. When the user
            is on /app/settings the AppShellSidebar swaps in the
            SettingsSidebar, which handles anchor navigation to these
            sections — so there's no in-page left nav or mobile strip. */}

        {/* Main settings area */}
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
            />

            <BillingSection
              plan={plan}
              subscriptionStatus={subscriptionStatus}
              noteCount={noteLimit.current}
              noteMax={noteLimit.max}
              boxCount={boxLimit.current}
              boxMax={boxLimit.max}
            />

            <AppearanceSection
              currentTheme={
                (ctx.user.user_metadata?.theme as Theme | undefined)
              }
            />

            <NotificationsSection
              initialActivity={savedNotifications?.activity ?? false}
              initialSecurity={savedNotifications?.security ?? true}
              initialAnnouncements={savedNotifications?.announcements ?? false}
            />

            <div id="settings-connections">
              <ConnectionsPanel
                initialConnections={connections}
                boxes={boxes}
              />
            </div>

            <SecuritySection />

            <DangerZoneSection />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
