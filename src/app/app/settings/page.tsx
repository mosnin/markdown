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
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/product/page_header";
import { PanelSection } from "@/components/product/panel_section";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Section nav ─────────────────────────────────────────────────────────────

const settingsNav = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "api", label: "API", icon: Key },
  { id: "security", label: "Security", icon: Shield },
];

// ─── Profile section ──────────────────────────────────────────────────────────

function ProfileSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
        <CardDescription>
          Your public-facing identity within Context Store.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
            JS
          </div>
          <Button variant="outline" size="sm">
            Change avatar
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Display name
            </label>
            <Input defaultValue="Jane Smith" placeholder="Your name" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Email</label>
            <Input
              defaultValue="jane@example.com"
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Appearance</CardTitle>
        <CardDescription>
          Control the visual presentation of Context Store.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Theme</label>
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

// ─── API section ─────────────────────────────────────────────────────────────

function ApiSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">API access</CardTitle>
        <CardDescription>
          Manage personal API tokens for programmatic and MCP access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-4 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            API token management — available in a later release
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Personal tokens, MCP integration, and export API will be
            configured here.
          </p>
          <Badge variant="outline" className="mt-2 text-xs font-normal">
            Coming soon
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Settings"
        description="Manage your account, preferences, and integrations."
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Settings sidebar nav */}
        <nav className="hidden w-48 shrink-0 flex-col gap-0.5 border-r border-border p-3 md:flex">
          {settingsNav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-fast hover:bg-accent hover:text-foreground text-left"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Main settings area */}
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
            <ProfileSection />
            <AppearanceSection />
            <ApiSection />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
