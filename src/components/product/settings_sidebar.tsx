"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Building2,
  CreditCard,
  Key,
  Palette,
  Shield,
  User,
} from "lucide-react";
import { AccountSetting01Icon } from "hugeicons-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";
import { WorkspaceSwitcher } from "@/components/product/workspace_switcher";

const settingsNav = [
  { id: "profile", label: "Profile", icon: User },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "billing", label: "Billing & Plans", icon: CreditCard },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "connections", label: "Connections", icon: Key },
  { id: "security", label: "Security", icon: Shield },
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
          {settingsNav.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <a
                href={`#settings-${id}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
                  "text-foreground/70 hover:bg-accent/60 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </a>
            </li>
          ))}
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
