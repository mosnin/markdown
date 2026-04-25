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
  import_export: "Import / Export",
  links: "Links",
};

/** Labels for UUID segments based on the preceding path segment. */
const UUID_PARENT_LABELS: Record<string, string> = {
  boxes: "Box",
  notes: "Note",
  folders: "Folder",
};

function segmentLabel(segment: string, prevSegment?: string): string {
  // UUID-like segments → use parent-aware label
  if (/^[0-9a-f-]{20,}$/i.test(segment)) {
    return prevSegment ? (UUID_PARENT_LABELS[prevSegment] ?? "Detail") : "Detail";
  }
  return LABEL_MAP[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1).replace(/_/g, " ");
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
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prev = i > 0 ? segments[i - 1] : undefined;
    href = `${href}/${seg}`;
    crumbs.push({ label: segmentLabel(seg, prev), href });
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
