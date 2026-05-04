import { cn } from "@/lib/utils";

interface PoggleMarkProps {
  /** Render only the symbol, only the wordmark, or both. */
  variant?: "full" | "symbol" | "wordmark";
  /**
   * Sizing token. `sm` is sidebar / topbar density, `md` is most page
   * placements, `lg` is the auth/landing hero. Symbol scales 16/24/40px;
   * wordmark scales 14/16/22px and tracks alongside.
   */
  size?: "sm" | "md" | "lg";
  /**
   * Mark surface. `brand` (default) is filled brand-yellow with a hairline
   * darker border — the canonical paid-for surface. `mono` is a foreground
   * fill for inverted/dark contexts (e.g. the auth left-panel). `outline`
   * is a transparent rest with a hairline brand border; used in the
   * footer at low visual weight.
   */
  surface?: "brand" | "mono" | "outline";
  className?: string;
  /**
   * Adds an `aria-label` so the mark announces itself when rendered as the
   * only content of a clickable trigger. When the wordmark is visible,
   * default to false and let the wordmark text carry the label.
   */
  labelled?: boolean;
}

/**
 * Canonical Poggle brand mark.
 *
 * The symbol is a 24px square stack-glyph: an outer rounded square, a
 * stacked inner layer offset to suggest depth (boxes within boxes), and
 * a single negative-space notch that doubles as a stylised lower-case
 * `p`. It is rendered as inline SVG so it inherits color through
 * `currentColor` and animates with the surface — no PNG export, no
 * dependency on the public folder.
 *
 * The wordmark is Geist Sans semibold tracking-tight, optical letter-
 * spacing tuned to sit cleanly next to the symbol. We deliberately do
 * NOT lowercase the wordmark — `Poggle` reads with more dignity than
 * `poggle`. The `g` and `e` are the Geist defaults; cv11/ss03 are
 * already enabled globally.
 *
 * Use this everywhere a brand mark appears: marketing header + footer,
 * sign-in left panel, welcome page, error/not-found, mobile topbar,
 * (and as `surface="brand"` size="sm") inside the workspace switcher
 * tile when the user has no active workspace.
 */
export function PoggleMark({
  variant = "full",
  size = "md",
  surface = "brand",
  className,
  labelled = false,
}: PoggleMarkProps) {
  const showSymbol = variant === "full" || variant === "symbol";
  const showWord = variant === "full" || variant === "wordmark";

  const symbolSize =
    size === "sm" ? "h-4 w-4" : size === "lg" ? "h-10 w-10" : "h-6 w-6";
  const wordSize =
    size === "sm"
      ? "text-[14px]"
      : size === "lg"
        ? "text-[22px]"
        : "text-base";

  const symbolColors =
    surface === "brand"
      ? "border border-[oklch(0.78_0.18_88)] bg-brand text-brand-foreground"
      : surface === "mono"
        ? "border border-foreground bg-foreground text-background"
        : "border border-brand bg-transparent text-brand";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 leading-none",
        className
      )}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? "Poggle" : undefined}
    >
      {showSymbol && (
        <span
          className={cn(
            "relative inline-flex shrink-0 items-center justify-center rounded-[5px]",
            symbolColors,
            symbolSize
          )}
          aria-hidden={showWord ? "true" : labelled ? undefined : "true"}
        >
          {/*
            The glyph is two stacked rounded squares offset by 2px,
            with a negative-space notch carved out of the lower-right.
            Drawn at 24×24 and scaled by the wrapper to keep stroke
            weights consistent at every size.
          */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="h-[58%] w-[58%]"
            aria-hidden="true"
          >
            {/* Back layer — slightly inset, low-contrast against the surface. */}
            <rect
              x="4"
              y="4"
              width="14"
              height="14"
              rx="2.5"
              stroke="currentColor"
              strokeWidth="1.6"
              opacity="0.45"
            />
            {/* Front layer — the dominant glyph. */}
            <rect
              x="7"
              y="7"
              width="14"
              height="14"
              rx="2.5"
              fill="currentColor"
              opacity="0.95"
            />
            {/* Notch — a single negative-space cut in the front layer's
                lower-right that reads as a dot/serif accent. */}
            <circle cx="17.5" cy="17.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0" />
          </svg>
        </span>
      )}
      {showWord && (
        <span
          className={cn(
            "font-semibold tracking-tight text-foreground",
            wordSize,
            // Tighten optical pairing with the symbol.
            "[font-feature-settings:'cv11','ss01','ss03']"
          )}
        >
          Poggle
        </span>
      )}
    </span>
  );
}
