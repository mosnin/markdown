import { Bell, CreditCard, Key, Palette, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConnectionsPanel } from "@/components/product/connections_panel";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listConnectionsWithScopes } from "@/server/services/connection_service";
import { ProfileSection, AppearanceSection, SecuritySection } from "./settings_client";
import type { Theme } from "./actions";
import { DeleteAccountButton } from "./delete_account_button";

// ─── Section nav ─────────────────────────────────────────────────────────────

const settingsNav = [
  { id: "profile", label: "Profile", icon: User },
  { id: "billing", label: "Billing & Plans", icon: CreditCard },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "connections", label: "Connections", icon: Key },
  { id: "security", label: "Security", icon: Shield },
];

// ─── Billing section ──────────────────────────────────────────────────────────

function BillingSection() {
  return (
    <Card id="settings-billing">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Billing &amp; Plans</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Your current plan and what&apos;s coming next.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        {/* Current plan */}
        <div className="flex items-start gap-4 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">Free plan</p>
              <Badge variant="secondary" className="text-xs">Current</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              You&apos;re on the free plan during our beta. Paid plans are coming soon.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              $0 / month &middot; No credit card required
            </p>
          </div>
        </div>

        {/* Pro plan teaser */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Pro plan
            </p>
            <Badge variant="outline" className="text-xs">Coming soon</Badge>
          </div>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {[
              "Unlimited boxes",
              "10 GB storage",
              "Priority support",
              "Advanced integrations",
              "Audit logs",
              "Custom domains",
            ].map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-3 border-t border-border pt-4">
          <a
            href="mailto:hello@contextstore.app?subject=Paid%20plan%20waitlist"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Get notified when Pro launches
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Notifications section ────────────────────────────────────────────────────

function NotificationsSection() {
  return (
    <Card id="settings-notifications">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Notifications</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Choose when and how you receive notifications.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-4">
        {[
          {
            id: "notif-activity",
            label: "Activity updates",
            description: "Get notified when teammates comment or make changes.",
          },
          {
            id: "notif-security",
            label: "Security alerts",
            description:
              "Receive alerts for new sign-ins and sensitive account changes.",
          },
          {
            id: "notif-product",
            label: "Product announcements",
            description: "Occasional emails about new features and improvements.",
          },
        ].map(({ id, label, description }) => (
          <label
            key={id}
            htmlFor={id}
            className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border px-4 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <input
              id={id}
              type="checkbox"
              defaultChecked={id === "notif-security"}
              className="mt-0.5 shrink-0 accent-foreground"
            />
          </label>
        ))}

        <div className="flex justify-end pt-1">
          <Button size="sm">Save changes</Button>
        </div>
      </CardContent>
    </Card>
  );
}

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

  const [boxes, connections] = await Promise.all([
    listBoxesByWorkspace(supabase, ctx.workspace.id),
    listConnectionsWithScopes(supabase, ctx.workspace.id),
  ]);

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

      {/* Mobile section nav — horizontal scrollable strip */}
      <nav
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 md:hidden"
      >
        {settingsNav.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#settings-${id}`}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-fast hover:bg-accent hover:text-foreground"
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
            {label}
          </a>
        ))}
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* Settings sidebar nav — desktop only */}
        <nav
          aria-label="Settings sections"
          className="hidden w-52 shrink-0 flex-col gap-0.5 border-r border-border p-3 md:flex"
        >
          {settingsNav.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#settings-${id}`}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {label}
            </a>
          ))}
        </nav>

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

            <BillingSection />

            <AppearanceSection
              currentTheme={
                (ctx.user.user_metadata?.theme as Theme | undefined)
              }
            />

            <NotificationsSection />

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
