/**
 * Diff utility helpers for note version history.
 *
 * diff_summary is a lightweight, deterministic jsonb field stored on each
 * note_version. It captures what structurally changed between the previous
 * note state and the new snapshot — no semantic analysis, no AI.
 *
 * Shape:
 *   title_changed:   boolean  — title text differs
 *   body_changed:    boolean  — markdown_content differs
 *   summary_changed: boolean  — summary field differs
 *   tags_changed:    boolean  — tags array differs (order-insensitive)
 *   status_changed:  boolean  — status differs (rare; captured for completeness)
 *   bytes_added:     integer  — content_bytes(new) - content_bytes(old) when > 0
 *   bytes_removed:   integer  — content_bytes(old) - content_bytes(new) when > 0
 */

export interface DiffSummary {
  title_changed: boolean;
  body_changed: boolean;
  summary_changed: boolean;
  tags_changed: boolean;
  status_changed: boolean;
  bytes_added: number;
  bytes_removed: number;
}

interface PrevSnapshot {
  title: string;
  markdown_content: string;
  content_bytes: number;
  summary?: string | null;
  tags?: string[];
  status?: string;
}

interface NextSnapshot {
  title: string;
  markdown_content: string;
  content_bytes: number;
  summary?: string | null;
  tags?: string[];
  status?: string;
}

function tagsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const as = [...(a ?? [])].sort();
  const bs = [...(b ?? [])].sort();
  if (as.length !== bs.length) return false;
  return as.every((v, i) => v === bs[i]);
}

/**
 * Compute a DiffSummary by comparing two snapshots.
 * Safe to call with partial data — missing fields are treated as unchanged.
 */
export function computeDiffSummary(
  prev: PrevSnapshot,
  next: NextSnapshot
): DiffSummary {
  const delta = next.content_bytes - prev.content_bytes;
  return {
    title_changed: prev.title !== next.title,
    body_changed: prev.markdown_content !== next.markdown_content,
    summary_changed: (prev.summary ?? null) !== (next.summary ?? null),
    tags_changed: !tagsEqual(prev.tags, next.tags),
    status_changed: (prev.status ?? null) !== (next.status ?? null),
    bytes_added: delta > 0 ? delta : 0,
    bytes_removed: delta < 0 ? -delta : 0,
  };
}

/**
 * Compute a DiffSummary for a rollback — comparing the note's current state
 * to the historical snapshot being restored.
 */
export function computeRollbackDiff(
  currentNote: PrevSnapshot,
  targetSnapshot: NextSnapshot
): DiffSummary {
  return computeDiffSummary(currentNote, targetSnapshot);
}
