"use client";

import { useEffect, useMemo, useState } from "react";

import {
  HOTKEYS,
  HOTKEY_GROUP_LABELS,
  OPEN_HOTKEY_CHEATSHEET_EVENT,
  type HotkeyBinding,
  type HotkeyGroup,
} from "@/lib/hotkeys";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Right-side Sheet that lists every registered hotkey, grouped by category
 * (Navigate / Create / View) in a clean two-column table.
 *
 * The Sheet opens when any client dispatches the `OPEN_HOTKEY_CHEATSHEET_EVENT`
 * window event — typically from `HotkeyProvider` when the user hits `?`.
 *
 * Pulls its data from `src/lib/hotkeys.ts` so adding a binding there is the
 * only step required to surface it here.
 */
export function HotkeyCheatsheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener(OPEN_HOTKEY_CHEATSHEET_EVENT, onOpen);
    return () =>
      window.removeEventListener(OPEN_HOTKEY_CHEATSHEET_EVENT, onOpen);
  }, []);

  // Group bindings by category so each section renders together. Stable
  // ordering follows the source array, which gives us deterministic output
  // without sorting.
  const grouped = useMemo(() => {
    const map = new Map<HotkeyGroup, HotkeyBinding[]>();
    for (const binding of HOTKEYS) {
      const existing = map.get(binding.group);
      if (existing) {
        existing.push(binding);
      } else {
        map.set(binding.group, [binding]);
      }
    }
    return map;
  }, []);

  const orderedGroups: HotkeyGroup[] = ["navigate", "create", "view"];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex w-[22rem] flex-col gap-0 border-l border-border bg-card p-0 text-foreground"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base font-semibold tracking-tight">
            Keyboard shortcuts
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Press a chord anywhere outside an input to jump or create.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-6">
            {orderedGroups.map((group) => {
              const bindings = grouped.get(group);
              if (!bindings || bindings.length === 0) return null;
              return (
                <section key={group} aria-labelledby={`hotkey-group-${group}`}>
                  <h3
                    id={`hotkey-group-${group}`}
                    className="mb-2 text-overline text-muted-foreground/70"
                  >
                    {HOTKEY_GROUP_LABELS[group]}
                  </h3>
                  <ul className="divide-y divide-border list-none rounded-md border border-border">
                    {bindings.map((binding) => (
                      <HotkeyRow key={binding.keys} binding={binding} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Two-column row: human description on the left, keys on the right rendered
 * as `<kbd>` chips. A chord like `g h` gets two adjacent chips with no
 * separator — the visual gap reads as "press G then H".
 */
function HotkeyRow({ binding }: { binding: HotkeyBinding }) {
  const tokens = binding.keys.split(/\s+/).filter(Boolean);

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
        {binding.label}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {tokens.map((token, index) => (
          <kbd
            key={`${binding.keys}-${index}`}
            className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground"
          >
            {token}
          </kbd>
        ))}
      </span>
    </li>
  );
}
