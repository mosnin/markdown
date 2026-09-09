import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Two interlocking brackets represent departments sharing one company context.
 * The approved September 2026 identity uses solid, monochrome geometry.
 * currentColor keeps the same silhouette legible on every application surface.
 */
export function Mark({
  className,
  size = 18,
}: {
  className?: string;
  size?: number;
}): ReactNode {
  return (
    <svg
      viewBox="0 0 224 250"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <path d="M0 0h150v40H40v96h110v40H0Z M84 74h140v176H84v-40h100v-96H84Z" />
    </svg>
  );
}

/** The lowercase lockup uses the dedicated, regular-weight brand type role. */
export function Wordmark({ className }: { className?: string }): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-4 text-ink",
        className,
      )}
    >
      <Mark size={24} />
      <span className="t-brand whitespace-nowrap">companyos</span>
    </span>
  );
}
