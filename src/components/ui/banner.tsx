import {
  Bot,
  CircleCheck,
  CircleDashed,
  Info,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   BANNER / CALLOUT — §9.35

   The one place a role wash is allowed to tint a full-width block. Three cues
   carry the role and all three are mandatory: a 3px left rule in the mark
   colour, a leading glyph, and the wash ground. Colour is never the sole
   carrier (§12.2) — strip the hue and the glyph still says which of the six
   this is, which is exactly what a greyscale screenshot must survive.

   Product uses: unconverted spend (critical) · key expiring in 3 days
   (caution) · merge conflict present (critical) · viewing a historical
   revision (caution, non-dismissible, sticky under the top bar) · editing on a
   branch overlay (agent, non-dismissible) · AI or media not configured
   (neutral, with a real action).
   ========================================================================== */

export type BannerRole =
  "positive" | "caution" | "critical" | "agent" | "info" | "neutral";

/**
 * The glyph is bound to the role rather than passed in, so the colour can never
 * be doubled with the wrong shape. Full class strings, because Tailwind reads
 * source text — a template literal would compile to nothing.
 */
const ROLE: Record<
  BannerRole,
  { icon: LucideIcon; ground: string; bar: string; glyph: string }
> = {
  positive: {
    icon: CircleCheck,
    ground: "bg-positive-wash border-positive-border",
    bar: "before:bg-positive",
    glyph: "text-positive-text",
  },
  caution: {
    icon: TriangleAlert,
    ground: "bg-caution-wash border-caution-border",
    bar: "before:bg-caution",
    glyph: "text-caution-text",
  },
  critical: {
    icon: OctagonAlert,
    ground: "bg-critical-wash border-critical-border",
    bar: "before:bg-critical",
    glyph: "text-critical-text",
  },
  agent: {
    icon: Bot,
    ground: "bg-agent-wash border-agent-border",
    bar: "before:bg-agent",
    glyph: "text-agent-text",
  },
  info: {
    icon: Info,
    ground: "bg-info-wash border-info-border",
    bar: "before:bg-info",
    glyph: "text-info-text",
  },
  neutral: {
    icon: CircleDashed,
    ground: "bg-neutral-wash border-neutral-border",
    bar: "before:bg-neutral",
    glyph: "text-neutral-text",
  },
};

export interface BannerProps {
  role?: BannerRole;
  title?: ReactNode;
  children?: ReactNode;
  /** A ghost action, right-aligned and top-aligned with the title. */
  action?: ReactNode;
  className?: string;
}

export function Banner({
  role = "neutral",
  title,
  children,
  action,
  className,
}: BannerProps): ReactNode {
  // Zero-data rendering: a banner with nothing to say is not a coloured strip,
  // it is nothing. "Unconfigured service" states must carry a real sentence and
  // a real action (§11.5), never an empty tinted box.
  if (!title && !children) return null;

  const { icon: Glyph, ground, bar, glyph } = ROLE[role];

  return (
    <div
      className={cn(
        // `overflow-hidden` clips the left rule into the 12px corner radius, so
        // the bar follows the card edge instead of poking out past it. The
        // action slot sits 16px clear of the edge, so its focus ring survives.
        "relative flex w-full items-start gap-5 overflow-hidden rounded-12 border px-6 py-5",
        // The 3px left rule, r-2, inset 1px so it sits inside the border rather
        // than on top of it.
        "before:absolute before:inset-y-px before:left-px before:w-[3px] before:rounded-2 before:content-['']",
        ground,
        bar,
        className,
      )}
    >
      <Glyph
        size={20}
        strokeWidth={1.5}
        aria-hidden="true"
        className={cn("shrink-0", glyph)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title ? <p className="t-body-strong text-ink">{title}</p> : null}
        {children ? (
          <div className="t-caption text-ink-2">{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
