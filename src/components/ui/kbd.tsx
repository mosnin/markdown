import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * LEDGER INSTRUMENT — Kbd (§9.38).
 *
 * A keycap, not a badge: an inset cavity with a hairline all round and a heavier
 * bottom edge standing in for the bevel. The 2px bottom is `--line-border`, an
 * existing weight used thicker — it is a keycap detail, not a fourth line weight
 * (§2.5).
 *
 * Chords are separate elements with no `+` character between them —
 * `<Kbd>⌘</Kbd><Kbd>K</Kbd>` — and the sibling rule below supplies the gap, so a
 * caller never has to remember it.
 */
export function Kbd({ className, ...props }: ComponentProps<"kbd">): ReactNode {
  return (
    <kbd
      className={cn(
        "inline-flex h-[20px] min-w-[20px] items-center justify-center align-middle",
        "rounded-4 border border-hairline border-b-2 border-b-border",
        "bg-inset px-3 t-mono-micro text-ink-3",
        "[&+kbd]:ml-1",
        className,
      )}
      {...props}
    />
  );
}
