import type { ReactNode } from "react";
import { Kicker } from "@/components/marketing/corner-plus";
import { cn } from "@/lib/utils";

export function Container({
  children,
  className,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}): ReactNode {
  return (
    <div className={cn(wide ? "mk-container-wide" : "mk-container", className)}>
      {children}
    </div>
  );
}

export function Section({
  children,
  className,
  id,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  labelledBy?: string;
}): ReactNode {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("mk-section", className)}
    >
      {children}
    </section>
  );
}

/**
 * Kicker, headline, lead. Left-aligned by default: the reference site
 * centres only its hero, and a centred paragraph over 60 characters is
 * harder to read than a ragged-left one.
 */
export function SectionHeading({
  id,
  kicker,
  title,
  lead,
  align = "left",
  className,
}: {
  id: string;
  kicker?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
  className?: string;
}): ReactNode {
  if (align === "center" || !lead) {
    return (
      <div
        className={cn(
          "flex flex-col gap-6",
          align === "center" && "mx-auto items-center text-center",
          className,
        )}
      >
        {kicker ? <Kicker>{kicker}</Kicker> : null}
        <h2 id={id} className="t-mk-h2 max-w-[18ch] text-balance text-ink">
          {title}
        </h2>
        {lead ? (
          <p className="t-mk-lead mk-prose text-pretty text-ink-2">{lead}</p>
        ) : null}
      </div>
    );
  }
  // The editorial split: the headline holds the left column and the lead
  // sits beside it, aligned to the headline's first line, so a section opens
  // as one composed spread instead of a headline over an empty half page.
  return (
    <div
      className={cn(
        "grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-start lg:gap-12",
        className,
      )}
    >
      <div className="flex flex-col gap-6">
        {kicker ? <Kicker>{kicker}</Kicker> : null}
        <h2 id={id} className="t-mk-h2 max-w-[18ch] text-balance text-ink">
          {title}
        </h2>
      </div>
      <p className="t-mk-lead mk-prose text-pretty text-ink-2 lg:pt-[36px]">
        {lead}
      </p>
    </div>
  );
}

/**
 * The two-column feature row from the ForgeUI feature blocks (feature06 and
 * feature08): copy on one side, a live scene on the other, alternating.
 */
export function FeatureRow({
  id,
  kicker,
  title,
  children,
  visual,
  reverse = false,
  className,
}: {
  id: string;
  kicker?: string;
  title: ReactNode;
  children: ReactNode;
  visual: ReactNode;
  reverse?: boolean;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        "grid items-center gap-10 lg:grid-cols-2 lg:gap-12",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-6",
          reverse ? "lg:order-2" : "lg:order-1",
        )}
      >
        {kicker ? <Kicker>{kicker}</Kicker> : null}
        <h2 id={id} className="t-mk-h3 max-w-[22ch] text-balance text-ink">
          {title}
        </h2>
        <div className="t-mk-body flex max-w-[52ch] flex-col gap-5 text-pretty text-ink-2">
          {children}
        </div>
      </div>
      <div className={cn(reverse ? "lg:order-1" : "lg:order-2")}>{visual}</div>
    </div>
  );
}

/**
 * A scene frame: the raised surface every animated illustration sits on.
 * One hairline, one elevation, and the crosshairs at the corners.
 */
export function SceneFrame({
  children,
  className,
  caption,
  minHeight = 320,
}: {
  children: ReactNode;
  className?: string;
  caption?: string;
  minHeight?: number;
}): ReactNode {
  return (
    <figure className={cn("flex flex-col gap-4", className)}>
      <div
        className="relative flex w-full items-center justify-center overflow-hidden rounded-12 border border-border bg-raised shadow-elev-1"
        style={{ minHeight }}
      >
        {/* A block wrapper with a real width: the scenes size themselves to
            the width they are given, and a shrink-to-fit flex item gives
            them none. */}
        <div className="w-full">{children}</div>
      </div>
      {caption ? (
        <figcaption className="t-caption text-ink-3">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

/**
 * The bento grid from feature01 and feature07: cells share one hairline
 * border and a footer that names what the scene shows.
 */
export function Bento({
  children,
  columns = 3,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        "grid gap-6",
        columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BentoCell({
  title,
  description,
  scene,
  className,
  span = false,
}: {
  title: string;
  description: string;
  scene: ReactNode;
  className?: string;
  span?: boolean;
}): ReactNode {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-12 border border-border bg-raised shadow-elev-1",
        span && "md:col-span-2",
        className,
      )}
    >
      <div className="relative flex min-h-[260px] flex-1 items-center justify-center overflow-hidden border-b border-hairline bg-object">
        <div className="w-full">{scene}</div>
      </div>
      <div className="flex flex-col gap-2 p-7">
        <p className="t-mk-h4 text-ink">{title}</p>
        <p className="t-body text-ink-2">{description}</p>
      </div>
    </div>
  );
}

/**
 * The stat strip: one raised container, cells divided by vertical rules.
 * Every number is real and computed where it is rendered.
 */
export function StatStrip({
  items,
  className,
}: {
  items: { value: string; label: string; detail?: string }[];
  className?: string;
}): ReactNode {
  return (
    <dl
      className={cn(
        "grid divide-y divide-hairline overflow-hidden rounded-12 border border-border bg-raised shadow-elev-1 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4",
        className,
      )}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            "flex flex-col gap-4 p-8",
            i > 0 && "sm:border-l sm:border-hairline",
            i === 2 && "sm:border-t sm:border-hairline lg:border-t-0",
            i === 3 && "sm:border-t sm:border-hairline lg:border-t-0",
          )}
        >
          <dt className="t-label-caps text-ink-3">{item.label}</dt>
          <dd className="flex flex-col gap-2">
            <span className="t-mk-stat text-ink">{item.value}</span>
            {item.detail ? (
              <span className="t-caption text-ink-3">{item.detail}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A two-column definition list for technical detail. */
export function SpecList({
  rows,
  className,
}: {
  rows: { term: string; detail: ReactNode; mono?: boolean }[];
  className?: string;
}): ReactNode {
  return (
    <dl
      className={cn(
        "divide-y divide-hairline rounded-12 border border-border bg-raised shadow-elev-1",
        className,
      )}
    >
      {rows.map((row) => (
        <div
          key={row.term}
          className="grid gap-3 px-7 py-6 sm:grid-cols-[200px_1fr] sm:gap-8"
        >
          <dt
            className={cn(
              "text-ink",
              row.mono ? "t-mono-hash-lg" : "t-body-strong",
            )}
          >
            {row.term}
          </dt>
          <dd className="t-body text-ink-2">{row.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
