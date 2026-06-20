"use client";

/**
 * FloatingShell — Poggle's authenticated dashboard chrome.
 *
 * Owns the nav-mode state ("dock" | "sidebar") and wires a morphing nav into a
 * single animated shell, ported from the reference DashboardShell and adapted
 * to Poggle's violet brand + existing functionality.
 *
 * Architecture:
 * - Desktop (≥lg): the nav is either a bottom DOCK (Apple-style magnify pill)
 *   or a floating SIDEBAR. AnimatePresence cross-fades between them; the
 *   <main> column animates its left padding in sync so content is never
 *   covered, and an inner `mx-auto max-w-7xl` wrapper re-centers the content.
 * - Mobile (<lg): the dock/sidebar are hidden; a persistent bottom tab bar
 *   handles the primary routes, and the existing MobileSidebar drawer (the
 *   hamburger sheet) provides the full box tree + collections.
 * - Mode is persisted in localStorage ("poggle-nav-mode", default "dock"),
 *   read in a mount effect to avoid SSR mismatch, and forced to "dock" below
 *   the lg breakpoint. Honours prefers-reduced-motion (instant, no springs).
 *
 * Token adaptation vs. the reference (baby-blue under legacy names):
 *   orange*            → primary
 *   charcoal* surfaces → background / card (handled by Poggle's oklch tokens)
 *   blue glow rgba(90,176,232,α) → violet rgba(139,92,246,α)
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as m from "motion/react-m";
import {
  AnimatePresence,
  LayoutGroup,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  ChevronRight,
  FileText,
  PanelLeft,
  PanelLeftClose,
  Plug,
  Plus,
} from "lucide-react";
import {
  AccountSetting01Icon,
  Alert01Icon,
  Home01Icon,
} from "hugeicons-react";
import { cn } from "@/lib/utils";
import { type Box as BoxType } from "@/server/domain/types/box";
import { AsciiField } from "@/components/product/ascii_field";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";
import { TreeSidebar } from "@/components/product/tree_sidebar";
import { WorkspaceSwitcher } from "@/components/product/workspace/workspace_switcher";
import { MobileSidebar } from "@/components/product/shell/mobile_sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Shared nav data ──────────────────────────────────────────────────────────

type NavIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

type NavItem = {
  label: string;
  href: string;
  icon: NavIcon;
  /** Pending-proposal badge key — only "AI Edits" uses it. */
  badgeKey?: "proposals";
};

// The primary navigation, preserved verbatim from the legacy AppSidebar
// (FOCUSED_NAV = true): Home, Connect agent, AI Edits (with pending badge).
// Routes + icons match exactly so every existing link is honoured.
const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/app", icon: Home01Icon },
  { label: "Connect agent", href: "/app/connect", icon: Plug },
  { label: "AI Edits", href: "/app/proposals", icon: Alert01Icon, badgeKey: "proposals" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function isActivePath(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(href + "/");
}

type NavMode = "dock" | "sidebar";

const SIDEBAR_WIDTH = 224; // px — the sidebar panel's own width
// When the sidebar floats (left-3 = 12px margin), content shifts by:
//   sidebar width + left margin + gutter between sidebar edge and content
const SIDEBAR_INSET = SIDEBAR_WIDTH + 12 + 16; // 252 px total
const STORAGE_KEY = "poggle-nav-mode";
const LG_BREAKPOINT = 1024;

// ── Dock magnification constants (verbatim from reference) ───────────────────
const BASE = 46;
const MAX = 78;
const MAX_TOUCH = 52; // gentler max on coarse-pointer (touch) devices
const ICON_BASE = 20;
const ICON_MAX = 34;
const ICON_MAX_TOUCH = 24;
const RADIUS = 130;

// Springs
const MORPH_SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };
const INSET_SPRING = { type: "spring" as const, stiffness: 260, damping: 32 };
const TOUCH_SPRING = { mass: 0.15, stiffness: 120, damping: 20 };
const SHARED_EASE = [0.16, 1, 0.3, 1] as const;

// ── DockNavButton (ported verbatim; tokens swapped) ──────────────────────────

