"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  ChevronRight,
  GitBranch,
  GitFork,
  Home,
  Inbox,
  Menu,
  Network,
  Plug,
  Plus,
  Puzzle,
  X,
} from "lucide-react";
import * as m from "motion/react-m";
import { staggerContainer, fadeRise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { type Box as BoxType } from "@/server/domain/types/box";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MobileSidebarFooter } from "@/components/product/shell/mobile_sidebar_footer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MobileNavBackdrop } from "@/components/product/shell/mobile_nav_ascii_bg";
import { GlyphReveal } from "@/components/product/shell/glyph_reveal";
import { TreeSidebar } from "@/components/product/tree_sidebar";

/**
 * Mobile navigation sidebar.
 *
 * Renders as a full-screen sheet on small screens (the only place it mounts —
 * see AppShell's `md:hidden` top bar). The full-screen surface is treated like
 * a launch screen: an animated ASCII "context field" backdrop (see
 * MobileNavBackdrop), terminal-styled primary routes that decrypt into place
 * (see GlyphReveal), and the expandable collection tree below. Content mirrors
 * the AppSidebar information hierarchy.
 */

// One-loop focus (Phase 2): the mobile nav mirrors AppSidebar — only Home,
// Connect agent, and AI Edits (proposals) in the primary nav. The Build/Explore
// destinations (Skills / Agents / Workflows / Branches / Graph) and their
// routes still exist; they are hidden here. Flip `FOCUSED_NAV` to `false` to
// restore them.
const FOCUSED_NAV: boolean = true;

const coreNav = [
  { label: "Home", href: "/app", icon: Home },
  { label: "Connect agent", href: "/app/connect", icon: Plug },
  { label: "AI Edits", href: "/app/proposals", icon: Inbox },
];

const extendedNav = [
  { label: "Skills", href: "/app/skills", icon: Puzzle },
  { label: "Agents", href: "/app/agents", icon: Bot },
  { label: "Workflows", href: "/app/workflows", icon: GitFork },
  { label: "Branches", href: "/app/branches", icon: GitBranch },
  { label: "Graph", href: "/app/graph", icon: Network },
];

const primaryNav = FOCUSED_NAV ? coreNav : [...coreNav, ...extendedNav];

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

  // `workspaces` is accepted for API parity with the desktop sidebar; the
  // switcher itself lives at /app/workspaces (no nested popup inside the sheet).
  void workspaces;

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
          className="w-screen max-w-none border-0 p-0 bg-sidebar text-sidebar-foreground data-[side=left]:sm:max-w-none flex flex-col gap-0 overflow-hidden"
        >
          {/* Animated ASCII context-field backdrop. */}
          <MobileNavBackdrop />

          <SheetTitle className="sr-only">Navigation</SheetTitle>

          <m.div
            className="relative z-10 flex h-full flex-col overflow-hidden"
            variants={staggerContainer(0.05, 0.04)}
            initial="hidden"
            animate="visible"
          >
            {/* Header — wordmark decrypts in, close button */}
            <m.div
              variants={fadeRise}
              className="flex items-center justify-between px-5 pb-4"
              style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}
            >
              <Link href="/app" onClick={close} className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 shadow-[0_0_24px_-4px] shadow-violet-600/60">
                  <div className="h-3 w-3 rounded-sm bg-white" />
                </div>
                <GlyphReveal
                  text="Poggle"
                  className="font-display text-lg font-semibold tracking-tight text-sidebar-foreground"
                  delayMs={40}
                />
              </Link>
              <button
                onClick={close}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-fast",
                  "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </button>
            </m.div>

            {/* Workspace pill → manage */}
            <m.div variants={fadeRise} className="px-5 pb-1">
              <Link
                href="/app/workspaces"
                onClick={close}
                className={cn(
                  "group flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 transition-fast",
                  "border border-sidebar-border/60 bg-sidebar-accent/30 backdrop-blur-sm",
                  "hover:bg-sidebar-accent/55",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
                title={`Workspace: ${workspaceName}`}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-violet-400/70">
                    Workspace
                  </span>
                  <span className="block truncate font-display text-sm text-sidebar-foreground">
                    {workspaceName}
                  </span>
                </span>
                <span className="shrink-0 rounded-md px-2 py-1 text-[11px] text-sidebar-foreground/60 group-hover:text-sidebar-foreground/90">
                  Manage
                </span>
              </Link>
            </m.div>

            {/* Primary nav — big terminal routes */}
            <nav aria-label="Primary navigation" className="px-3 pt-3">
              <m.ul
                variants={staggerContainer(0.06, 0.06)}
                className="flex list-none flex-col gap-1"
              >
                {primaryNav.map((item, i) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <m.li key={item.href} variants={fadeRise}>
                      <Link
                        href={item.href}
                        onClick={close}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group relative flex items-center gap-3.5 rounded-xl px-3.5 py-3.5 transition-fast",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                        )}
                      >
                        {isActive && (
                          <span
                            className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-violet-500"
                            aria-hidden="true"
                          />
                        )}
                        <span className="w-6 font-mono text-xs tabular-nums text-violet-400/60">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                        <GlyphReveal
                          text={item.label}
                          className="font-display text-lg tracking-tight"
                          delayMs={120 + i * 70}
                        />
                        <span className="ml-auto flex items-center gap-2">
                          {item.href === "/app/proposals" &&
                            pendingProposalsCount > 0 && (
                              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1.5 text-[10px] font-semibold text-white">
                                {pendingProposalsCount}
                              </span>
                            )}
                          <ChevronRight
                            className="h-4 w-4 text-sidebar-foreground/30 transition-fast group-hover:translate-x-0.5 group-hover:text-sidebar-foreground/60"
                            aria-hidden="true"
                          />
                        </span>
                      </Link>
                    </m.li>
                  );
                })}
              </m.ul>
            </nav>

            {/* Collections divider */}
            <m.div variants={fadeRise} className="flex items-center gap-2 px-5 pb-2 pt-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">
                Collections
              </span>
              <span className="h-px flex-1 bg-sidebar-border/60" />
            </m.div>

            {/* Box tree */}
            <ScrollArea className="flex-1 px-3">
              {boxes.length === 0 ? (
                <Link
                  href="/app/workspaces"
                  onClick={close}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm transition-fast",
                    "text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  )}
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
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

            {/* Bottom chrome — inline (non-portaled). All popup-primitive
                children (workspace switcher, user menu, theme tooltip) are kept
                OUT of this sheet to avoid Base UI Floating UI portals nesting
                inside the Sheet's own portal — which blocked the sheet from
                opening on mobile. See MobileSidebarFooter for the rationale. */}
            <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
              <MobileSidebarFooter
                userEmail={userEmail}
                isSettingsActive={pathname === "/app/settings"}
                onNavigate={close}
              />
            </div>
          </m.div>
        </SheetContent>
      </Sheet>
    </>
  );
}
