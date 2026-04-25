"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  LayoutDashboard,
  Plus,
  Undo2,
} from "lucide-react";
import {
  AccountSetting01Icon,
  Alert01Icon,
  DashboardSpeed02Icon,
  Home01Icon,
  LaborIcon,
  Satellite01Icon,
  SearchAreaIcon,
  ToolsIcon,
} from "hugeicons-react";
import { BarChart3, GitFork, Globe, Lightbulb, Network, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Box as BoxType } from "@/server/domain/types/box";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";
import { TreeSidebar } from "@/components/product/tree_sidebar";
import { WorkspaceSwitcher } from "@/components/product/workspace/workspace_switcher";

// ─── Nav items ────────────────────────────────────────────────────────────────

const mainNav: Array<{
  label: string;
  href: string;
  icon: React.ElementType;
  /**
   * Optional keyboard hint rendered as a small <kbd> next to the label.
   * Used to surface that the palette (Cmd/Ctrl+K) is the faster path.
   */
  shortcut?: string;
}> = [
  { label: "Home", href: "/app", icon: Home01Icon },
  { label: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
  { label: "Search", href: "/app/search", icon: SearchAreaIcon, shortcut: "⌘K" },
  { label: "Workspaces", href: "/app/workspaces", icon: Satellite01Icon },
];

const advancedNav = [
  { label: "Agents", href: "/app/agents", icon: LaborIcon },
  { label: "Pog Agent", href: "/app/workspace_operator", icon: Bot },
  { label: "Skills", href: "/app/skills", icon: ToolsIcon },
  { label: "Graph", href: "/app/graph", icon: Network },
  { label: "Insights", href: "/app/insights", icon: Lightbulb },
  { label: "Web sessions", href: "/app/web_sessions", icon: Globe },
  { label: "Sub-agents", href: "/app/sub_agents", icon: Workflow },
  { label: "Workflows", href: "/app/workflows", icon: GitFork },
  { label: "Usage", href: "/app/usage", icon: BarChart3 },
  { label: "Proposals", href: "/app/proposals", icon: Alert01Icon },
  { label: "Branches", href: "/app/branches", icon: GitBranch },
  { label: "History", href: "/app/history", icon: Undo2 },
  { label: "Audit log", href: "/app/audit", icon: DashboardSpeed02Icon },
];

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({
  href,
  icon: Icon,
  label,
  isActive,
  shortcut,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  /** Optional keyboard hint rendered as a trailing <kbd>. */
  shortcut?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-accent text-foreground font-medium"
                : "text-foreground/60 hover:text-foreground hover:bg-accent/60"
            )}
          />
        }
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {shortcut && (
          <kbd
            className="ml-auto hidden items-center rounded border border-border bg-background px-1 text-[10px] font-medium text-muted-foreground/70 md:inline-flex"
            aria-label={`${label} shortcut ${shortcut}`}
          >
            {shortcut}
          </kbd>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Nav item with badge ──────────────────────────────────────────────────────

function NavItemWithBadge({
  href,
  icon: Icon,
  label,
  isActive,
  badge,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  badge: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-accent text-foreground font-medium"
                : "text-foreground/60 hover:text-foreground hover:bg-accent/60"
            )}
          />
        }
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {badge > 0 && (
          <span
            className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-warning/80 px-1 text-[9px] font-bold text-warning-foreground"
            aria-label={`${badge} pending`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="text-xs">
        {label} {badge > 0 ? `(${badge} pending)` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface AppSidebarProps {
  userEmail?: string;
  workspaceName?: string;
  workspaceId?: string;
  boxes?: BoxType[];
  /** All workspaces the user owns; enables the multi-workspace switcher. */
  workspaces?: Array<{ id: string; name: string; slug: string }>;
  /**
   * 5 most-recently-updated notes in the workspace. Powers the "Recent"
   * section between the primary nav and the boxes tree so users can
   * jump back to what they were working on without reorienting via the
   * full box tree each session.
   */
  recentNotes?: Array<{
    id: string;
    title: string;
    box_id: string;
    updated_at: string;
  }>;
  /** Count of pending write proposals — shown as a badge on the Proposals nav item. */
  pendingProposalsCount?: number;
}

export function AppSidebar({
  userEmail,
  workspaceName = "My Workspace",
  workspaceId,
  boxes = [],
  workspaces = [],
  recentNotes,
  pendingProposalsCount = 0,
}: AppSidebarProps) {
  const pathname = usePathname();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Extract the current box and note IDs from the pathname
  const boxMatch = pathname.match(/\/app\/boxes\/([^/]+)/);
  const noteMatch = pathname.match(/\/app\/notes\/([^/]+)/);
  const currentBoxId = boxMatch ? decodeURIComponent(boxMatch[1]) : undefined;
  const currentNoteId = noteMatch ? decodeURIComponent(noteMatch[1]) : undefined;

  return (
    <aside
      aria-label="Sidebar navigation"
      className={cn(
        "flex h-full w-60 shrink-0 flex-col",
        "bg-white dark:bg-background border-r border-border/40"
      )}
    >
      {/* Workspace switcher — multi-workspace dropdown with Create action */}
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

      {/* Primary navigation */}
      <div className="px-2 pt-1 pb-1">
        <nav aria-label="Primary navigation">
          <ul className="flex flex-col gap-0.5 list-none">
            {mainNav.map((item) => (
              <li key={item.href}>
                <NavItem
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  shortcut={item.shortcut}
                  isActive={
                    item.href === "/app"
                      ? pathname === "/app"
                      : pathname === item.href || pathname.startsWith(item.href + "/")
                  }
                />
              </li>
            ))}
          </ul>

          {/* Collapsible Advanced section */}
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setAdvancedOpen((prev) => !prev)}
              className={cn(
                "flex w-full items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider",
                "text-muted-foreground/60 hover:text-foreground transition-colors"
              )}
            >
              {advancedOpen ? (
                <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
              )}
              Advanced
            </button>

            {advancedOpen && (
              <ul className="flex flex-col gap-0.5 list-none">
                {advancedNav.map((item) => (
                  <li key={item.href}>
                    {item.href === "/app/proposals" && pendingProposalsCount > 0 ? (
                      <NavItemWithBadge
                        href={item.href}
                        icon={item.icon}
                        label={item.label}
                        isActive={
                          pathname === item.href || pathname.startsWith(item.href + "/")
                        }
                        badge={pendingProposalsCount}
                      />
                    ) : (
                      <NavItem
                        href={item.href}
                        icon={item.icon}
                        label={item.label}
                        isActive={
                          pathname === item.href || pathname.startsWith(item.href + "/")
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>
      </div>

      <Separator className="mx-2 my-1" />

      {/* Recent notes — most-recently-updated notes in the workspace */}
      {recentNotes && recentNotes.length > 0 && (
        <>
          <div className="px-3 pt-3 pb-1">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Recent
            </p>
            <div className="space-y-0.5">
              {recentNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/app/notes/${note.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                >
                  <FileText
                    className="h-3 w-3 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <span className="truncate">{note.title}</span>
                </Link>
              ))}
              <Link
                href="/app/search"
                className="flex items-center gap-1 px-2 pt-1 pb-0.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                View all
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
          <Separator className="mx-2 my-1" />
        </>
      )}

      {/* Workspace label + boxes tree */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-1.5">
          <Link
            href="/app/workspaces"
            className={cn(
              "min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wider",
              "text-foreground/40 transition-fast truncate",
              "hover:text-foreground/70",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
            )}
            title={`Workspace: ${workspaceName}`}
          >
            Boxes
          </Link>
          <Link
            href="/app/workspaces"
            className={cn(
              "ml-1 shrink-0 rounded p-0.5 text-foreground/30 transition-fast",
              "hover:bg-accent/60 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
            aria-label="Manage boxes and workspace"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        <ScrollArea className="flex-1 px-2">
          {boxes.length === 0 ? (
            <Link
              href="/app/workspaces"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs transition-fast",
                "text-foreground/40 hover:bg-accent/60 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
              Create your first box
            </Link>
          ) : (
            <TreeSidebar
              boxes={boxes}
              workspaceId={workspaceId}
              currentBoxId={currentBoxId}
              currentNoteId={currentNoteId}
            />
          )}
        </ScrollArea>
      </div>

      {/* Bottom chrome */}
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
              pathname === "/app/settings" && "text-foreground"
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
