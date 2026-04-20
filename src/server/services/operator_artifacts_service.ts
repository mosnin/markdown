import { type SupabaseClient } from "@supabase/supabase-js";

import {
  getOperatorRun,
  updateOperatorRun,
} from "@/server/services/workspace_operator_runs_service";
import { trashNote } from "@/server/services/lifecycle_service";

/**
 * Operator run artifacts: the read+rollback view over the notes a single
 * Operator run produced.
 *
 * The canonical artifact list is `workspace_operator_runs.notes_created`
 * (a `uuid[]`). We do NOT introduce a parallel artifacts table — the
 * existing column is sufficient and avoids the dual-write problem. This
 * service is purely a thin façade:
 *
 *   * `listRunArtifacts` joins notes_created against the notes table to
 *     surface title + deleted-state per artifact, so the run-detail UI
 *     can render a tidy list (and gray-out artifacts the user already
 *     trashed).
 *   * `rollbackRun` soft-deletes (status='trashed') every still-active
 *     note in notes_created. Hard delete is intentionally not exposed —
 *     the workspace's existing trash recovery surface is the user-facing
 *     undo path; rollback is "make this run go away" not "obliterate
 *     evidence".
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RunArtifact {
  noteId: string;
  /** Note title at the time of the read. `null` when the row is missing entirely. */
  title: string | null;
  /** True when the note is currently trashed or no longer exists. */
  deleted: boolean;
}

export interface RollbackResult {
  /** Total artifact ids on the run. */
  total: number;
  /** Number of notes actually trashed by this call. */
  rolledBack: number;
  /** Number of notes already trashed / missing — counted as no-ops. */
  alreadyDeleted: number;
  /** Per-artifact failure messages, keyed by note id. Empty on full success. */
  errors: Record<string, string>;
}

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * List the artifact rows for a run. Returns an empty array when the run
 * has no recorded artifacts (or doesn't exist / RLS hides it).
 *
 * Each row carries the canonical note id, the note's current title (or
 * null if missing), and a boolean `deleted` derived from
 * `status === 'trashed'`. The order matches the order in `notes_created`
 * — that's the order the agent emitted them, which is the most useful
 * presentation for "what did this run produce".
 */
export async function listRunArtifacts(
  supabase: SupabaseClient,
  runId: string
): Promise<RunArtifact[]> {
  const run = await getOperatorRun(supabase, runId);
  if (!run) return [];

  const ids = (run.notes_created ?? []).filter((n): n is string => !!n);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("notes")
    .select("id, title, status")
    .in("id", ids);

  if (error) {
    throw new Error(`Failed to load run artifacts: ${error.message}`);
  }

  type NoteRow = { id: string; title: string | null; status: string | null };
  const byId = new Map<string, NoteRow>();
  for (const row of (data ?? []) as NoteRow[]) byId.set(row.id, row);

  // Preserve the original order from notes_created — missing rows still
  // appear as `{ deleted: true, title: null }` so the UI can show them
  // explicitly rather than silently dropping ids.
  return ids.map<RunArtifact>((id) => {
    const row = byId.get(id);
    if (!row) return { noteId: id, title: null, deleted: true };
    return {
      noteId: id,
      title: row.title,
      deleted: row.status === "trashed",
    };
  });
}

// ─── Rollback ───────────────────────────────────────────────────────────────

/**
 * Soft-delete every still-active note this run produced.
 *
 * Ownership: the caller's `userId` MUST match `run.user_id`. We don't
 * trust RLS alone here — admins can update other users' runs, but only
 * the run's actor can rollback their own run via this service. Admin
 * cleanup goes through a different (yet-to-build) surface.
 *
 * Idempotency: a rolled-back run is safe to call again. Already-trashed
 * notes are counted under `alreadyDeleted`; the function never throws on
 * a partial success — per-artifact errors are returned in `errors` so
 * the caller can report them without aborting the whole rollback.
 *
 * We call into `trashNote` from lifecycle_service so the lifecycle
 * trigger (audit event, guide-note guard) fires consistently with the
 * regular trash-from-UI path. Rolling back never bypasses the
 * "this is the box's guide note" guard — that error is captured per-id.
 */
export async function rollbackRun(
  supabase: SupabaseClient,
  runId: string,
  userId: string,
  trashImpl: typeof trashNote = trashNote
): Promise<RollbackResult> {
  const run = await getOperatorRun(supabase, runId);
  if (!run) throw new Error("Operator run not found");
  if (run.user_id !== userId) {
    throw new Error("You can only rollback runs you started");
  }

  const ids = (run.notes_created ?? []).filter((n): n is string => !!n);
  const result: RollbackResult = {
    total: ids.length,
    rolledBack: 0,
    alreadyDeleted: 0,
    errors: {},
  };

  if (ids.length === 0) return result;

  for (const noteId of ids) {
    try {
      await trashImpl(supabase, userId, run.workspace_id, noteId);
      result.rolledBack++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The lifecycle service throws "Note is already trashed" when the
      // user (or another rollback) already trashed the row. Treat it as
      // a no-op rather than an error — that's what the user expects
      // from a rerun.
      if (/already trashed/i.test(message)) {
        result.alreadyDeleted++;
        continue;
      }
      // Missing note → also a no-op. This happens when the note was
      // hard-deleted out of band, or the run created it on a branch
      // that's since been discarded.
      if (/not found/i.test(message)) {
        result.alreadyDeleted++;
        continue;
      }
      result.errors[noteId] = message;
    }
  }

  // Stamp the run as cancelled so the UI can render a "rolled back"
  // badge alongside the artifact list. We deliberately keep
  // notes_created intact so a later read of `listRunArtifacts` can
  // still render the (now-trashed) artifacts.
  if (result.rolledBack > 0) {
    try {
      await updateOperatorRun(supabase, runId, { status: "cancelled" });
    } catch {
      // Stamping the status is best-effort — the rollback itself
      // already succeeded; surfacing this would only confuse the user.
    }
  }

  return result;
}