function DockNavButton({
  item,
  mouseX,
  active,
  isTouch,
  badge,
}: {
  item: NavItem;
  mouseX: MotionValue<number>;
  active: boolean;
  isTouch: boolean;
  badge: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const Icon = item.icon;

  const sizeMax = isTouch ? MAX_TOUCH : MAX;
  const iconMax = isTouch ? ICON_MAX_TOUCH : ICON_MAX;
  const spring = isTouch
    ? TOUCH_SPRING
    : { mass: 0.1, stiffness: 170, damping: 14 };

  const distance = useTransform(mouseX, (val) => {
    const b = ref.current?.getBoundingClientRect() ?? { x: 0, width: BASE };
    return val - b.x - b.width / 2;
  });

  const size = useSpring(
    useTransform(distance, [-RADIUS, 0, RADIUS], [BASE, sizeMax, BASE]),
    spring
  );
  const iconSize = useSpring(
    useTransform(distance, [-RADIUS, 0, RADIUS], [ICON_BASE, iconMax, ICON_BASE]),
    spring
  );

  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
    >
      <m.div
        ref={ref}
        style={{ width: size, height: size }}
        className="group relative flex items-center justify-center"
      >
        {/* Tooltip */}
        <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-2.5 py-1 text-xs font-medium opacity-0 shadow-lg backdrop-blur-md transition-opacity duration-150 group-hover:opacity-100">
          {item.label}
        </span>

        <m.span
          className={cn(
            "flex h-full w-full items-center justify-center rounded-full transition-colors",
            active
              ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          )}
          transition={MORPH_SPRING}
        >
          <m.span style={{ width: iconSize, height: iconSize }} className="flex">
            <Icon className="h-full w-full" strokeWidth={2} />
          </m.span>
        </m.span>

        {/* Pending-proposals badge */}
        {item.badgeKey === "proposals" && badge > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-warning/90 px-1 text-[9px] font-bold text-warning-foreground"
            aria-label={`${badge} pending`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}

        {/* Running-app dot */}
        {active && (
          <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary" />
        )}
      </m.div>
    </Link>
  );
}

// ── Dock (desktop only — hidden on mobile via lg: prefix) ────────────────────

function Dock({
  onOpenSidebar,
  pendingProposalsCount,
}: {
  onOpenSidebar: () => void;
  pendingProposalsCount: number;
}) {
  const pathname = usePathname();
  const mouseX = useMotionValue(Infinity);

  // Detect coarse-pointer (touch) devices — disable aggressive magnification.
  // Initialised lazily (client-only) to avoid SSR mismatch.
  const [isTouch] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(pointer: coarse)").matches
      : false
  );

  const sizeMax = isTouch ? MAX_TOUCH : MAX;
  const iconMax = isTouch ? ICON_MAX_TOUCH : ICON_MAX;
  const sidebarSpring = isTouch
    ? TOUCH_SPRING
    : { mass: 0.1, stiffness: 170, damping: 14 };

  // Sidebar-toggle magnify
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sidebarDistance = useTransform(mouseX, (val) => {
    const b = sidebarRef.current?.getBoundingClientRect() ?? { x: 0, width: BASE };
    return val - b.x - b.width / 2;
  });
  const sidebarSize = useSpring(
    useTransform(sidebarDistance, [-RADIUS, 0, RADIUS], [BASE, sizeMax, BASE]),
    sidebarSpring
  );
  const sidebarIcon = useSpring(
    useTransform(
      sidebarDistance,
      [-RADIUS, 0, RADIUS],
      [ICON_BASE, iconMax, ICON_BASE]
    ),
    sidebarSpring
  );

  return (
    <m.nav
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: SHARED_EASE, delay: 0.1 }}
      className="fixed bottom-5 left-1/2 z-50 hidden -translate-x-1/2 px-3 lg:block"
      aria-label="Primary"
      style={{ borderRadius: 9999 }}
    >
      <div
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className="flex items-end gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-2 shadow-xl shadow-black/10 backdrop-blur-2xl"
      >
        {NAV_ITEMS.map((item) => (
          <DockNavButton
            key={item.href}
            item={item}
            mouseX={mouseX}
            active={isActivePath(pathname, item.href)}
            isTouch={isTouch}
            badge={pendingProposalsCount}
          />
        ))}

        <span
          className="mx-0.5 mb-3 h-7 w-px self-center bg-border/60"
          aria-hidden="true"
        />

        {/* Sidebar toggle — desktop only */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Switch to sidebar navigation"
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        >
          <m.div
            ref={sidebarRef}
            style={{ width: sidebarSize, height: sidebarSize }}
            className="group relative flex items-center justify-center"
          >
            <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-2.5 py-1 text-xs font-medium opacity-0 shadow-lg backdrop-blur-md transition-opacity duration-150 group-hover:opacity-100">
              Sidebar
            </span>
            <span className="flex h-full w-full items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
              <m.span
                style={{ width: sidebarIcon, height: sidebarIcon }}
                className="flex"
              >
                <PanelLeft className="h-full w-full" />
              </m.span>
            </span>
          </m.div>
        </button>
      </div>
    </m.nav>
  );
}

// ── Floating sidebar ─────────────────────────────────────────────────────────

