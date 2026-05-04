"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  HOTKEYS,
  OPEN_HOTKEY_CHEATSHEET_EVENT,
  type HotkeyBinding,
} from "@/lib/hotkeys";
import { HotkeyCheatsheet } from "@/components/product/hotkey_cheatsheet";

/**
 * Global keyboard binding runtime (Move 1, Half A).
 *
 * Mounted high in the authenticated `/app` layout so every route can use the
 * chord shortcuts without each page registering its own listener. Reads the
 * binding registry from `src/lib/hotkeys.ts` so the cheatsheet and runtime
 * can never drift out of sync.
 *
 * Behavior:
 *   - Single-key bindings (e.g. `?`) fire on first matching keydown.
 *   - Chord bindings (e.g. `g h`) require two ordered presses within a
 *     1-second window. The first key arms the chord; the second resolves
 *     it. Pressing any non-matching key clears the armed state.
 *   - Skip entirely when the event target is inside an `<input>`,
 *     `<textarea>`, or `[contenteditable]` — these surfaces own their
 *     keys, and stealing them would break typing.
 *   - Modifier-bearing presses are ignored: chord/single-letter bindings
 *     coexist with `⌘K`, `⌘.`, browser shortcuts, etc.
 *
 * The cheatsheet Sheet is mounted alongside the listener so a single mount
 * point covers both the listener and the help UI.
 */
export function HotkeyProvider() {
  const router = useRouter();
  const armedRef = useRef<{ key: string; expiresAt: number } | null>(null);

  useEffect(() => {
    const CHORD_WINDOW_MS = 1000;

    function clearArmed() {
      armedRef.current = null;
    }

    function fire(binding: HotkeyBinding) {
      if (binding.href) {
        router.push(binding.href);
        return;
      }
      switch (binding.action) {
        case "open-cheatsheet":
          window.dispatchEvent(new Event(OPEN_HOTKEY_CHEATSHEET_EVENT));
          return;
        case "open-new-note":
          // Mirrors the command palette's "New note" action — both currently
          // route to the dashboard, where the New Note flow lives.
          router.push("/app/dashboard");
          return;
        case "open-new-box":
          // Mirrors the command palette's "New box" action — opens the
          // dashboard surface that exposes the New Box dialog trigger.
          router.push("/app/dashboard");
          return;
        default:
          return;
      }
    }

    function onKey(event: KeyboardEvent) {
      // Never preempt typing — inputs, textareas, and contenteditable own
      // their keys.
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (target.isContentEditable) return;
        if (
          target.closest(
            ".monaco-editor, .cm-editor, [data-editor], [contenteditable='true']"
          )
        ) {
          return;
        }
      }

      // Modifier keys signal a different chord family (⌘/Ctrl etc.) so we
      // bow out and let those handlers run.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // `?` is shift-bearing on most keyboards — accept either the literal
      // character or the canonical name.
      const key = event.key === "?" ? "?" : event.key.toLowerCase();
      // Single-character keys only — ignore Tab, Shift, Arrow*, etc.
      if (key.length !== 1 && key !== "?") return;

      const now = Date.now();
      const armed = armedRef.current;

      // ── Resolve a chord on the second keypress ──
      if (armed && armed.expiresAt > now) {
        const candidate = `${armed.key} ${key}`;
        const match = HOTKEYS.find((b) => b.keys === candidate);
        clearArmed();
        if (match) {
          event.preventDefault();
          fire(match);
        }
        return;
      }

      // ── Single-key binding (e.g. `?`) ──
      const single = HOTKEYS.find((b) => b.keys === key);
      if (single) {
        event.preventDefault();
        clearArmed();
        fire(single);
        return;
      }

      // ── Arm a chord prefix ──
      const isChordPrefix = HOTKEYS.some((b) => b.keys.startsWith(`${key} `));
      if (isChordPrefix) {
        armedRef.current = { key, expiresAt: now + CHORD_WINDOW_MS };
        return;
      }

      // Stray key — clear any stale armed state defensively.
      clearArmed();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return <HotkeyCheatsheet />;
}
