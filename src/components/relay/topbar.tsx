"use client";

import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

/* ==========================================================================
   The top bar: a breadcrumb on the left, controls on the right, one hairline
   under it. Height comes from --header-h so the rail, the bar and the main
   column agree without any of them hard-coding a number.
   ========================================================================== */

export function Topbar({
  breadcrumb,
  actions,
}: {
  breadcrumb?: ReactNode;
  actions?: ReactNode;
}): ReactNode {
  return (
    <header className="flex h-[var(--header-h)] shrink-0 items-center justify-between gap-6 border-b border-hairline bg-canvas px-6">
      <div className="flex min-w-0 items-center gap-3">{breadcrumb}</div>
      <div className="flex shrink-0 items-center gap-3">
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}

/** A breadcrumb trail in the top bar's idiom: ink-3 separators, ink for here. */
export function Breadcrumb({
  segments,
}: {
  segments: { label: string; href?: string }[];
}): ReactNode {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-3">
      {segments.map((segment, index) => {
        const last = index === segments.length - 1;
        return (
          <span key={`${segment.label}-${index}`} className="flex items-center gap-3">
            {index > 0 ? <span className="t-body text-ink-4">/</span> : null}
            {segment.href && !last ? (
              <a
                href={segment.href}
                className="t-body truncate text-ink-3 transition-colors hover:text-ink"
              >
                {segment.label}
              </a>
            ) : (
              <span
                className="t-body truncate text-ink"
                aria-current={last ? "page" : undefined}
              >
                {segment.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
