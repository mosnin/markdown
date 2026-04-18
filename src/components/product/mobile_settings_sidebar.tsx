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
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MobileSidebarFooter } from "@/components/product/mobile_sidebar_footer";
import { Separator } from "@/components/ui/separator";

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
 * Mobile variant of the Settings sidebar. Same sheet + primary-nav
 * layout as MobileSidebar so the mobile user sees a stable header,
 * but the body lists Settings sections instead of Home/Search/etc.
 */
export function MobileSettingsSidebar({
  userEmail,
  workspaceName = "My Workspace",
  workspaceId,
  workspaces = [],
}: MobileSettingsSidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  function close() {
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center justify-center rounded-md p-2",
          "text-foreground/70 hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          className="w-72 p-0 bg-sidebar text-sidebar-foreground flex flex-col gap-0"
        >
          <SheetHeader className="flex-row items-center justify-between border-b border-sidebar-border px-4 py-3">
            <SheetTitle className="sr-only">Settings navigation</SheetTitle>
            <button
              onClick={close}
              className={cn(
                "ml-auto flex items-center justify-center rounded-md p-1.5",
                "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-label="Close settings menu"
            >
              <X className="h-4 w-4" />
            </button>
          </SheetHeader>

          {/* Workspace label — inline only. See MobileSidebar for the
              portal-collision rationale that banned nested popup
              primitives inside this Sheet. */}
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

          <Separator className="mx-3 bg-sidebar-border" />

          {/* Back to workspace */}
          <nav aria-label="Navigation" className="px-2 pt-2 pb-1">
            <Link
              href="/app"
              onClick={close}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Back to workspace</span>
            </Link>
          </nav>

          <Separator className="mx-2 my-1 bg-sidebar-border" />

          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
              Settings
            </span>
          </div>

          <nav aria-label="Settings sections" className="flex-1 overflow-y-auto px-2">
            <ul className="flex flex-col gap-0.5 list-none">
              {accountNav.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <Link
                    href={`/app/settings#settings-${id}`}
                    onClick={close}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                      "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 px-2.5 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                Developer &amp; Apps
              </span>
            </div>
            <ul className="flex flex-col gap-0.5 list-none">
              {developerNav.map(({ href, label, subLabel, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm",
                        "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        active && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex flex-col leading-tight">
                        <span>{label}</span>
                        <span className="text-[10px] text-sidebar-foreground/40">
                          {subLabel}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 px-2.5 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                Workspace admin
              </span>
            </div>
            <ul className="flex flex-col gap-0.5 list-none">
              {workspaceAdminNav.map(({ href, label, subLabel, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm",
                        "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        active && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex flex-col leading-tight">
                        <span>{label}</span>
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

          {/* Bottom chrome — inline (non-portaled). See
              MobileSidebarFooter for the portal-collision rationale. */}
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
