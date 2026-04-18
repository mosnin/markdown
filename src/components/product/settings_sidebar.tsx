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
  Palette,
  Shield,
  User,
  Users,
} from "lucide-react";
import { AccountSetting01Icon } from "hugeicons-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";
import { WorkspaceSwitcher } from "@/components/product/workspace_switcher";

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
        "bg-white dark:bg-background border-r border-border/40",
      )}
    >
      {/* Workspace switcher (same as main sidebar) */}
      <div className="px-3 pt-3 pb-2">
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

      <Separator className="mx-3 mb-1" />

      {/* Back to workspace */}
      <div className="px-2 pt-1 pb-1">
        <Link
          href="/app"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
            "text-foreground/60 hover:bg-accent/60 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Back to workspace</span>
        </Link>
      </div>

      <Separator className="mx-2 my-1" />

      {/* Settings section header */}
      <div className="flex items-center px-4 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/40">
          Settings
        </span>
      </div>

      {/* Settings sections */}
      <ScrollArea className="flex-1 px-2">
        <ul className="flex flex-col gap-0.5 list-none">
          {accountNav.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <Link
                href={`/app/settings#settings-${id}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
                  "text-foreground/70 hover:bg-accent/60 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-4 mb-1 flex items-center px-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/40">
            Developer &amp; Apps
          </span>
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
                    "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
                    "text-foreground/70 hover:bg-accent/60 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-accent/60 text-foreground",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate">{label}</span>
                    <span className="truncate text-[10px] text-foreground/40">
                      {subLabel}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 mb-1 flex items-center px-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/40">
            Workspace admin
          </span>
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
                    "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
                    "text-foreground/70 hover:bg-accent/60 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-accent/60 text-foreground",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate">{label}</span>
                    <span className="truncate text-[10px] text-foreground/40">
                      {subLabel}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 mb-1 flex items-center px-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/40">
            Security
          </span>
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
                    "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
                    "text-foreground/70 hover:bg-accent/60 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-accent/60 text-foreground",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate">{label}</span>
                    <span className="truncate text-[10px] text-foreground/40">
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
      <div className="border-t border-border/40">
        <div className="flex items-center justify-between px-3 py-2">
          <Link
            href="/app/settings"
            aria-label="Settings"
            aria-current={pathname === "/app/settings" ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md p-1.5 text-foreground/50 transition-fast",
              "hover:bg-accent/60 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pathname === "/app/settings" && "text-foreground",
            )}
          >
            <AccountSetting01Icon className="h-4 w-4" aria-hidden="true" />
          </Link>
          <ThemeToggle />
        </div>
        {userEmail && (
          <div className="border-t border-border/40 px-2 py-2">
            <UserMenu email={userEmail} />
          </div>
        )}
      </div>
    </aside>
  );
}
