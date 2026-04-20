"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, GitBranch, Plus, Undo2 } from "lucide-react";
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
import { WorkspaceSwitcher } from "@/components/product/workspace_switcher";

// ─── Nav items ────────────────────────────────────────────────────────────────

const primaryNav = [
  { label: "Home", href: "/app", icon: Home01Icon },
  { label: "Search", href: "/app/search", icon: SearchAreaIcon },
  { label: "Workspaces", href: "/app/workspaces", icon: Satellite01Icon },
  { label: "Agents", href: "/app/agents", icon: LaborIcon },
  { label: "Pog Agent", href: "/app/workspace_operator", icon: Bot },
  { label: "Skills", href: "/app/skills", icon: ToolsIcon },
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
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
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
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="text-xs">
        {label}
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
}

export function AppSidebar({
  userEmail,
  workspaceName = "My Workspace",
  workspaceId,
  boxes = [],
  workspaces = [],
}: AppSidebarProps) {
  const pathname = usePathname();

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
            {primaryNav.map((item) => (
              <li key={item.href}>
                <NavItem
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={
                    item.href === "/app"
                      ? pathname === "/app"
                      : pathname === item.href || pathname.startsWith(item.href + "/")
                  }
                />
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <Separator className="mx-2 my-1" />

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
