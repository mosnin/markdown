import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Children, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   INSET GROUPED LIST — §9.14

   The Apple idiom, and the antidote to "a flex stack of identical rounded grey
   rectangles". One object, subdivided: rows sit on --surface-object inside a
   single hairlined container with the corners clipped to it. Flat, always —
   an object row is never shadowed (§5.7).

   The detail that does the work is the separator INSET TO THE TEXT ORIGIN
   (left inset = padding + tile + gap). A full-bleed rule reads as a stack of
   rows; an inset rule reads as one list.

   The group's `label-caps` header belongs on the canvas ABOVE this container,
   12px clear of it — that is `SectionHeading`, not a child of this list.
   ========================================================================== */

export interface GroupedListProps extends ComponentProps<"ul"> {
  /**
   * Zero-data rendering (§9.14): an empty group is still a group. It renders a
   * single 56px row of `caption` --text-tertiary with no chevron, so absence
   * and "not loaded" never look alike.
   */
  empty?: ReactNode;
}

export function GroupedList({
  className,
  children,
  empty = "Nothing here yet",
  ...props
}: GroupedListProps): ReactNode {
  // toArray drops null / undefined / false, so `{cond && <GroupedRow/>}` that
  // resolves to nothing correctly counts as an empty group.
  const isEmpty = Children.toArray(children).length === 0;

  return (
    <ul
      className={cn(
        // `overflow-hidden` is what rounds the first and last rows to the
        // container. It also clips an outer focus ring, which is why a row's
        // focus ring is an INSET ring (see GroupedRow).
        "overflow-hidden rounded-12 border border-hairline bg-object",
        className,
      )}
      {...props}
    >
      {isEmpty ? (
        <li className="t-caption flex min-h-[56px] items-center px-6 py-4 text-ink-3">
          {empty}
        </li>
      ) : (
        children
      )}
    </ul>
  );
}

export interface GroupedRowProps {
  /** A 32px tile or avatar. Its slot is reserved even when the tile is absent. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned value: `body` --text-secondary, or `t-metric-sm` if numeric. */
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}

export function GroupedRow({
  leading,
  title,
  subtitle,
  trailing,
  href,
  onClick,
  className,
}: GroupedRowProps): ReactNode {
  const navigable = Boolean(href || onClick);
  // 56px with a tile or a second line; 44px for a bare label/value pair (§6.4).
  const tall = Boolean(leading || subtitle);

  const body = (
    <>
      {leading ? (
        <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center">
          {leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-2 text-left">
        <span className="t-body-strong truncate text-ink">{title}</span>
        {subtitle ? (
          <span className="t-caption truncate text-ink-3">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="t-body flex shrink-0 items-center gap-4 text-ink-2">
          {trailing}
        </span>
      ) : null}
      {navigable ? (
        <ChevronRight
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          className="shrink-0 text-ink-4"
        />
      ) : null}
    </>
  );

  const rowClass = cn(
    "flex w-full items-center gap-5 px-6 py-4",
    tall ? "min-h-[56px]" : "min-h-[44px]",
    navigable && [
      "cursor-pointer transition-colors duration-[var(--dur-1)] ease-linear",
      "hover:bg-state-hover active:bg-state-active",
      // An INSET ring, because the container clips: the two-stop outer ring of
      // `.focus-ring` would be swallowed by `overflow-hidden` (§9.14).
      "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus-ring)]",
    ],
    className,
  );

  return (
    <li
      className={cn(
        "relative",
        // The separator, inset to the text origin and drawn on every row but
        // the first. 60px = 16 (row padding) + 32 (tile) + 12 (gap).
        "before:absolute before:right-0 before:top-0 before:h-px before:bg-hairline before:content-['']",
        leading ? "before:left-[60px]" : "before:left-6",
        "first:before:hidden",
      )}
    >
      {href ? (
        <Link href={href} onClick={onClick} className={rowClass}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}
