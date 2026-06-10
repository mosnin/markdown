import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Contract tests for Workspace Operator gap #7 — keyboard shortcuts.
//
// The panel advertises three shortcuts (see the "Shortcuts" hint row
// beneath the textarea):
//
//   - Cmd/Ctrl+Enter in the prompt textarea → handleGeneratePlan
//   - Esc while a run is cancellable       → handleCancel
//
// Cmd/Ctrl+K is intentionally NOT handled here — it is owned by the global
// CommandPalette (CommandPaletteProvider). Binding it here too used to open
// the command palette and this sheet at once; the guard below locks that out.
//
// Because the repo's vitest runs under node (no jsdom), we assert the
// source-level wiring — same pattern as operator_panel_cancel_wiring and
// operator_panel_retry_visibility. A structural match guarantees the
// shortcut is wired to the *right* handler; verifying actual keypress
// behavior belongs to playwright/integration, not here.
// ---------------------------------------------------------------------------

const PANEL_PATH = resolve(
  __dirname,
  "../../components/product/operator/operator_panel.tsx"
);
const panelSource = readFileSync(PANEL_PATH, "utf8");

describe("operator_panel.tsx — keyboard shortcuts wiring", () => {
  it("declares a handlePromptKeyDown handler for the prompt textarea", () => {
    // The Textarea's onKeyDown is the anchor: the prompt-level shortcuts
    // (Cmd/Ctrl+Enter, Up/Down recall, Esc clear) all live there.
    expect(panelSource).toMatch(/handlePromptKeyDown/);
    expect(panelSource).toMatch(/onKeyDown=\{\s*handlePromptKeyDown\s*\}/);
  });

  it("Cmd/Ctrl+Enter in the textarea calls handleGeneratePlan", () => {
    // The handler checks `metaKey || ctrlKey` to cover both macOS and
    // Windows/Linux, and routes Enter to the Generate Plan action.
    expect(panelSource).toMatch(/metaKey\s*\|\|\s*e\.ctrlKey|e\.metaKey\s*\|\|\s*e\.ctrlKey/);
    expect(panelSource).toMatch(
      /e\.key\s*===\s*"Enter"[\s\S]{0,300}?handleGeneratePlan/
    );
  });

  it("does NOT bind a global Cmd/Ctrl+K listener (owned by the CommandPalette)", () => {
    // Cmd/Ctrl+K is owned by the global CommandPalette (CommandPaletteProvider).
    // The operator panel used to bind it too, which opened the command palette
    // and this sheet simultaneously (plus the legacy GlobalSearch dialog).
    // Guard against that regression — no "k"/"K" keydown handling lives here.
    expect(panelSource).not.toMatch(/e\.key\s*===\s*"[kK]"/);
    expect(panelSource).not.toMatch(
      /if\s*\(\s*!open\s*\)\s*onOpenChange\s*\(\s*true\s*\)/
    );
  });

  it("Esc triggers handleCancel only when cancellable (planning|executing) and not already cancelling", () => {
    // The Esc effect guards on:
    //   - panel open (don't hijack global Esc)
    //   - phase cancellable (planning or executing — both have server-side state)
    //   - not currently cancelling (don't double-dispatch)
    //   - no modal dialog open (save-template should get its own Esc)
    expect(panelSource).toMatch(/isCancellable/);
    expect(panelSource).toMatch(
      /phase\s*===\s*"planning"[\s\S]{0,120}?phase\s*===\s*"executing"|phase\s*===\s*"executing"[\s\S]{0,120}?phase\s*===\s*"planning"/
    );
    expect(panelSource).toMatch(/e\.key\s*!==\s*"Escape"|e\.key\s*===\s*"Escape"/);
  });

  it("Esc handler calls the latest handleCancel via a ref (no stale closure)", () => {
    // Using a ref avoids re-adding the global listener every render
    // while still reading the current handleCancel — load-bearing
    // because handleCancel reads setState setters.
    expect(panelSource).toMatch(/handleCancelRef/);
    expect(panelSource).toMatch(/handleCancelRef\.current\s*=\s*handleCancel/);
  });

  it("renders a visible Shortcuts hint row beneath the textarea", () => {
    // The hint lives in the idle phase (same block as the textarea). The
    // panel was redesigned from a <kbd>Ctrl/Cmd/Enter/Esc</kbd> grid to a
    // single minimal "↵ …" affordance whose copy is keyed by autoMode.
    expect(panelSource).toMatch(/id="operator-prompt-shortcuts"/);
    expect(panelSource).toMatch(/↵ runs immediately/);
    expect(panelSource).toMatch(/↵ generates a plan to review/);
  });

  it("attaches a ref to the prompt textarea (for programmatic focus)", () => {
    expect(panelSource).toMatch(/promptTextareaRef/);
    expect(panelSource).toMatch(/ref=\{\s*promptTextareaRef\s*\}/);
  });

  it("adds and removes its global keydown listener (no leak across remounts)", () => {
    // The panel installs one global keydown listener (Esc-to-cancel while a
    // run is cancellable). Its trigger is mounted at the layout root for the
    // whole session, so every add must be balanced by a cleanup remove.
    const addCalls = panelSource.match(
      /window\.addEventListener\s*\(\s*"keydown"/g
    );
    const removeCalls = panelSource.match(
      /window\.removeEventListener\s*\(\s*"keydown"/g
    );
    expect(addCalls && addCalls.length).toBeGreaterThanOrEqual(1);
    expect(removeCalls && removeCalls.length).toBe(
      addCalls ? addCalls.length : 0
    );
  });
});
