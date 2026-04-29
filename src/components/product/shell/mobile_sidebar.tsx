"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Home,
  Inbox,
  Menu,
  Plus,
  Search,
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
  { label: "Search", href: "/app/search", icon: Search },
  { label: "AI", href: "/app/workspace_operator", icon: Bot },
  { label: "AI Edits", href: "/app/proposals", icon: Inbox },
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
      {/* Hamburger trigger */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center justify-center rounded-md p-2",
          "text-foreground/70 hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className="w-72 p-0 bg-sidebar text-sidebar-foreground flex flex-col gap-0"
        >
          {/* Header */}
          <SheetHeader className="flex-row items-center justify-between border-b border-sidebar-border px-4 py-3">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <button
              onClick={close}
              className={cn(
                "ml-auto flex items-center justify-center rounded-md p-1.5",
                "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                  Workspace
                </p>
                <p
                  className="truncate text-sm font-semibold text-sidebar-foreground"
                  title={workspaceName}
                >
                  {workspaceName}
                </p>
              </div>
              <Link
                href="/app/workspaces"
                onClick={close}
                className="shrink-0 rounded-md px-2 py-1 text-[11px] text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                Manage
              </Link>
            </div>
          </div>

          {/* Primary nav */}
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
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
                        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/70"
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {item.label}
                      {item.href === "/app/proposals" && pendingProposalsCount > 0 && (
                        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                          {pendingProposalsCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <Separator className="mx-2 my-1 bg-sidebar-border" />

          {/* Workspace + tree */}
          <div className="flex items-center justify-between px-4 py-2">
            <Link
              href="/app/workspaces"
              onClick={close}
              className={cn(
                "min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wider truncate",
                "text-sidebar-foreground/40 transition-fast",
                "hover:text-sidebar-foreground/70",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
              )}
              title={`Workspace: ${workspaceName}`}
            >
              {workspaceName}
            </Link>
          </div>

          <ScrollArea className="flex-1 px-2">
            {boxes.length === 0 ? (
              <Link
                href="/app/workspaces"
                onClick={close}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs transition-fast",
                  "text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