type SidebarData = {
  userEmail?: string;
  workspaceName?: string;
  workspaceId?: string;
  boxes?: BoxType[];
  workspaces?: Array<{ id: string; name: string; slug: string }>;
  recentNotes?: Array<{
    id: string;
    title: string;
    box_id: string;
    updated_at: string;
  }>;
  pendingProposalsCount?: number;
};

function Sidebar({
  onCloseSidebar,
  userEmail,
  workspaceName = "My Workspace",
  workspaceId,
  boxes = [],
  workspaces = [],
  recentNotes,
  pendingProposalsCount = 0,
}: SidebarData & { onCloseSidebar: () => void }) {
  const pathname = usePathname();

  const boxMatch = pathname.match(/\/app\/boxes\/([^/]+)/);
  const noteMatch = pathname.match(/\/app\/notes\/([^/]+)/);
  const currentBoxId = boxMatch ? decodeURIComponent(boxMatch[1]) : undefined;
  const currentNoteId = noteMatch ? decodeURIComponent(noteMatch[1]) : undefined;

  return (
    <m.nav
      key="sidebar"
      initial={{ x: -(SIDEBAR_WIDTH + 24), opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -(SIDEBAR_WIDTH + 24), opacity: 0 }}
      transition={MORPH_SPRING}
      className="fixed inset-y-3 left-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-background/95 shadow-xl backdrop-blur-2xl"
      style={{ width: SIDEBAR_WIDTH }}
      aria-label="Primary sidebar"
    >
      {/* Subtle ASCII texture behind the nav content */}
      <AsciiField className="pointer-events-none absolute inset-0 opacity-[0.06] dark:opacity-25" />

      {/* All nav content sits on top of the ASCII field */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* ── Brand / workspace switcher ── */}
        <div className="shrink-0 px-3 pb-2 pt-3">
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

        {/* ── Primary nav ── */}
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {NAV_ITEMS.map((item, i) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            const badge =
              item.badgeKey === "proposals" ? pendingProposalsCount : 0;
            return (
              <m.div
                key={item.href}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...MORPH_SPRING, delay: i * 0.035 }}
              >
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  )}
                >
                  <span className="flex h-5 w-5 shrink-0">
                    <Icon
                      className="h-full w-full"
                      strokeWidth={active ? 2.2 : 2}
                    />
                  </span>
                  <span className="truncate">{item.label}</span>
                  {badge > 0 && (
                    <span
                      className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-warning/80 px-1 text-[9px] font-bold text-warning-foreground"
                      aria-label={`${badge} pending`}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                  {active && !badge && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </Link>
              </m.div>
            );
          })}
        </div>

        {/* ── Scrollable Collections: recent notes + box tree ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border/40">
          {/* Recent notes */}
          {recentNotes && recentNotes.length > 0 && (
            <div className="shrink-0 px-3 pb-1 pt-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground/40">
                Recent
              </p>
              <div className="space-y-0.5">
                {recentNotes.map((note) => (
                  <Link
                    key={note.id}
                    href={`/app/notes/${note.id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  className="flex items-center gap-1 px-2 pb-0.5 pt-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View all
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          )}

          {/* Collections label + boxes tree */}
          <div className="flex items-center justify-between px-4 py-1.5">
            <Link
              href="/app/workspaces"
              className={cn(
                "min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-foreground/40 transition-colors",
                "hover:text-foreground/70",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
              )}
              title={`Workspace: ${workspaceName}`}
            >
              Collections
            </Link>
            <Link
              href="/app/workspaces"
              className={cn(
                "ml-1 shrink-0 rounded p-0.5 text-foreground/30 transition-colors",
                "hover:bg-accent/60 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  "flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs transition-colors",
                  "text-foreground/40 hover:bg-accent/60 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        {/* ── Footer: settings + theme + collapse + user ── */}
        <div className="shrink-0 border-t border-border/40">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-1">
              <Link
                href="/app/settings"
                aria-label="Settings"
                aria-current={pathname === "/app/settings" ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md p-1.5 text-foreground/50 transition-colors",
                  "hover:bg-accent/60 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  pathname === "/app/settings" && "text-foreground"
                )}
              >
                <AccountSetting01Icon className="h-4 w-4" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={onCloseSidebar}
                aria-label="Switch to dock navigation"
                className={cn(
                  "flex items-center gap-2 rounded-md p-1.5 text-foreground/50 transition-colors",
                  "hover:bg-accent/60 hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <ThemeToggle />
          </div>

          {userEmail && (
            <div className="border-t border-border/40 px-2 py-2">
              <UserMenu email={userEmail} />
            </div>
          )}
        </div>
      </div>
    </m.nav>
  );
}

// ── MobileBottomNav — persistent bottom tab bar (mobile only) ─────────────────

function MobileBottomNav({
  pendingProposalsCount,
  treeButton,
}: {
  pendingProposalsCount: number;
  treeButton: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-md items-center justify-around gap-0.5 rounded-2xl border border-border/60 bg-background/90 px-1.5 py-1.5 shadow-xl shadow-black/10 backdrop-blur-2xl">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);
          const badge =
            item.badgeKey === "proposals" ? pendingProposalsCount : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className="flex flex-1 items-center justify-center py-0.5 focus-visible:outline-none"
            >
              <span
                className={cn(
                  "relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
                  active ? "bg-primary/15 text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
                {badge > 0 && (
                  <span
                    className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-warning/90 px-1 text-[9px] font-bold text-warning-foreground"
                    aria-label={`${badge} pending`}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
            </Link>
          );
        })}

        {/* Box tree / collections — opens the existing mobile drawer */}
        <div className="flex flex-1 items-center justify-center py-0.5">
          {treeButton}
        </div>
      </div>
    </nav>
  );
}

// ── FloatingShell (main export) ──────────────────────────────────────────────

export function FloatingShell({
  children,
  userEmail,
  workspaceName,
  workspaceId,
  boxes = [],
  workspaces = [],
  recentNotes,
  pendingProposalsCount = 0,
}: SidebarData & { children: ReactNode }) {
  const prefersReduced = useReducedMotion();

  // ── Nav mode — persisted, forced to dock below lg ──────────────────────
  const [mode, setMode] = useState<NavMode>("dock");
  const [hydrated, setHydrated] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // Hydration + localStorage read (canonical next-themes pattern: read browser
  // APIs in an effect on mount so SSR and first client render agree).
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as NavMode | null;
    const desktop = window.innerWidth >= LG_BREAKPOINT;
    setIsDesktop(desktop); // eslint-disable-line react-hooks/set-state-in-effect
    if (stored === "sidebar" && desktop) setMode("sidebar");
    setHydrated(true);
  }, []);

  // Resize listener — force dock below lg.
  useEffect(() => {
    const onResize = () => {
      const desktop = window.innerWidth >= LG_BREAKPOINT;
      setIsDesktop(desktop);
      if (!desktop) setMode("dock");
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setNavMode = useCallback((next: NavMode) => {
    setMode(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const openSidebar = useCallback(() => setNavMode("sidebar"), [setNavMode]);
  const closeSidebar = useCallback(() => setNavMode("dock"), [setNavMode]);

  const isSidebar = mode === "sidebar" && isDesktop && hydrated;

  // Content inset — slides right to clear the floating sidebar.
  const contentPaddingLeft = isSidebar ? SIDEBAR_INSET : 0;
  const contentTransition = prefersReduced ? { duration: 0 } : INSET_SPRING;

  return (
    <LayoutGroup>
      {/* Full-height, overflow-hidden shell — preserves the fixed-height ancestor
          chain the app pages rely on (their internal ScrollArea / flex-1 regions
          do the scrolling, not the document). */}
      <div className="flex h-full w-full overflow-hidden bg-background">
        {/* ── Main content — animated inset; inner column re-centers (max-w-7xl)
            so content stays put and just slides when the sidebar opens. The
            paddingLeft is the only animated property; it does not affect the
            inner column's own scroll. This is a div (not <main>) — the single
            <main id="main-content"> landmark lives inside `children`, supplied
            by the layout, so we avoid nesting two <main> elements. ── */}
        <m.div
          animate={{ paddingLeft: contentPaddingLeft }}
          transition={contentTransition}
          className="flex h-full w-full flex-col overflow-hidden"
        >
          <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden">
            {children}
          </div>
        </m.div>

        {/* ── Desktop nav — dock or floating sidebar ── */}
        <AnimatePresence mode="wait">
          {isSidebar ? (
            <Sidebar
              key="sidebar"
              onCloseSidebar={closeSidebar}
              userEmail={userEmail}
              workspaceName={workspaceName}
              workspaceId={workspaceId}
              boxes={boxes}
              workspaces={workspaces}
              recentNotes={recentNotes}
              pendingProposalsCount={pendingProposalsCount}
            />
          ) : (
            <Dock
              key="dock"
              onOpenSidebar={openSidebar}
              pendingProposalsCount={pendingProposalsCount}
            />
          )}
        </AnimatePresence>

        {/* ── Mobile bottom tab bar (lg:hidden) ── */}
        <MobileBottomNav
          pendingProposalsCount={pendingProposalsCount}
          treeButton={
            <MobileSidebar
              userEmail={userEmail}
              workspaceName={workspaceName}
              workspaceId={workspaceId}
              boxes={boxes}
              workspaces={workspaces}
              pendingProposalsCount={pendingProposalsCount}
            />
          }
        />
      </div>
    </LayoutGroup>
  );
}
