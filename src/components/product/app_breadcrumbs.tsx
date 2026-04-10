"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lightweight breadcrumb bar that derives segments from the current pathname.
 *
 * Rendered in the desktop top bar inside the authenticated shell.
 * Uses `usePathname` (client hook) so this must be a Client Component —
 * layouts themselves cannot access pathname without re-rendering on nav.
 *
 * Segments are capitalised and the leading "/app" prefix is stripped.
 * Dynamic segments (UUIDs) are replaced with a friendly label.
 */

const LABEL_MAP: Record<string, string> = {
  app: "Home",
  boxes: "Boxes",
  notes: "Notes",
  search: "Search",
  workspaces: "Workspaces",
  proposals: "Proposals",
  audit: "Audit log",
  settings: "Settings",
};

function segmentLabel(segment: string): string {
  // UUID-like segments → generic label
  if (/^[0-9a-f-]{20,}$/i.test(segment)) return "Detail";
  return LABEL_MAP[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function AppBreadcrumbs() {
  const pathname = usePathname();

  // Build breadcrumb segments, stripping leading slash and the root "app" segment
  const parts = pathname.split("/").filter(Boolean);
  // Remove leading "app" since Home is the root
  const segments = parts[0] === "app" ? parts.slice(1) : parts;

  // Always show "Home" as the root
  const crumbs: { label: string; href: string }[] = [
    { label: "Context Store", href: "/app" },
  ];

  let href = "/app";
  for (const seg of segments) {
    href = `${href}/${seg}`;
    crumbs.push({ label: segmentLabel(seg), href });
  }

  // If we are at root (/app), show only the app name — no breadcrumb trail needed
  if (crumbs.length <= 1) {
    return (
      <span className="text-sm font-medium text-foreground/80">
        Context Store
      </span>
    );
  }

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 text-sm list-none" role="list">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex items-center gap-1">
              {i > 0 && (
                <ChevronRight
                  className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
              )}
              {isLast ? (
                <span
                  className="font-medium text-foreground truncate max-w-[200px]"
                  aria-current="page"
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className={cn(
                    "text-muted-foreground hover:text-foreground transition-colors truncate max-w-[160px]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  )}
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
