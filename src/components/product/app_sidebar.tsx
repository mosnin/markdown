"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, Box, Home, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Box as BoxType } from "@/server/domain/types/box";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/product/theme_toggle";
import { UserMenu } from "@/components/product/user_menu";

// ─── Nav items ────────────────────────────────────────────────────────────────

const primaryNav = [
  { label: "Home", href: "/app", icon: Home },
  { label: "Workspace", href: "/app/workspaces", icon: Archive },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

function navItemClass(isActive: boolean) {
  return cn(
    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
      : "text-sidebar-foreground/70"
  );
}

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
        render={<Link href={href} className={navItemClass(isActive)} />}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Box nav item ─────────────────────────────────────────────────────────────

function BoxNavItem({ box, isActive }: { box: BoxType; isActive: boolean }) {
  return (
    <Link
      href={`/app/boxes/${box.id}`}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-fast",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/60"
      )}
    >
      <Box className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{box.name}</span>
    </Link>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface AppSidebarProps {
  userEmail?: string;
  workspaceName?: string;
  boxes?: BoxType[];
}

export function AppSidebar({
  userEmail,
  workspaceName = "My Workspace",
  boxes = [],
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex h-full w-56 shrink-0 flex-col",
        "border-r border-sidebar-border bg-sidebar"
      )}
    >
      {/* Logo / wordmark */}
      <div className="flex h-12 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="h-5 w-5 rounded-md bg-foreground" />
        <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
          Context Store
        </span>
      </div>

      {/* Primary navigation */}
      <div className="px-2 pt-3 pb-1">
        <nav className="flex flex-col gap-0.5">
          {primaryNav.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              isActive={pathname === item.href}
            />
          ))}
        </nav>
      </div>

      <Separator className="mx-2 my-1 bg-sidebar-border" />

      {/* Workspace boxes */}
      <ScrollArea className="flex-1 px-2 py-1">
        <div className="mb-1 flex items-center justify-between px-2.5 py-1">
          <span className="text-xs font-medium uppercase tracking-wider text-sidebar-foreground/40">
            {workspaceName}
          </span>
          <Link
            href="/app/workspaces"
            className="rounded p-0.5 text-sidebar-foreground/40 transition-fast hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title="Workspace"
          >
            <Plus className="h-3 w-3" />
          </Link>
        </div>

        {boxes.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-sidebar-foreground/40">
            No boxes yet
          </p>
        ) : (
          <nav className="flex flex-col gap-0.5">
            {boxes.map((box) => (
              <BoxNavItem
                key={box.id}
                box={box}
                isActive={pathname === `/app/boxes/${box.id}` || pathname.startsWith(`/app/boxes/${box.id}/`)}
              />
            ))}
          </nav>
        )}
      </ScrollArea>

      {/* Bottom chrome */}
      <div className="border-t border-sidebar-border">
        <div className="flex items-center justify-between px-3 py-2">
          <Link
            href="/app/settings"
            className={cn(
              "flex items-center gap-2 rounded-md p-1.5 text-sidebar-foreground/60 transition-fast",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              pathname === "/app/settings" && "text-sidebar-accent-foreground"
            )}
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <ThemeToggle />
        </div>

        {userEmail && (
          <div className="border-t border-sidebar-border px-2 py-2">
            <UserMenu email={userEmail} />
          </div>
        )}
      </div>
    </aside>
  );
}
