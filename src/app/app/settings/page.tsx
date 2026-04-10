import { Bell, Key, Palette, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/product/page_header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConnectionsPanel } from "@/components/product/connections_panel";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listConnectionsWithScopes } from "@/server/services/connection_service";

// ─── Section nav ─────────────────────────────────────────────────────────────

const settingsNav = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "connections", label: "Connections", icon: Key },
  { id: "security", label: "Security", icon: Shield },
];

// ─── Profile section ──────────────────────────────────────────────────────────

function ProfileSection({ email, displayName }: { email: string; displayName?: string }) {
  const initials = email.slice(0, 2).toUpperCase();
  return (
    <Card id="settings-profile">
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
        <CardDescription>
          Your public-facing identity within Context Store.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
            {initials}
          </div>
          <Button variant="outline" size="sm">
            Change avatar
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="display-name" className="text-sm font-medium text-foreground">
              Display name
            </label>
            <Input
              id="display-name"
              defaultValue={displayName ?? ""}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">Email</label>
            <Input
              id="email"
              defaultValue={email}
              placeholder="you@example.com"
              type="email"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm">Save changes</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Appearance section ───────────────────────────────────────────────────────

function AppearanceSection() {
  return (
    <Card id="settings-appearance">
      <CardHeader>
        <CardTitle className="text-base">Appearance</CardTitle>
        <CardDescription>
          Control the visual presentation of Context Store.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="theme-selector" className="text-sm font-medium text-foreground">Theme</label>
          <div className="flex gap-2">
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
            Theme toggle is wired in the sidebar. This setting will persist it.
          </p>
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
      <PageHeader
        title="Settings"
        description="Manage your account, preferences, and integrations."
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Settings sidebar nav */}
        <nav aria-label="Settings sections" className="hidden w-48 shrink-0 flex-col gap-0.5 border-r border-border p-3 md:flex">
          {settingsNav.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#settings-${id}`}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-fast hover:bg-accent hover:text-foreground"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {label}
            </a>
          ))}
        </nav>

        {/* Main settings area */}
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
            <ProfileSection
              email={ctx.user.email ?? ""}
              displayName={
                (ctx.user.user_metadata?.full_name as string | undefined) ??
                (ctx.user.user_metadata?.name as string | undefined)
              }
            />
            <AppearanceSection />
            <div id="settings-connections">
              <ConnectionsPanel
                initialConnections={connections}
                boxes={boxes}
              />
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
