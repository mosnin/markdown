import type { ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Poggle's identity.
 *
 * The mark is the two overlapping eyes from `public/logo-symbol-*.png` — the
 * "oo" of the wordmark, drawn as a silhouette in `currentColor` so it stays
 * legible on the rail, on a marketing hero, and inside an illustration where
 * it is tinted and scaled. The full-colour iridescent version lives in the
 * PNGs and is used where the brand is being presented rather than used as
 * furniture.
 *
 * Kept as geometry rather than an <img> because the mark appears at 16-24px in
 * chrome, where a raster gradient turns to mud, and because the Ledger surface
 * is monochrome by rule: structure never carries colour.
 */
export function Mark({
  className,
  size = 18,
}: {
  className?: string;
  size?: number;
}): ReactNode {
  // Two overlapping discs cannot be unioned with `evenodd` — the intersection
  // would punch a hole — so the pupils are removed with a mask instead. The id
  // must be unique per instance or the first mask on the page wins.
  const maskId = useId();

  return (
    <svg
      viewBox="0 0 256 208"
      width={size}
      height={(size * 208) / 256}
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <mask id={maskId}>
        <rect width="256" height="208" fill="black" />
        <circle cx="90" cy="104" r="62" fill="white" />
        <circle cx="166" cy="104" r="62" fill="white" />
        <circle cx="76" cy="104" r="27" fill="black" />
        <circle cx="152" cy="104" r="27" fill="black" />
      </mask>
      <rect
        width="256"
        height="208"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
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
      <span className="t-brand whitespace-nowrap">poggle</span>
    </span>
  );
}
