"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppWindow,
  ArrowLeft,
  Bell,
  Building2,
  Code2,
  CreditCard,
  Key,
  Menu,
  Palette,
  Shield,
  Sparkles,
  User,
  Users,
  X,
} from "lucide-react";
import * as m from "motion/react-m";
import { staggerContainer, fadeRise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MobileSidebarFooter } from "@/components/product/shell/mobile_sidebar_footer";
import { MobileNavBackdrop } from "@/components/product/shell/mobile_nav_ascii_bg";
import { GlyphReveal } from "@/components/product/shell/glyph_reveal";

const accountNav = [
  { id: "profile", label: "Profile", icon: User },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "billing", label: "Billing & Plans", icon: CreditCard },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "connections", label: "Connections", icon: Key },
  { id: "security", label: "Security", icon: Shield },
];

const developerNav = [
  {
    href: "/app/settings/oauth_clients",
    label: "OAuth Clients",
    subLabel: "Apps you've registered",
    icon: Code2,
  },
  {
    href: "/app/settings/connected_apps",
    label: "Connected Apps",
    subLabel: "Apps with access to your workspace",
    icon: AppWindow,
  },
];

const workspaceAdminNav = [
  {
    href: "/app/settings/workspace/members",
    label: "Members",
    subLabel: "Invite & manage team members",
    icon: Users,
  },
  {
    href: "/app/settings/workspace/semantic_search",
    label: "Semantic search",
    subLabel: "Reindex vector embeddings",
    icon: Sparkles,
  },
];

interface MobileSettingsSidebarProps {
  userEmail?: string;
  workspaceName?: string;
  workspaceId?: string;
  workspaces?: Array<{ id: string; name: string; slug: string }>;
}

/**
 * Mobile variant of the Settings sidebar.
 *
 * Shares the full-screen launch-screen shell with MobileSidebar — the animated
 * ASCII context-field backdrop and decrypt-in wordmark — so toggling between
 * the main nav and Settings feels like one surface. The body lists Settings
 * sections instead of Home/Connect/AI Edits.
 */
export function MobileSettingsSidebar({
  userEmail,
  workspaceName = "My Workspace",
  workspaceId,
  workspaces = [],
}: MobileSettingsSidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Accepted for API parity with the desktop sidebar; switching happens at
  // /app/workspaces (no nested popup primitives inside the sheet).
  void workspaceId;
  void workspaces;

  function close() {
    setOpen(false);
  }

  const sectionLabel =
    "font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40";
  const rowBase =
    "flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm transition-fast text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center justify-center rounded-md p-2",
          "text-foreground/70 hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        aria-label="Open settings menu"
        aria-expanded={open}
        aria-controls="mobile-settings-sheet"
      >
        <Menu className="h-5 w-5" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          id="mobile-settings-sheet"
          side="left"
          showCloseButton={false}
          className="w-screen max-w-none border-0 p-0 bg-sidebar text-sidebar-foreground data-[side=left]:sm:max-w-none flex flex-col gap-0 overflow-hidden"
        >
          <MobileNavBackdrop />

          <SheetTitle className="sr-only">Settings navigation</SheetTitle>

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
                aria-label="Close settings menu"
              >
                <X className="h-5 w-5" />
              </button>
            </m.div>

            {/* Workspace pill + back to workspace */}
            <m.div variants={fadeRise} className="space-y-1 px-5 pb-1">
              <div
                className="flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 border border-sidebar-border/60 bg-sidebar-accent/30 backdrop-blur-sm"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-violet-400/70">
                    Workspace
                  </span>
                  <span
                    className="block truncate font-display text-sm text-sidebar-foreground"
                    title={workspaceName}
                  >
                    {workspaceName}
                  </span>
                </span>
                <Link
                  href="/app/workspaces"
                  onClick={close}
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] text-sidebar-foreground/60 hover:text-sidebar-foreground/90"
                >
                  Manage
                </Link>
              </div>
            </m.div>

            {/* Back to workspace */}
            <m.nav variants={fadeRise} aria-label="Navigation" className="px-3 pt-2">
              <Link href="/app" onClick={close} className={rowBase}>
                <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="font-display">Back to workspace</span>
              </Link>
            </m.nav>

            <m.div variants={fadeRise} className="flex items-center gap-2 px-5 pb-1 pt-4">
              <span className={sectionLabel}>Settings</span>
              <span className="h-px flex-1 bg-sidebar-border/60" />
            </m.div>

            <nav
              aria-label="Settings sections"
              className="flex-1 overflow-y-auto px-3 pb-2"
            >
              <ul className="flex list-none flex-col gap-0.5">
                {accountNav.map(({ id, label, icon: Icon }) => (
                  <li key={id}>
                    <Link
                      href={`/app/settings#settings-${id}`}
                      onClick={close}
                      className={rowBase}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="font-display">{label}</span>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="px-3.5 pb-1 pt-5">
                <span className={sectionLabel}>Developer &amp; Apps</span>
              </div>
              <ul className="flex list-none flex-col gap-0.5">
                {developerNav.map(({ href, label, subLabel, icon: Icon }) => {
                  const active = pathname === href;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={close}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-start gap-3 rounded-xl px-3.5 py-3 text-sm transition-fast",
                          "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                          active && "bg-sidebar-accent text-sidebar-accent-foreground"
                        )}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="flex flex-col leading-tight">
                          <span className="font-display">{label}</span>
                          <span className="text-[10px] text-sidebar-foreground/40">
                            {subLabel}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <div className="px-3.5 pb-1 pt-5">
                <span className={sectionLabel}>Workspace admin</span>
              </div>
              <ul className="flex list-none flex-col gap-0.5">
                {workspaceAdminNav.map(({ href, label, subLabel, icon: Icon }) => {
                  const active = pathname === href;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={close}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-start gap-3 rounded-xl px-3.5 py-3 text-sm transition-fast",
                          "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                          active && "bg-sidebar-accent text-sidebar-accent-foreground"
                        )}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="flex flex-col leading-tight">
                          <span className="font-display">{label}</span>
                          <span className="text-[10px] text-sidebar-foreground/40">
                            {subLabel}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Bottom chrome — inline (non-portaled). See MobileSidebarFooter
                for the portal-collision rationale. */}
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
