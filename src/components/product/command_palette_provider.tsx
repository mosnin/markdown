"use client";

import { useEffect, useState } from "react";

import { CommandPalette } from "./command_palette";

/**
 * Mounts the Cmd+K command palette once per authenticated session and
 * wires the global Cmd+K / Ctrl+K hotkey.
 *
 * Placed once in the /app layout so every route under /app can summon
 * the palette without individually registering a keyboard listener. The
 * palette itself is inert while `open` is false.
 *
 * SSR-safe — all window access is inside an effect.
 */
export function CommandPaletteProvider() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <CommandPalette open={open} onOpenChange={setOpen} />;
}
