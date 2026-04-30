"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppWindow,
  ArrowLeft,
  ArrowRightLeft,
  Bell,
  Building2,
  Code2,
  CreditCard,
  Fingerprint,
  GitBranch,
  Key,
  Mail,
  Palette,
  Shield,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { AccountSetting01Icon } from "hugeicons-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";
import { WorkspaceSwitcher } from "@/components/product/workspace/workspace_switcher";

/**
 * Account-section nav — rendered as in-page anchors on the main
 * /app/settings page.
 */
const accountNav = [
  { id: "profile", label: "Profile", icon: User },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "billing", label: "Billing & Plans", icon: CreditCard },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "connections", label: "Connections", icon: Key },
  { id: "security", label: "Security", icon: Shield },
];

/**
 * Developer / Apps nav — dedicated routes under /app/settings/*. Kept
 * separate from account anchors because they navigate, not scroll.
 * Order mirrors lifecycle: register a client first, then grant access
 * to apps, then see everything that has been granted.
 */
const developerNav = [
  {
    href: "/app/settings/oauth_clients",
    label: "OAuth Clients",
    subLabel: "Apps you've registered",
    icon: Code2,
  },
  {
    href: "/app/settings/connected_apps",
    label: "Connected Apps",
    subLabel: "Apps with access to your workspace",
    icon: AppWindow,
  },
  {
    href: "/app/settings/connections/migration",
    label: "Legacy migration",
    subLabel: "Migrate csk_v1_ tokens to OAuth",
    icon: ArrowRightLeft,
  },
];

/**
 * Workspace Operator nav — preferences & API keys for the Operator agent.
 * Lives in its own section so it doesn't get lost in the workspace-admin
 * list; users find it by scrolling, not by sub-menu.
 */
const operatorNav = [
  {
    href: "/app/settings/operator_preferences",
    label: "Operator preferences",
    subLabel: "Email notifications & API keys",
    icon: Mail,
  },
];

/**
 * Workspace-admin nav — workspace-level policy pages.
 */
const workspaceAdminNav = [
  {
    href: "/app/settings/workspace/members",
    label: "Members",
    subLabel: "Invite & manage team members",
    icon: Users,
  },
  {
    href: "/app/settings/workspace/branch_retention",
    label: "Branch retention",
    subLabel: "Auto-discard idle branches",
    icon: GitBranch,
  },
  {
    href: "/app/settings/workspace/semantic_search",
    label: "Semantic search",
    subLabel: "Reindex vector embeddings",
    icon: Sparkles,
  },
];

/**
 * Security nav — dedicated routes for security features like passkeys.
 */
const securityNav = [
  {
    href: "/app/settings/security/passkeys",
    label: "Passkeys",
    subLabel: "Passwordless sign-in",
    icon: Fingerprint,
  },
];

interface SettingsSidebarProps {
  userEmail?: string;
  workspaceName?: string;
  workspaceId?: string;
  workspaces?: Array<{ id: string; name: string; slug: string }>;
}

/**
 * Settings-focused sidebar. Mirrors the AppSidebar shell (workspace
 * switcher at the top, body, bottom chrome) so the layout stays stable
 * when the user navigates into /app/settings. The body lists every
 * Settings section as an in-page anchor jump (`#settings-*`) and the
 * top row shows a clear "Back to workspace" link that returns the user
 * to /app and swaps the sidebar back.
 */
export function SettingsSidebar({
  userEmail,
  workspaceName = "My Workspace",
  workspaceId,
  workspaces = [],
}: SettingsSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Settings navigation"
      className={cn(
        "flex h-full w-60 shrink-0 flex-col",
        "bg-card border-r border-border",
      )}
    >
      {/* Workspace switcher (same as main sidebar) */}
      <div className="px-2 pt-2 pb-1">
        <WorkspaceSwitcher
          workspaces={
            workspaces.length > 0
              ? workspaces
              : workspaceId
                ? [{ id: workspaceId, name: workspaceName, slug: "" }]
                : []
          }
          activeWorkspaceId={workspaceId ?? ""}
        />
      </div>

      <Separator className="mx-2 mb-1 bg-border" />

      {/* Back to workspace */}
      <div className="px-2 pt-1 pb-1">
        <Link
          href="/app"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150",
            "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          )}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Back to workspace</span>
        </Link>
      </div>

      <Separator className="mx-2 my-1 bg-border" />

      {/* Settings section header */}
      <div className="flex items-center text-overline text-muted-foreground/70 px-2.5 py-1.5">
        Settings
      </div>

      {/* Settings sections */}
      <ScrollArea className="flex-1 px-2">
        <ul className="flex flex-col gap-0.5 list-none">
          {accountNav.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <Link
                href={`/app/settings#settings-${id}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150",
                  "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-4 mb-1 flex items-center text-overline text-muted-foreground/70 px-2.5">
          Developer &amp; Apps
        </div>
        <ul className="flex flex-col gap-0.5 list-none">
          {developerNav.map(({ href, label, subLabel, icon: Icon }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150",
                    "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    active && "bg-accent text-foreground font-medium",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate">{label}</span>
                    <span className="truncate text-[11px] text-muted-foreground/70">
                      {subLabel}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 mb-1 flex items-center text-overline text-muted-foreground/70 px-2.5">
          Workspace Operator
        </div>
        <ul className="flex flex-col gap-0.5 list-none">
          {operatorNav.map(({ href, label, subLabel, icon: Icon }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150",
                    "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    active && "bg-accent text-foreground font-medium",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate">{label}</span>
                    <span className="truncate text-[11px] text-muted-foreground/70">
                      {subLabel}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 mb-1 flex items-center text-overline text-muted-foreground/70 px-2.5">
          Workspace admin
        </div>
        <ul className="flex flex-col gap-0.5 list-none">
          {workspaceAdminNav.map(({ href, label, subLabel, icon: Icon }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150",
                    "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    active && "bg-accent text-foreground font-medium",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate">{label}</span>
                    <span className="truncate text-[11px] text-muted-foreground/70">
                      {subLabel}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 mb-1 flex items-center text-overline text-muted-foreground/70 px-2.5">
          Security
        </div>
        <ul className="flex flex-col gap-0.5 list-none">
          {securityNav.map(({ href, label, subLabel, icon: Icon }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150",
                    "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    active && "bg-accent text-foreground font-medium",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate">{label}</span>
                    <span className="truncate text-[11px] text-muted-foreground/70">
                      {subLabel}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      {/* Bottom chrome — matches the main sidebar so the shell feels stable */}
      <div className="border-t border-border">
        <div className="flex items-center justify-between gap-1 px-2 py-1.5">
          <Link
            href="/app/settings"
            aria-label="Settings"
            aria-current={pathname === "/app/settings" ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
              "text-muted-foreground hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              pathname === "/app/settings" && "bg-accent text-foreground font-medium",
            )}
          >
            <AccountSetting01Icon className="h-4 w-4" aria-hidden="true" />
            <span>Settings</span>
          </Link>
          <ThemeToggle />
        </div>
        {userEmail && (
          <div className="border-t border-border px-2 py-2">
            <UserMenu email={userEmail} />
          </div>
        )}
      </div>
    </aside>
  );
}
