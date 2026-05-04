/**
 * Client-side progress tracker for the welcome/setup flow.
 *
 * Stores a single JSON blob in localStorage under `poggle_setup_progress`.
 * The shape is intentionally narrow: a step pointer plus the box / note id
 * the user produced at each step so later steps can keep working with the
 * same artifacts.
 *
 * We chose localStorage over a `setup_progress` profile column because:
 *   - The flow is short (≈5 minutes).
 *   - The data is non-authoritative; if it disappears the worst case is
 *     the user restarts at step 1.
 *   - Avoids a schema migration for an ephemeral artefact.
 */

export type SetupStep = 1 | 2 | 3 | 4;

export interface SetupProgress {
  /** The latest step the user has reached. Click-back is allowed. */
  step: SetupStep;
  /** The box created in step 1. Required by step 2 onwards. */
  boxId?: string;
  /** Friendly label for the chosen path — for breadcrumb context. */
  startingPoint?: "template" | "import" | "blank";
  /** The note created in step 2. Required by step 3 onwards. */
  noteId?: string;
  /** Note title used in the bundle filename / status copy. */
  noteTitle?: string;
  /** The slug used for bundle filename. */
  noteSlug?: string;
  /** ISO timestamp of last update — debug-friendly, not used for logic. */
  updatedAt?: string;
}

const STORAGE_KEY = "poggle_setup_progress";

export function readProgress(): SetupProgress {
  if (typeof window === "undefined") return { step: 1 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { step: 1 };
    const parsed = JSON.parse(raw) as SetupProgress;
    if (!parsed || typeof parsed.step !== "number") return { step: 1 };
    return parsed;
  } catch {
    return { step: 1 };
  }
}

export function writeProgress(patch: Partial<SetupProgress>): SetupProgress {
  if (typeof window === "undefined") return { step: 1, ...patch };
  const current = readProgress();
  const next: SetupProgress = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — silently swallow; the flow still works
    // step-to-step via in-memory state, just without resume.
  }
  return next;
}

export function clearProgress(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
