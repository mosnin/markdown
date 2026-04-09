"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  Box,
  ClipboardList,
  Home,
  Inbox,
  Menu,
  Settings,
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
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

/**
 * Mobile navigation sidebar.
 *
 * Renders as a sheet (left-side drawer) on small screens.
 * The trigger button is embedded here so layout is self-contained.
 * Content mirrors the AppSidebar information hierarchy.
 */

const primaryNav = [
  { label: "Home", href: "/app", icon: Home },
  { label: "Workspace", href: "/app/workspaces", icon: Archive },
  { label: "Proposals", href: "/app/proposals", icon: Inbox },
  { label: "Audit log", href: "/app/audit", icon: ClipboardList },
];

interface MobileSidebarProps {
  userEmail?: string;
  workspaceName?: string;
  boxes?: BoxType[];
}

export function MobileSidebar({
  userEmail,
  workspaceName = "My Workspace",
  boxes = [],
}: MobileSidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  function close() {
    setOpen(false);
  }

  return (
    <>
      {/* Hamburger trigger — only visible on mobile */}
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
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-md bg-foreground" aria-hidden="true" />
              <SheetTitle className="text-sm font-semibold tracking-tight text-sidebar-foreground">
                Context Store
              </SheetTitle>
            </div>
            <button
              onClick={close}
              className={cn(
                "flex items-center justify-center rounded-md p-1.5",
                "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              aria-label="Close navigation menu"
            >
              <X className="h-4 w-4" />
            </button>
          </SheetHeader>

          {/* Primary nav */}
          <nav
            aria-label="Primary navigation"
            className="px-2 pt-3 pb-1"
          >
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
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <Separator className="mx-2 my-1 bg-sidebar-border" />

          {/* Workspace boxes */}
          <ScrollArea className="flex-1 px-2 py-1">
            <div className="mb-1 flex items-center justify-between px-2.5 py-1">
              <span className="text-xs font-medium uppercase tracking-wider text-sidebar-foreground/40">
                {workspaceName}
              </span>
            </div>

            {boxes.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-sidebar-foreground/40">
                No boxes yet
              </p>
            ) : (
              <nav aria-label="Boxes">
                <ul className="flex flex-col gap-0.5 list-none">
                  {boxes.map((box) => {
                    const isActive =
                      pathname === `/app/boxes/${box.id}` ||
                      pathname.startsWith(`/app/boxes/${box.id}/`);
                    return (
                      <li key={box.id}>
                        <Link
                          href={`/app/boxes/${box.id}`}
                          onClick={close}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-fast",
                            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/60"
                          )}
                          aria-current={isActive ? "page" : undefined}
                        >
                          <Box className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{box.name}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            )}
          </ScrollArea>

          {/* Bottom chrome */}
          <div className="border-t border-sidebar-border">
            <div className="flex items-center justify-between px-3 py-2">
              <Link
                href="/app/settings"
                onClick={close}
                className={cn(
                  "flex items-center gap-2 rounded-md p-1.5 text-sidebar-foreground/60 transition-fast text-sm",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  pathname === "/app/settings" && "text-sidebar-accent-foreground"
                )}
                aria-label="Settings"
                aria-current={pathname === "/app/settings" ? "page" : undefined}
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                <span>Settings</span>
              </Link>
              <ThemeToggle />
            </div>
            {userEmail && (
              <div className="border-t border-sidebar-border px-2 py-2">
                <UserMenu email={userEmail} />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
