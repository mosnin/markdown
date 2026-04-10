import { Bell, CreditCard, Key, Palette, Shield, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// ─── Section nav ─────────────────────────────────────────────────────────────

const settingsNav = [
  { id: "profile", label: "Profile", icon: User },
  { id: "billing", label: "Billing & Plans", icon: CreditCard },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "connections", label: "Connections", icon: Key },
  { id: "security", label: "Security", icon: Shield },
];

// ─── Profile section ──────────────────────────────────────────────────────────

function ProfileSection({
  email,
  displayName,
}: {
  email: string;
  displayName?: string;
}) {
  const initials = email.slice(0, 2).toUpperCase();
  return (
    <Card id="settings-profile">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Profile</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Your public-facing identity within Context Store.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground select-none">
            {initials}
          </div>
          <div className="flex flex-col gap-1">
            <Button variant="outline" size="sm">
              Change avatar
            </Button>
            <p className="text-xs text-muted-foreground">
              JPG, PNG, or WebP. Max 2 MB.
            </p>
          </div>
        </div>

        {/* Fields */}
        <div className="grid gap-y-4 sm:grid-cols-2 sm:gap-x-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="display-name"
              className="text-sm font-medium text-foreground"
            >
              Display name
            </label>
            <Input
              id="display-name"
              defaultValue={displayName ?? ""}
              placeholder="Your name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-sm font-medium text-foreground"
            >
              Email address
            </label>
            <Input
              id="email"
              defaultValue={email}
              placeholder="you@example.com"
              type="email"
            />
            <p className="text-xs text-muted-foreground">
              Changing your email requires re-verification.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <Button size="sm">Save changes</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Billing section ──────────────────────────────────────────────────────────

function BillingSection() {
  return (
    <Card id="settings-billing">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Billing &amp; Plans</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Manage your subscription, payment method, and invoices.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        {/* Current plan */}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">Free plan</p>
              <Badge variant="secondary" className="text-xs">Current</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Up to 3 boxes, 100 MB storage, community support.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              $0 / month &middot; No credit card required
            </p>
          </div>
          <Button size="sm" className="shrink-0 gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Upgrade
          </Button>
        </div>

        {/* Plan features teaser */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Pro plan includes
          </p>
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
          <Button variant="outline" size="sm">
            Manage billing
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            View invoices
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Appearance section ───────────────────────────────────────────────────────

function AppearanceSection() {
  return (
    <Card id="settings-appearance">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Appearance</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Control the visual presentation of Context Store.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="theme-selector"
            className="text-sm font-medium text-foreground"
          >
            Theme
          </label>
          <div className="flex gap-2" id="theme-selector">
            {["Light", "Dark", "System"].map((t) => (
              <Button
                key={t}
                variant={t === "System" ? "default" : "outline"}
                size="sm"
                className="min-w-[80px]"
              >
                {t}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Theme toggle is also available in the sidebar. This setting persists
            your preference.
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <Button size="sm">Save changes</Button>
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

// ─── Security section ─────────────────────────────────────────────────────────

function SecuritySection() {
  return (
    <Card id="settings-security">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="text-base font-semibold">Security</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Manage your password and active sessions.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-6 pt-5 pb-6 space-y-5">
        {/* Password update */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="current-password"
              className="text-sm font-medium text-foreground"
            >
              Current password
            </label>
            <Input
              id="current-password"
              type="password"
              placeholder="Enter current password"
              autoComplete="current-password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="new-password"
              className="text-sm font-medium text-foreground"
            >
              New password
            </label>
            <Input
              id="new-password"
              type="password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="confirm-password"
              className="text-sm font-medium text-foreground"
            >
              Confirm new password
            </label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Repeat new password"
              autoComplete="new-password"
            />
          </div>
        </div>

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
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
          >
            Delete account
          </Button>
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

            <AppearanceSection />

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
