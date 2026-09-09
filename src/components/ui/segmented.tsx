"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * LEDGER INSTRUMENT — Segmented control (§9.3).
 *
 * The reference's period picker: a 10px-radius TRACK on a translucent
 * `--track` holding an 8px THUMB on `--surface-raised` with a whisper of
 * shadow, the one flow element allowed one. The
 * thumb is absolutely positioned behind the labels and travels; the track and
 * the labels never move (§7.3). That is the whole idea: this is an instrument's
 * selector, so the scale stays put and only the needle slides.
 *
 * The thumb geometry is MEASURED rather than derived from `width: 100/n%`,
 * because the product's segments carry variable-width labels — `Comfortable ·
 * Compact`, `Read · Edit · History` — and an equal-fraction thumb would sit
 * wrong under every one of them.
 */

/** `useLayoutEffect` that does not warn when this client component is prerendered. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Present but unchoosable: `--text-quaternary`, and the thumb never travels to it. */
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (v: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  /** Accessible name for the group — a radiogroup with no name is unlabelled. */
  label?: string;
  /** Disables the whole control; the track drops to 50% (§9.3). */
  disabled?: boolean;
  className?: string;
}

const TRACK_SIZE = {
  // Track height minus a 1px border minus 2px of padding on each side yields
  // exactly the §9.3 thumb heights (28 → 22, 34 → 28). The 2px padding is on
  // the 4pt scale; the extra 1px of the spec's "3px inner padding" is the
  // border itself.
  sm: "h-[32px] p-1",
  md: "h-[36px] p-1",
} as const;

const SEGMENT_SIZE = {
  sm: "min-w-[40px] px-5 t-micro",
  md: "min-w-[48px] px-6 t-caption-medium",
} as const;

export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  label,
  disabled = false,
  className,
}: SegmentedProps<T>): ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  // Identity-stable dependency: callers routinely pass an inline `options`
  // array, and depending on the array itself would re-run the effect on every
  // render.
  const optionKey = options.map((o) => o.value).join("\u0000");

  useIsomorphicLayoutEffect(() => {
    const track = trackRef.current;
    const active = itemRefs.current.get(value);
    if (!track || !active) {
      setThumb(null);
      return;
    }

    const measure = (): void => {
      const t = track.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      // The thumb's containing block is the track's PADDING box, so the
      // track's own border width has to come out of the offset. `clientLeft`
      // is exactly that border width.
      const next = { x: a.left - t.left - track.clientLeft, w: a.width };
      setThumb((prev) =>
        prev &&
        Math.abs(prev.x - next.x) < 0.5 &&
        Math.abs(prev.w - next.w) < 0.5
          ? prev
          : next,
      );
    };

    measure();
    // Re-measure when the label metrics change under us — a webfont swap, a
    // container resize, a translated label.
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    ro.observe(active);
    return () => ro.disconnect();
  }, [value, optionKey]);

  useEffect(() => {
    // §9.3 caps the control at five segments; past that the right control is a
    // Select. Fail loudly in development rather than silently rendering a
    // twelve-segment ribbon.
    if (process.env.NODE_ENV !== "production" && options.length > 5) {
      console.warn(
        `Segmented: ${options.length} segments exceeds the §9.3 maximum of 5. Use a Select.`,
      );
    }
  }, [options.length]);

  const select = (next: T): void => {
    if (next !== value) onValueChange(next);
  };

  /** Walk from `from` by `step` to the next selectable segment, skipping disabled ones. */
  const move = (from: number, step: number, wrap: boolean): void => {
    const n = options.length;
    if (n === 0) return;
    let i = from;
    for (let hops = 0; hops < n; hops += 1) {
      i += step;
      if (i < 0 || i >= n) {
        if (!wrap) return;
        i = (i + n) % n;
      }
      const candidate = options[i];
      if (candidate && !candidate.disabled) {
        select(candidate.value);
        itemRefs.current.get(candidate.value)?.focus();
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = options.findIndex((o) => o.value === value);
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(index, 1, true);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(index, -1, true);
        break;
      case "Home":
        event.preventDefault();
        move(-1, 1, false);
        break;
      case "End":
        event.preventDefault();
        move(options.length, -1, false);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : onKeyDown}
      className={cn(
        "relative isolate inline-flex shrink-0 items-stretch",
        "rounded-full bg-segment-track",
        // Focus rings the TRACK, not the segment (§9.3), so the control reads
        // as one object under the keyboard. The first stop of the two-stop ring
        // takes the ground the control was dropped on; callers that place it on
        // canvas or an inset set `--seg-ground` through `className`.
        "has-[:focus-visible]:shadow-[0_0_0_2px_var(--seg-ground,var(--surface-raised)),0_0_0_4px_var(--focus-ring)]",
        TRACK_SIZE[size],
        // An empty control still occupies its footprint: the frame always
        // renders (§11.2), so a range picker awaiting its options is a quiet
        // empty track rather than a collapsed nothing.
        options.length === 0 &&
          (size === "sm" ? "min-w-[40px]" : "min-w-[44px]"),
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {thumb ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-1 left-0 z-0 rounded-full",
            // Dark steps the thumb one rung above a card so it still reads as
            // lifted off the near-black track (§9.3). Both are semantic tokens;
            // there is no hardcoded colour behind the variant.
            "bg-segment-thumb shadow-thumb",
            "transition-[transform,width] duration-[var(--dur-2)] ease-[var(--ease-move)]",
          )}
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
        />
      ) : null}

      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current.set(option.value, node);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || option.disabled}
            // Roving tabindex: the group is one tab stop and the arrows move
            // inside it (§12.4).
            tabIndex={active ? 0 : -1}
            onClick={() => select(option.value)}
            className={cn(
              "relative z-[1] inline-flex select-none items-center justify-center",
              "whitespace-nowrap rounded-full outline-none",
              // Only the label colour crossfades (§7.3); no fill appears under
              // an inactive segment on hover, because the thumb is the only
              // fill this control owns.
              "transition-colors duration-[var(--dur-1)] ease-linear",
              "disabled:cursor-not-allowed disabled:text-ink-4 disabled:hover:text-ink-4",
              active ? "text-ink" : "text-ink-2 hover:text-ink",
              SEGMENT_SIZE[size],
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
