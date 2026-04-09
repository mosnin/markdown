"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  BookOpen,
  Box,
  ChevronRight,
  FolderOpen,
  Home,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/product/theme_toggle";

// ─── Navigation items ────────────────────────────────────────────────────────

const primaryNav = [
  {
    label: "Home",
    href: "/app",
    icon: Home,
  },
  {
    label: "Workspaces",
    href: "/app/workspaces",
    icon: Archive,
  },
];

// Stub workspace tree — replaced with real data in a later prompt.
const stubWorkspace = {
  label: "Personal",
  boxes: [
    { id: "box-1", label: "Research", icon: Box },
    { id: "box-2", label: "Projects", icon: FolderOpen },
    { id: "box-3", label: "Guides", icon: BookOpen },
  ],
};

// ─── Nav item link styles ─────────────────────────────────────────────────────

function navItemClass(isActive: boolean) {
  return cn(
    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-fast",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
      : "text-sidebar-foreground/70"
  );
}

// ─── Rail nav item ───────────────────────────────────────────────────────────

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
      {/* Base UI Tooltip: use render prop instead of asChild */}
      <TooltipTrigger render={<Link href={href} className={navItemClass(isActive)} />}>
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

function BoxNavItem({
  id,
  label,
  icon: Icon,
  isActive,
}: {
  id: string;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
}) {
  return (
    <Link
      href={`/app/boxes/${id}`}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-fast",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/60"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function AppSidebar() {
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

      {/* Workspace tree */}
      <ScrollArea className="flex-1 px-2 py-1">
        {/* Workspace label */}
        <div className="mb-1 flex items-center gap-1 px-2.5 py-1">
          <ChevronRight className="h-3 w-3 text-sidebar-foreground/40" />
          <span className="text-xs font-medium uppercase tracking-wider text-sidebar-foreground/40">
            {stubWorkspace.label}
          </span>
        </div>

        {/* Boxes */}
        <nav className="flex flex-col gap-0.5">
          {stubWorkspace.boxes.map((box) => (
            <BoxNavItem
              key={box.id}
              id={box.id}
              label={box.label}
              icon={box.icon}
              isActive={pathname === `/app/boxes/${box.id}`}
            />
          ))}
        </nav>
      </ScrollArea>

      {/* Bottom actions */}
      <div className="flex items-center justify-between border-t border-sidebar-border px-3 py-2">
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
    </aside>
  );
}
