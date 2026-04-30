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
import { MobileSidebarFooter } from "@/components/product/shell/mobile_sidebar_footer";
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
          "inline-flex h-11 w-11 items-center justify-center rounded-md",
          "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
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
          className="flex h-full w-[18rem] flex-col gap-0 border-r border-border bg-card p-0 text-foreground"
        >
          <SheetHeader className="flex-row items-center justify-between border-b border-border px-3 py-2">
            <SheetTitle className="sr-only">Settings navigation</SheetTitle>
            <span className="ml-1 truncate text-sm font-semibold tracking-tight text-foreground">
              Settings
            </span>
            <button
              onClick={close}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              )}
              aria-label="Close settings menu"
            >
              <X className="h-4 w-4" />
            </button>
          </SheetHeader>

          {/* Workspace label — inline only. See MobileSidebar for the
              portal-collision rationale that banned nested popup
              primitives inside this Sheet. */}
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

          <Separator className="mx-3 bg-border" />

          {/* Back to workspace */}
          <nav aria-label="Navigation" className="px-2 pt-2 pb-1">
            <Link
              href="/app"
              onClick={close}
              className={cn(
                "flex h-11 items-center gap-2.5 rounded-md px-2.5 text-[14px]",
                "text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              )}
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Back to workspace</span>
            </Link>
          </nav>

          <Separator className="mx-2 my-1 bg-border" />

          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-overline text-muted-foreground/70">
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
                      "flex h-11 items-center gap-2.5 rounded-md px-2.5 text-[14px]",
                      "text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 text-overline text-muted-foreground/70 px-2.5 py-1.5">
              Developer &amp; Apps
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
                        "flex items-start gap-2.5 rounded-md px-2.5 py-2.5 text-[14px] min-h-11",
                        "text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        active && "bg-accent text-foreground font-medium",
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex flex-col leading-tight">
                        <span>{label}</span>
                        <span className="text-[11px] text-muted-foreground/70">
                          {subLabel}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 text-overline text-muted-foreground/70 px-2.5 py-1.5">
              Workspace admin
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
                        "flex items-start gap-2.5 rounded-md px-2.5 py-2.5 text-[14px] min-h-11",
                        "text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        active && "bg-accent text-foreground font-medium",
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex flex-col leading-tight">
                        <span>{label}</span>
                        <span className="text-[11px] text-muted-foreground/70">
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
