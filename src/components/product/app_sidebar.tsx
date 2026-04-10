"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Home, Inbox, LayoutGrid, Plus, Search, Settings } from "lucide-react";
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

// ─── Nav items ────────────────────────────────────────────────────────────────

const primaryNav = [
  { label: "Home", href: "/app", icon: Home },
  { label: "Search", href: "/app/search", icon: Search },
  { label: "Workspaces", href: "/app/workspaces", icon: LayoutGrid },
  { label: "Proposals", href: "/app/proposals", icon: Inbox },
  { label: "Audit log", href: "/app/audit", icon: ClipboardList },
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
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/70"
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
  boxes?: BoxType[];
}

export function AppSidebar({
  userEmail,
  workspaceName = "My Workspace",
  boxes = [],
}: AppSidebarProps) {
  const pathname = usePathname();

  // Extract the current box and note IDs from the pathname
  const boxMatch = pathname.match(/\/app\/boxes\/([^/]+)/);
  const noteMatch = pathname.match(/\/app\/notes\/([^/]+)/);
  const currentBoxId = boxMatch?.[1];
  const currentNoteId = noteMatch?.[1];

  return (
    <aside
      aria-label="Sidebar navigation"
      className={cn(
        "flex h-full w-60 shrink-0 flex-col",
        "border-r border-sidebar-border bg-sidebar"
      )}
    >
      {/* Logo / wordmark */}
      <div
        className="flex h-12 items-center gap-2 border-b border-sidebar-border px-4"
        aria-hidden="true"
      >
        <div className="h-5 w-5 rounded-md bg-foreground" />
        <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
          Context Store
        </span>
      </div>

      {/* Primary navigation */}
      <div className="px-2 pt-3 pb-1">
        <nav aria-label="Primary navigation">
          <ul className="flex flex-col gap-0.5 list-none">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <NavItem
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={pathname === item.href}
                />
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <Separator className="mx-2 my-1 bg-sidebar-border" />

      {/* Workspace label + boxes tree */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-1.5">
          <Link
            href="/app/workspaces"
            className={cn(
              "min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wider",
              "text-sidebar-foreground/40 transition-fast truncate",
              "hover:text-sidebar-foreground/70",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
            )}
            title={`Workspace: ${workspaceName}`}
          >
            {workspaceName}
          </Link>
          <Link
            href="/app/workspaces"
            className={cn(
              "ml-1 shrink-0 rounded p-0.5 text-sidebar-foreground/30 transition-fast",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
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
                "text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
              Create your first box
            </Link>
          ) : (
            <TreeSidebar
              boxes={boxes}
              currentBoxId={currentBoxId}
              currentNoteId={currentNoteId}
            />
          )}
        </ScrollArea>
      </div>

      {/* Bottom chrome */}
      <div className="border-t border-sidebar-border">
        <div className="flex items-center justify-between px-3 py-2">
          <Link
            href="/app/settings"
            aria-label="Settings"
            aria-current={pathname === "/app/settings" ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md p-1.5 text-sidebar-foreground/60 transition-fast",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pathname === "/app/settings" && "text-sidebar-accent-foreground"
            )}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
          </Link>
          <ThemeToggle />
        </div>

        {userEmail && (
          <div className="border-t border-sidebar-border px-2 py-2">
            <UserMenu email={userEmail} />
          </div>
        )}
      </div>
    </aside>
  );
}
