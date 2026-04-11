"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  ChevronDown,
  ClipboardList,
  Home,
  Inbox,
  LayoutGrid,
  Plus,
  Search,
  Settings,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type Box as BoxType } from "@/server/domain/types/box";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";
import { TreeSidebar } from "@/components/product/tree_sidebar";

// ─── Nav items ────────────────────────────────────────────────────────────────

const primaryNav = [
  { label: "Home", href: "/app", icon: Home },
  { label: "Search", href: "/app/search", icon: Search },
  { label: "Workspaces", href: "/app/workspaces", icon: LayoutGrid },
  { label: "Agents", href: "/app/agents", icon: Bot },
  { label: "Skills", href: "/app/skills", icon: Zap },
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
}

export function AppSidebar({
  userEmail,
  workspaceName = "My Workspace",
  workspaceId,
  boxes = [],
}: AppSidebarProps) {
  const pathname = usePathname();

  // Extract the current box and note IDs from the pathname
  const boxMatch = pathname.match(/\/app\/boxes\/([^/]+)/);
  const noteMatch = pathname.match(/\/app\/notes\/([^/]+)/);
  const currentBoxId = boxMatch ? decodeURIComponent(boxMatch[1]) : undefined;
  const currentNoteId = noteMatch ? decodeURIComponent(noteMatch[1]) : undefined;

  // Derive initials for the workspace avatar pill
  const workspaceInitial = (workspaceName ?? "W").charAt(0).toUpperCase();

  return (
    <aside
      aria-label="Sidebar navigation"
      className={cn(
        "flex h-full w-60 shrink-0 flex-col",
        "bg-white dark:bg-background border-r border-border/40"
      )}
    >
      {/* Workspace selector pill */}
      <div className="px-3 pt-3 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 transition-fast",
              "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
            aria-label={`Workspace: ${workspaceName}`}
          >
            {/* Avatar initial */}
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[11px] font-semibold text-background">
              {workspaceInitial}
            </div>
            {/* Workspace name */}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground text-left">
              {workspaceName}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/40" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {workspaceName}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/app/workspaces" />}>
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              Manage boxes
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/app/settings" />}>
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              Workspace settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
      <div className="flex min-h-0 flex-1 flex-col">
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
            <Settings className="h-4 w-4" aria-hidden="true" />
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
