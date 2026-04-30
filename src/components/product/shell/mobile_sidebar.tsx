"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  GitBranch,
  GitFork,
  Home,
  Inbox,
  Menu,
  Network,
  Plus,
  Puzzle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type Box as BoxType } from "@/server/domain/types/box";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MobileSidebarFooter } from "@/components/product/shell/mobile_sidebar_footer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { TreeSidebar } from "@/components/product/tree_sidebar";

/**
 * Mobile navigation sidebar.
 *
 * Renders as a sheet (left-side drawer) on small screens.
 * Content mirrors the AppSidebar information hierarchy, including
 * the expandable box tree.
 */

const primaryNav = [
  { label: "Home", href: "/app", icon: Home },
  { label: "AI Edits", href: "/app/proposals", icon: Inbox },
  { label: "Skills", href: "/app/skills", icon: Puzzle },
  { label: "Agents", href: "/app/agents", icon: Bot },
  { label: "Workflows", href: "/app/workflows", icon: GitFork },
  { label: "Branches", href: "/app/branches", icon: GitBranch },
  { label: "Graph", href: "/app/graph", icon: Network },
];

interface MobileSidebarProps {
  userEmail?: string;
  workspaceName?: string;
  workspaceId?: string;
  boxes?: BoxType[];
  workspaces?: Array<{ id: string; name: string; slug: string }>;
  pendingProposalsCount?: number;
}

export function MobileSidebar({
  userEmail,
  workspaceName = "My Workspace",
  workspaceId,
  boxes = [],
  workspaces = [],
  pendingProposalsCount = 0,
}: MobileSidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const boxMatch = pathname.match(/\/app\/boxes\/([^/]+)/);
  const noteMatch = pathname.match(/\/app\/notes\/([^/]+)/);
  const currentBoxId = boxMatch ? decodeURIComponent(boxMatch[1]) : undefined;
  const currentNoteId = noteMatch ? decodeURIComponent(noteMatch[1]) : undefined;

  function close() {
    setOpen(false);
  }

  return (
    <>
      {/* Hamburger trigger — 44px tap target */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-md",
          "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        )}
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-nav-sheet"
      >
        <Menu className="h-5 w-5" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          id="mobile-nav-sheet"
          side="left"
          showCloseButton={false}
          className="flex h-full w-[18rem] flex-col gap-0 border-r border-border bg-card p-0 text-foreground"
        >
          {/* Header */}
          <SheetHeader className="flex-row items-center justify-between border-b border-border px-3 py-2">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <span className="ml-1 truncate text-sm font-semibold tracking-tight text-foreground">
              {workspaceName}
            </span>
            <button
              onClick={close}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              )}
              aria-label="Close navigation menu"
            >
              <X className="h-4 w-4" />
            </button>
          </SheetHeader>

          {/* Workspace label + manage link — inline list only. All
              popup-primitive children (workspace switcher, user menu,
              theme tooltip) have been moved out of the sheet to avoid
              Base UI Floating UI portals nesting inside the Sheet's
              own portal, which blocked the sheet from opening on
              mobile. Users switch / create workspaces from
              /app/workspaces. */}
          <div className="px-3 pt-3 pb-1">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-overline text-muted-foreground/70">
                  Workspace
                </p>
                <p
                  className="truncate text-[15px] font-semibold text-foreground"
                  title={workspaceName}
                >
                  {workspaceName}
                </p>
              </div>
              <Link
                href="/app/workspaces"
                onClick={close}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors",
                  "hover:bg-accent hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                )}
              >
                Manage
              </Link>
            </div>
          </div>

          {/* Primary nav — 44px tap targets */}
          <nav aria-label="Primary navigation" className="px-2 pt-3 pb-1">
            <ul className="flex flex-col gap-0.5 list-none">
              {primaryNav.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={close}
                      className={cn(
                        "flex h-11 items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors",
                        "hover:bg-accent/60 hover:text-foreground",
                        isActive
                          ? "bg-accent text-foreground font-medium"
                          : "text-muted-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {item.label}
                      {item.href === "/app/proposals" && pendingProposalsCount > 0 && (
                        <span
                          className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md border border-transparent bg-brand px-1.5 text-[11px] font-medium text-brand-foreground"
                          aria-label={`${pendingProposalsCount} pending`}
                        >
                          {pendingProposalsCount > 99 ? "99+" : pendingProposalsCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <Separator className="mx-2 my-1 bg-border" />

          {/* Collections heading + tree */}
          <div className="flex items-center justify-between px-3 py-2">
            <Link
              href="/app/workspaces"
              onClick={close}
              className={cn(
                "min-w-0 flex-1 truncate text-overline text-muted-foreground/70 transition-colors hover:text-foreground/80",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:rounded"
              )}
              title={`Workspace: ${workspaceName}`}
            >
              Collections
            </Link>
          </div>

          <ScrollArea className="flex-1 px-2">
            {boxes.length === 0 ? (
              <Link
                href="/app/workspaces"
                onClick={close}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
                  "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
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
                onNavigate={close}
              />
            )}
          </ScrollArea>

          {/* Bottom chrome — inline (non-portaled) to keep the Sheet's
              Floating UI portal the only popup portal on the page while
              the sheet is open. See MobileSidebarFooter for details. */}
          <MobileSidebarFooter
            userEmail={userEmail}
            isSettingsActive={pathname === "/app/settings"}
            onNavigate={close}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
