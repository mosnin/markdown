/**
 * Typed binding registry for global keyboard hotkeys (Move 1, Half A).
 *
 * Single source of truth consumed by both `HotkeyProvider` (the runtime that
 * listens for chord/single-key presses on `window`) and `HotkeyCheatsheet`
 * (the right-side Sheet that shows the user every available shortcut).
 *
 * Bindings are split into three categories:
 *   - `navigate`  — chord prefix `g`, jump to a destination (`g h`, `g d`, …)
 *   - `create`    — chord prefix `c`, open a creation dialog (`c n`, `c b`)
 *   - `view`      — single-key affordances that toggle UI (e.g. `?`)
 *
 * Each `keys` string is the canonical human label. The runtime parses it by
 * splitting on whitespace; a single-token binding (`?`) is a single keypress,
 * a two-token binding (`g h`) is a chord (the first key arms a window, the
 * second resolves it). Modifier-bearing combos live in
 * `command_palette_provider.tsx` — these bindings are deliberately
 * letter-only so they never collide with browser/editor chords.
 *
 * To add a binding: append to `HOTKEYS`, then handle the `action` (or `href`)
 * in `HotkeyProvider`. The cheatsheet picks it up automatically.
 */

export type HotkeyGroup = "navigate" | "create" | "view";

export interface HotkeyBinding {
  /** Human label, e.g. "g h" or "?". Whitespace-separated chord. */
  readonly keys: string;
  /** Short, human-readable description rendered in the cheatsheet. */
  readonly label: string;
  /** Category for grouping in the cheatsheet. */
  readonly group: HotkeyGroup;
  /** Optional navigation target (used by `navigate` bindings). */
  readonly href?: string;
  /**
   * Optional action identifier for non-navigation bindings. Mirrors the
   * `value` strings used by the command palette so consumers can route
   * the action through a single switch.
   */
  readonly action?:
    | "open-new-note"
    | "open-new-box"
    | "open-cheatsheet";
}

export const HOTKEYS: ReadonlyArray<HotkeyBinding> = [
  // ── Navigate ────────────────────────────────────────────────────────────
  { keys: "g h", label: "Go to Home", group: "navigate", href: "/app" },
  {
    keys: "g d",
    label: "Go to Dashboard",
    group: "navigate",
    href: "/app/dashboard",
  },
  { keys: "g s", label: "Go to Search", group: "navigate", href: "/app/search" },
  { keys: "g a", label: "Go to Agents", group: "navigate", href: "/app/agents" },

  // ── Create ──────────────────────────────────────────────────────────────
  {
    keys: "c n",
    label: "New note",
    group: "create",
    action: "open-new-note",
  },
  {
    keys: "c b",
    label: "New box",
    group: "create",
    action: "open-new-box",
  },

  // ── View ────────────────────────────────────────────────────────────────
  {
    keys: "?",
    label: "Show keyboard shortcuts",
    group: "view",
    action: "open-cheatsheet",
  },
];

/**
 * Group label rendered as the section header in the cheatsheet. Kept in this
 * module so both consumers stay in sync.
 */
export const HOTKEY_GROUP_LABELS: Readonly<Record<HotkeyGroup, string>> = {
  navigate: "Navigate",
  create: "Create",
  view: "View",
};

/** Window event name dispatched when `?` is pressed. */
export const OPEN_HOTKEY_CHEATSHEET_EVENT = "hotkey:open-cheatsheet";
