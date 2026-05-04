"use client";

import { useCallback, useEffect, useState } from "react";

import { CommandPalette } from "./command_palette";

/**
 * Mounts the Cmd+K command palette once per authenticated session and
 * wires the global keyboard shortcuts.
 *
 * Bindings:
 *   - ⌘K / Ctrl+K              — primary toggle
 *   - ⌘⇧K / Ctrl+Shift+K       — modifier-chord fallback that always
 *                                wins, even when an editor (Monaco /
 *                                CodeMirror / contenteditable) is the
 *                                active element and has bound ⌘K to its
 *                                own action (e.g. "insert link").
 *   - ⌘. / Ctrl+.              — quick-summon chord that mirrors the
 *                                native macOS "show context" feel and
 *                                avoids letter conflicts entirely.
 *
 * Placed once in the /app layout so every route under /app can summon
 * the palette without individually registering a keyboard listener. The
 * palette itself is inert while `open` is false.
 *
 * Cross-tree summon: any client component can dispatch
 *   window.dispatchEvent(new CustomEvent("command-palette:open", { detail: { initialQuery?, action? } }))
 * to surface the palette with optional pre-populated state. This is how
 * the topbar pill, page primary actions, and ⌘-driven flows feed into
 * the palette without prop-drilling.
 *
 * SSR-safe — all window access is inside an effect.
 */
export function CommandPaletteProvider() {
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState<string | undefined>(
    undefined
  );

  const summon = useCallback((query?: string) => {
    if (typeof query === "string") {
      setInitialQuery(query);
    } else {
      setInitialQuery(undefined);
    }
    setOpen(true);
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      // Clear the seeded query as soon as the palette closes so the
      // next summon (without an explicit query) starts clean.
      setInitialQuery(undefined);
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      const key = e.key.toLowerCase();

      // ⌘⇧K / Ctrl+Shift+K — chord fallback. Honor first because some
      // editors capture ⌘K and we want the chord to always win.
      if (e.shiftKey && key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
        return;
      }

      // ⌘. / Ctrl+. — second chord, no letter collision risk.
      if (!e.shiftKey && !e.altKey && (e.key === "." || key === ".")) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
        return;
      }

      // ⌘K / Ctrl+K — primary. Skip when a user is mid-typing in a
      // rich editor so editor keybindings (e.g. Monaco's "insert link")
      // continue to work; the chord fallback above is always available.
      if (!e.shiftKey && !e.altKey && key === "k") {
        if (isInRichEditor(e.target)) {
          // Don't preventDefault — let the editor consume it.
          return;
        }
        e.preventDefault();
        setOpen((v) => !v);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // External summon bridge — see component docstring.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ initialQuery?: string }>).detail;
      summon(detail?.initialQuery);
    }
    window.addEventListener("command-palette:open", onOpen);
    return () => window.removeEventListener("command-palette:open", onOpen);
  }, [summon]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={handleOpenChange}
      initialQuery={initialQuery}
    />
  );
}

/**
 * Heuristic for "is the user mid-typing in something Monaco-shaped?"
 *
 * Returns true for:
 *   - any contentEditable element (Monaco, CodeMirror, Slate, ProseMirror)
 *   - <textarea> elements (often editor surfaces too)
 *   - anything inside an element flagged with data-editor or .monaco-editor
 *     / .cm-editor (CodeMirror) so we never preempt their keybindings
 *
 * Plain <input> fields don't qualify — ⌘K should still summon the palette
 * from a search box or a form input.
 */
function isInRichEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  if (target.tagName === "TEXTAREA") return true;
  if (target.isContentEditable) return true;

  if (
    target.closest(
      ".monaco-editor, .cm-editor, [data-editor], [contenteditable='true']"
    )
  ) {
    return true;
  }

  return false;
}
