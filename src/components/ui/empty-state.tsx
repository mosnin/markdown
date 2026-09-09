import {
  Funnel,
  Inbox,
  Lock,
  Search,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   EMPTY STATE — §9.37, §11.3

   "A company that has committed nothing must look finished, not broken."
   Five variants, and they differ in three things at once: the tile, the copy,
   and — the part that always gets skipped — the PRIMARY ACTION. Never-created
   offers creation; filtered-out offers clearing, styled secondary, because
   clearing is not creation; permission offers no create at all.

   No illustrations. No mascots. No exclamation marks. No marketing copy.
   ========================================================================== */

export type EmptyVariant =
  "never" | "filtered" | "search" | "error" | "permission";

/** git's empty tree — the literal statement that nothing has been committed. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

interface VariantSpec {
  icon: LucideIcon;
  /** 48px for a state about the object; 32px when the data merely did not match. */
  size: 48 | 32;
  tile: string;
  glyph: string;
}

const VARIANT: Record<EmptyVariant, VariantSpec> = {
  never: { icon: Inbox, size: 48, tile: "bg-inset", glyph: "text-ink-3" },
  filtered: { icon: Funnel, size: 32, tile: "bg-inset", glyph: "text-ink-3" },
  search: { icon: Search, size: 32, tile: "bg-inset", glyph: "text-ink-3" },
  // The one tinted tile: an error is a status, so it earns its wash (§4.6.10).
  error: {
    icon: TriangleAlert,
    size: 48,
    tile: "bg-critical-wash",
    glyph: "text-critical-text",
  },
  permission: { icon: Lock, size: 48, tile: "bg-inset", glyph: "text-ink-3" },
};

export interface EmptyStateProps {
  /** Overrides the variant's default glyph with the object's own type marker. */
  icon?: LucideIcon;
  /** Names the object and its verb: `No revisions yet`, `No agent keys issued`. */
  title: string;
  /** What will appear here and why. For `error`, the id in `t-mono-hash`. */
  body?: ReactNode;
  /** `never` creates · `filtered` clears (secondary) · `error` retries. */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  variant?: EmptyVariant;
  /**
   * Replace the tile with git's empty-tree hash. **Version-control surfaces
   * only** — timeline, document history, branch list, diff (anti-pattern 77).
   * A finance department at zero data gets the neutral tile: a git in-joke is
   * not the mark a CFO should meet first.
   */
  emptyTree?: boolean;
  /**
   * The title is a paragraph by default so the surrounding outline stays the
   * page's. When the empty state IS the page (a not-found route), pass `h1`
   * so the document still has its one level-one heading.
   */
  titleAs?: "p" | "h1" | "h2";
  className?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  secondaryAction,
  variant = "never",
  emptyTree = false,
  titleAs: Title = "p",
  className,
}: EmptyStateProps): ReactNode {
  const spec = VARIANT[variant];
  const Glyph = icon ?? spec.icon;
  const isLarge = spec.size === 48;

  return (
    <div
      className={cn(
        // Centred 400px column, padding 48px 24px. Inside a card, callers drop
        // to `py-9` (32px); a full-page state opens up to 96px.
        "flex w-full max-w-[440px] flex-col items-start px-8 py-11 text-left",
        className,
      )}
    >
      {emptyTree ? (
        <div className="relative w-[20ch]" aria-hidden="true">
          {/* Struck through its centre: this tree is empty, by definition. */}
          <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline" />
          <span className="t-mono-hash block break-all text-ink-4">
            {EMPTY_TREE}
          </span>
        </div>
      ) : (
        <div
          className={cn(
            // Icon-tile ratio, radius ~= 0.30 x size: 48 -> 14, 32 -> 10 (§5.4).
            "flex items-center justify-center",
            isLarge
              ? "h-[48px] w-[48px] rounded-14"
              : "h-[32px] w-[32px] rounded-10",
            spec.tile,
          )}
        >
          <Glyph
            size={isLarge ? 24 : 16}
            strokeWidth={isLarge ? 2 : 1.5}
            aria-hidden="true"
            className={spec.glyph}
          />
        </div>
      )}

      {/* A <p> unless the caller says otherwise: the surrounding outline is the
          page's to own, and a hardcoded <h3> here would break it wherever
          this lands (§12.6). */}
      <Title className="t-title-4 mt-6 text-ink">{title}</Title>

      {body ? <div className="t-caption mt-4 text-ink-2">{body}</div> : null}

      {action || secondaryAction ? (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
