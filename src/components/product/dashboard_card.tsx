import { type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface DashboardCardProps {
  href?: string;
  className?: string;
  children: ReactNode;
}

const baseClasses =
  "rounded-lg border border-border bg-card px-4 py-3 text-sm";

/**
 * Reusable card for the workspace cockpit.
 * Renders as a Next.js Link when `href` is provided, otherwise a plain div.
 * Server component — no client-side interactivity.
 */
export function DashboardCard({ href, className, children }: DashboardCardProps) {
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          baseClasses,
          "block transition-fast hover:border-border/80 hover:shadow-sm",
          className
        )}
      >
        {children}
      </Link>
    );
  }

  return (
    <div className={cn(baseClasses, className)}>
      {children}
    </div>
  );
}
