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
import { KgBackfillButton } from "@/components/product/kg_backfill_button";
import { WebBudgetCard } from "@/components/product/web_budget_card";
import { MembersSection } from "./members_section";
import { canAdmin } from "@/server/auth/require_role";
import { ConnectedAppsSection } from "./connected_apps_section";
import { DeveloperAppsSection } from "./developer_apps_section";
import { AgentPreferencesCard } from "./agent_preferences_card";
import {
  DEFAULT_USER_AGENT_PREFERENCES,
  getUserAgentPreferences,
} from "@/server/services/user_agent_preferences_service";
import {
  getWorkspaceUsageForMonth,
  sumOperatorUsage,
} from "@/server/services/workspace_operator_usage_service";

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

  const [
    boxes,
    connections,
    workspace,
    plan,
    subscriptionStatus,
    noteLimit,
    boxLimit,
    agentPrefsRow,
    operatorUsageRows,
  ] = await Promise.all([
    listBoxesByWorkspace(supabase, ctx.workspace.id),
    listConnectionsWithScopes(supabase, ctx.workspace.id),
    getWorkspaceById(supabase, ctx.workspace.id),
    getWorkspacePlan(supabase, ctx.workspace.id),
    getSubscriptionStatus(supabase, ctx.workspace.id),
    checkNoteLimit(supabase, ctx.workspace.id),
    checkBoxLimit(supabase, ctx.workspace.id),
    getUserAgentPreferences(supabase, ctx.user.id),
    // Current-month operator usage — sum across all users of the
    // workspace. Agent B's work attaches a run limit; we leave that
    // denominator null here for now so the UI shows "X runs this month"
    // with no "/ Y limit" suffix until the tier plumbing lands.
    getWorkspaceUsageForMonth(supabase, ctx.workspace.id).catch(() => []),
  ]);

  const operatorUsageTotals = sumOperatorUsage(operatorUsageRows);

  const initialAgentPrefs = {
    tone: agentPrefsRow?.tone ?? DEFAULT_USER_AGENT_PREFERENCES.tone,
    citation_style:
      agentPrefsRow?.citation_style ?? DEFAULT_USER_AGENT_PREFERENCES.citation_style,
    tool_allowlist:
      agentPrefsRow?.tool_allowlist ?? DEFAULT_USER_AGENT_PREFERENCES.tool_allowlist,
    must_cite_per_claim:
      agentPrefsRow?.must_cite_per_claim ??
      DEFAULT_USER_AGENT_PREFERENCES.must_cite_per_claim,
    max_tool_calls:
      agentPrefsRow?.max_tool_calls ??
      DEFAULT_USER_AGENT_PREFERENCES.max_tool_calls,
  };

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
              initialAgentInstructions={workspace?.agent_instructions ?? null}
            />

            {/*
              Members management is admin-only. Viewers and members don't
              see the surface at all (cleaner than rendering disabled
              controls). Server actions re-verify role, so even if a
              client managed to render this section, every mutation is
              still rejected server-side.
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
              noteCount={noteLimit.current}
              noteMax={noteLimit.max}
              boxCount={boxLimit.current}
              boxMax={boxLimit.max}
              operatorUsage={{
                runCount: operatorUsageTotals.runCount,
                toolCallCount: operatorUsageTotals.toolCallCount,
                inputTokenCount: operatorUsageTotals.inputTokenCount,
                outputTokenCount: operatorUsageTotals.outputTokenCount,
                estimatedCostCents: operatorUsageTotals.estimatedCostCents,
              }}
              /* Run limit denominator is owned by Agent B's tier work —
                 leaving null until that lands surfaces the count alone. */
              operatorRunLimit={null}
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

            {/*
              AI agent preferences — governs how the Workspace Operator
              behaves on this user's runs (tone, citation style, tool
              allowlist, etc.). Server-rendered with the user's saved
              row, falling back to DEFAULT_USER_AGENT_PREFERENCES when
              they have never saved.
            */}
            <AgentPreferencesCard initialPrefs={initialAgentPrefs} />

            <div id="settings-connections">
              <ConnectionsPanel
                initialConnections={connections}
                boxes={boxes}
              />
            </div>

            {/*
              Connected apps (OAuth) — replaces the token-in-env-var
              pattern for connector-style integrations. The legacy
              Connections panel above is kept because /api/v1 callers
              that already issued a bearer token continue to work
              (marked deprecated in docs). New connector integrations
              should use this surface.
            */}
            <ConnectedAppsSection />

            {/*
              Developer-facing surface for registering third-party OAuth
              apps. Paired with the RFC 7591 endpoint at
              /api/oauth/register for scripted registration.
            */}
            <DeveloperAppsSection />

            <SecuritySection />

            {/* Web tool budget — per-month cap on Exa + Browserbase + web_fetch */}
            <Card id="settings-web-budget">
              <CardHeader className="px-6 pt-6 pb-4">
                <CardTitle className="text-base font-semibold">
                  Web tool budget
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Monthly cap on web search and browsing costs. Agents stop
                  calling web tools when this limit is reached.
                </CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="px-6 pt-5 pb-6">
                <WebBudgetCard />
              </CardContent>
            </Card>

            {/* Knowledge Graph — backfill + opt-out surface */}
            <Card id="settings-knowledge-graph">
              <CardHeader className="px-6 pt-6 pb-4">
                <CardTitle className="text-base font-semibold">
                  Knowledge Graph
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Entity and relationship extraction from your notes. Powers
                  GraphRAG context in the Pog agent.
                </CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="px-6 pt-5 pb-6 space-y-4">
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium text-foreground">
                    Backfill existing notes
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Run entity extraction over all notes in your workspace.
                    New notes are extracted automatically on save.
                  </p>
                  <div className="mt-1">
                    <KgBackfillButton />
                  </div>
                </div>
              </CardContent>
            </Card>

            <DangerZoneSection />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
