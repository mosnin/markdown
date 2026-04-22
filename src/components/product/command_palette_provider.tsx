"use client";

import { useEffect, useState } from "react";
import { CommandPalette } from "./command_palette";

/**
 * Mounts the CommandPalette once and wires the global Cmd/Ctrl+K
 * hotkey. Placed in the /app layout so every authenticated page can
 * summon the palette.
 *
 * SSR-safe: all navigator / window access is inside an effect so the
 * server render stays deterministic.
 */
export function CommandPaletteProvider() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMac =
        typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
      const hotkeyPressed =
        (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "k";
      if (hotkeyPressed) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <CommandPalette open={open} onOpenChange={setOpen} />;
}
