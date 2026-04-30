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
  GitFork,
  Network,
  Plus,
  Puzzle,
} from "lucide-react";
import {
  AccountSetting01Icon,
  Alert01Icon,
  Home01Icon,
} from "hugeicons-react";
import { cn } from "@/lib/utils";
import { type Box as BoxType } from "@/server/domain/types/box";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";
import { TreeSidebar } from "@/components/product/tree_sidebar";
import { WorkspaceSwitcher } from "@/components/product/workspace/workspace_switcher";

// ─── Shared classnames ────────────────────────────────────────────────────────

const NAV_ROW_BASE =
  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const NAV_ROW_INACTIVE =
  "text-muted-foreground hover:text-foreground hover:bg-accent/60";

const NAV_ROW_ACTIVE = "bg-accent text-foreground font-medium";

const SECTION_OVERLINE =
  "text-overline text-muted-foreground/70 px-2.5 py-1.5";

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
              NAV_ROW_BASE,
              isActive ? NAV_ROW_ACTIVE : NAV_ROW_INACTIVE
            )}
          />
        }
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {shortcut && (
          <kbd
            className="ml-auto hidden items-center rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground md:inline-flex"
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
              NAV_ROW_BASE,
              isActive ? NAV_ROW_ACTIVE : NAV_ROW_INACTIVE
            )}
          />
        }
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {badge > 0 && (
          <Badge
            variant="brand"
            className="ml-auto h-4 px-1.5 text-[10px]"
            aria-label={`${badge} pending`}
          >
            {badge > 99 ? "99+" : badge}
          </Badge>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="text-xs">
        {label} {badge > 0 ? `(${badge} pending)` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Section header (collapsible group) ───────────────────────────────────────

function SectionToggle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "group/section flex w-full items-center gap-1",
        SECTION_OVERLINE,
        "transition-colors hover:text-foreground/80",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:rounded"
      )}
      aria-expanded={open}
    >
      <ChevronRight
        className={cn(
          "h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform duration-150",
          open && "rotate-90"
        )}
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
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
  const [buildOpen, setBuildOpen] = useState(true);
  const [exploreOpen, setExploreOpen] = useState(true);

  const buildNav = [
    { label: "Skills", href: "/app/skills", icon: Puzzle },
    { label: "Agents", href: "/app/agents", icon: Bot },
    { label: "Workflows", href: "/app/workflows", icon: GitFork },
    { label: "Branches", href: "/app/branches", icon: GitBranch },
  ];

  const exploreNav = [
    { label: "Knowledge Graph", href: "/app/graph", icon: Network },
  ];

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
        "bg-card border-r border-border"
      )}
    >
      {/* Workspace switcher — multi-workspace dropdown with Create action */}
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

      {/* Primary nav */}
      <div className="px-2 pt-1 pb-1">
        <nav aria-label="Primary navigation">
          <ul className="flex flex-col gap-0.5 list-none">
            <li>
              <NavItem
                href="/app"
                icon={Home01Icon}
                label="Home"
                isActive={pathname === "/app"}
              />
            </li>
            <li>
              <NavItemWithBadge
                href="/app/proposals"
                icon={Alert01Icon}
                label="AI Edits"
                isActive={pathname === "/app/proposals" || pathname.startsWith("/app/proposals/")}
                badge={pendingProposalsCount}
              />
            </li>
          </ul>
        </nav>
      </div>

      {/* Build section */}
      <div className="px-2 pt-2 pb-1">
        <SectionToggle
          label="Build"
          open={buildOpen}
          onToggle={() => setBuildOpen((v) => !v)}
        />
        {buildOpen && (
          <ul className="mt-0.5 flex flex-col gap-0.5 list-none">
            {buildNav.map((item) => (
              <li key={item.href}>
                <NavItem
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Explore section */}
      <div className="px-2 pt-2 pb-1">
        <SectionToggle
          label="Explore"
          open={exploreOpen}
          onToggle={() => setExploreOpen((v) => !v)}
        />
        {exploreOpen && (
          <ul className="mt-0.5 flex flex-col gap-0.5 list-none">
            {exploreNav.map((item) => (
              <li key={item.href}>
                <NavItem
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent notes — most-recently-updated notes in the workspace */}
      {recentNotes && recentNotes.length > 0 && (
        <div className="px-2 pt-2 pb-1">
          <p className={SECTION_OVERLINE}>Recent</p>
          <ul className="flex flex-col gap-0.5 list-none">
            {recentNotes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/app/notes/${note.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]",
                    "text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  )}
                >
                  <FileText
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate">{note.title || "Untitled"}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/app/search"
                className="flex items-center gap-1 px-2.5 pt-1 pb-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                View all
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </li>
          </ul>
        </div>
      )}

      {/* Collections heading + tree */}
      <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-2 pt-2 pb-0.5">
          <Link
            href="/app/workspaces"
            className={cn(
              "min-w-0 flex-1 truncate",
              SECTION_OVERLINE,
              "transition-colors hover:text-foreground/80",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:rounded"
            )}
            title={`Workspace: ${workspaceName}`}
          >
            Collections
          </Link>
          <Link
            href="/app/workspaces"
            className={cn(
              "ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            )}
            aria-label="Manage collections and workspace"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        <ScrollArea className="flex-1 px-2">
          {boxes.length === 0 ? (
            <Link
              href="/app/workspaces"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
                "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              )}
            >
              <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
              Create your first collection
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

      {/* Bottom chrome — settings + theme + user menu */}
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
              pathname === "/app/settings" && "bg-accent text-foreground font-medium"
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
