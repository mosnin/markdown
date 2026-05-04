/**
 * Sticky per-user "preferred AI" selection used by `<SendToAiPopover/>`.
 *
 * Lives in `localStorage` under `poggle.preferredAi`. SSR-safe — both
 * read and write quietly no-op when `window` is undefined.
 */

export type PreferredAi =
  | "claude-code"
  | "cursor"
  | "claude-web"
  | "chatgpt"
  | "other";

export const PREFERRED_AI_STORAGE_KEY = "poggle.preferredAi";

export const DEFAULT_PREFERRED_AI: PreferredAi = "claude-code";

const VALID_VALUES: ReadonlySet<PreferredAi> = new Set([
  "claude-code",
  "cursor",
  "claude-web",
  "chatgpt",
  "other",
]);

function isPreferredAi(value: string | null | undefined): value is PreferredAi {
  return typeof value === "string" && VALID_VALUES.has(value as PreferredAi);
}

/**
 * Read the user's preferred AI from `localStorage`. Returns the default
 * during SSR (no `window`) or when the stored value is unset / invalid.
 */
export function readPreferredAi(): PreferredAi {
  if (typeof window === "undefined") return DEFAULT_PREFERRED_AI;
  try {
    const raw = window.localStorage.getItem(PREFERRED_AI_STORAGE_KEY);
    return isPreferredAi(raw) ? raw : DEFAULT_PREFERRED_AI;
  } catch {
    // localStorage can throw in private modes / disabled storage. The
    // popover's contract is "best effort" — fall back to the default.
    return DEFAULT_PREFERRED_AI;
  }
}

/**
 * Persist the user's preferred AI to `localStorage`. Quietly no-ops
 * during SSR or when the value isn't a valid `PreferredAi`.
 */
export function writePreferredAi(value: PreferredAi): void {
  if (typeof window === "undefined") return;
  if (!isPreferredAi(value)) return;
  try {
    window.localStorage.setItem(PREFERRED_AI_STORAGE_KEY, value);
  } catch {
    // Same swallow rationale as `readPreferredAi`.
  }
}
