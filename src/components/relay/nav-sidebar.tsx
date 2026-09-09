"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  FileText,
  FolderGit2,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Search,
  Settings,
  Users,
  Webhook,
} from "lucide-react";
import { Mark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/* ==========================================================================
   The navigation rail.

   Structure and class vocabulary follow the Ledger Instrument reference: a
   16rem rail on --surface-rail, one hairline against the canvas, a brand row,
   a search affordance, then grouped links. The active row is a fill
   (--surface-inset) rather than an accent — P1, structure is monochrome.

   Poggle's nav is short on purpose. The product has one noun that matters — a
   project — and everything else is a view onto it. A rail with five items that
   are all obviously distinct beats one with fifteen the reader has to parse.
   ========================================================================== */

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match nested routes too, e.g. /app/projects/acme-checkout. */
  prefix?: boolean;
};

type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Relay",
    items: [
      { href: "/app", label: "Overview", icon: LayoutDashboard },
      { href: "/app/projects", label: "Projects", icon: FolderGit2, prefix: true },
      { href: "/app/live", label: "Live", icon: Activity, prefix: true },
      { href: "/app/briefs", label: "Handoff briefs", icon: FileText, prefix: true },
      { href: "/app/agents", label: "Agents", icon: Users, prefix: true },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/app/settings/relay_keys", label: "Relay keys", icon: KeyRound },
      {
        href: "/app/settings/workspace/webhooks",
        label: "Webhooks",
        icon: Webhook,
      },
      { href: "/app/settings", label: "Workspace", icon: Settings },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.prefix) {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname === item.href;
}

export function NavSidebar({
  workspaceName,
  onOpenSearch,
}: {
  workspaceName: string;
  onOpenSearch?: () => void;
}): ReactNode {
  const pathname = usePathname() ?? "";

  return (
    <aside className="hidden w-[16rem] shrink-0 flex-col border-r border-hairline bg-rail lg:flex">
      <div className="px-5 pb-2 pt-5">
        <Link
          href="/app"
          className="focus-ring-rail flex h-[32px] min-w-0 items-center gap-4 rounded-8 outline-none"
        >
          <span className="relative flex size-[32px] shrink-0 items-center justify-center">
            <Mark size={18} />
          </span>
          <span className="t-brand truncate text-ink">{workspaceName}</span>
        </Link>
      </div>

      <div className="flex shrink-0 flex-col gap-4 px-5 pb-5 pt-4">
        <button
          type="button"
          onClick={onOpenSearch}
          className="focus-ring-rail flex h-[34px] w-full items-center gap-3 rounded-8 border border-hairline bg-canvas px-3 text-left outline-none transition-colors duration-[var(--dur-1)] hover:border-strong"
        >
          <Search className="size-[16px] shrink-0 text-ink-3" strokeWidth={1.5} />
          <span className="t-body flex-1 truncate text-ink-3">
            Search history
          </span>
          <kbd className="t-mono-micro rounded-4 border border-hairline px-1.5 py-0.5 text-ink-4">
            /
          </kbd>
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-7 overflow-y-auto px-5 pb-6">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="t-group-label flex min-h-[32px] items-center px-4 text-ink-3">
              {group.label}
            </p>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "focus-ring-rail flex min-h-[32px] items-center gap-3 rounded-8 px-4 outline-none transition-colors duration-[var(--dur-1)]",
                        active
                          ? "bg-inset text-ink"
                          : "text-ink-2 hover:bg-state-hover hover:text-ink",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-[16px] shrink-0",
                          active ? "text-ink" : "text-ink-3",
                        )}
                        strokeWidth={1.5}
                      />
                      <span className="t-body min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
