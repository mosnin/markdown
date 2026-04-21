"use server";

import { type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import { upsertNoteEmbedding } from "@/server/services/embedding_service";
import {
  REINDEX_INLINE_THRESHOLD,
  REINDEX_MAX_PER_CALL,
} from "./constants";

/**
 * Admin-only server action: walk every note in the active workspace and
 * (re)compute its embedding.
 *
 * Shape:
 *   - Small workspaces (<100 notes): process inline, return `"complete"`.
 *   - Larger workspaces: process the first 500 notes by most-recently
 *     updated, return `"partial"` with a hint that another pass is
 *     needed. No background job here — this is an admin quick-win.
 *
 * Each call is idempotent: `upsertNoteEmbedding` short-circuits when the
 * content hash is unchanged, so repeated reindexes don't waste API
 * credits. Notes that fail to embed are counted but do not abort the
 * run; the error is logged server-side.
 *
 * Returns `{ indexed, failed }` on the success path, as specified, plus
 * `skipped` and `status` for visibility. Callers that only care about
 * the contract fields can ignore the extras.
 */

export type ReindexStatus = "complete" | "partial";

export type ReindexActionResult =
  | {
      ok: true;
      data: {
        indexed: number;
        failed: number;
        skipped: number;
        total: number;
        status: ReindexStatus;
      };
    }
  | { ok: false; error: string };

/**
 * Count the notes in the workspace that would be considered for
 * reindex (not trashed, main branch). Exposed so the UI can warn about
 * a partial run before the user clicks.
 */
async function countEligibleNotes(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<number> {
  // `notes` has no `workspace_id` column; resolve workspace membership
  // through `notes.box_id → boxes.workspace_id`. Fetch box ids first,
  // then count notes whose `box_id` is in that set.
  const { data: boxes } = await supabase
    .from("boxes")
    .select("id")
    .eq("workspace_id", workspaceId);

  const boxIds = (boxes ?? []).map((b: { id: string }) => b.id);
  if (boxIds.length === 0) return 0;

  const { count } = await supabase
    .from("notes")
    .select("id", { count: "exact", head: true })
    .in("box_id", boxIds)
    .neq("status", "trashed")
    .is("branch_id", null);
  return count ?? 0;
}

/**
 * Workspace reindex. Owner/admin only.
 *
 * Fetches eligible notes ordered by updated_at desc, capped at
 * REINDEX_MAX_PER_CALL, and runs `upsertNoteEmbedding` for each. If the
 * workspace has more eligible notes than the cap, the status comes back
 * as `"partial"` — the caller can re-run the button to make further
 * progress.
 */
export async function reindexWorkspaceAction(): Promise<ReindexActionResult> {
  const gate = await requireAdminRoleResult();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { ctx } = gate;

  try {
    const supabase = await createClient();
    const workspaceId = ctx.workspace.id;

    const total = await countEligibleNotes(supabase, workspaceId);
    const cap = total < REINDEX_INLINE_THRESHOLD ? total : REINDEX_MAX_PER_CALL;
    const status: ReindexStatus =
      total > REINDEX_MAX_PER_CALL ? "partial" : "complete";

    let indexed = 0;
    let failed = 0;
    let skipped = 0;

    if (cap > 0) {
      // Resolve workspace membership via `notes.box_id → boxes.workspace_id`.
      // The `notes` table has no `workspace_id` column, so filter by the
      // set of box ids that belong to this workspace.
      const { data: workspaceBoxes, error: boxesError } = await supabase
        .from("boxes")
        .select("id")
        .eq("workspace_id", workspaceId);

      if (boxesError) {
        return {
          ok: false,
          error: `Failed to read boxes: ${boxesError.message}`,
        };
      }

      const boxIds = (workspaceBoxes ?? []).map(
        (b: { id: string }) => b.id
      );

      let notes: Array<{
        id: string;
        title: string;
        markdown_content: string | null;
      }> = [];

      if (boxIds.length > 0) {
        const { data, error } = await supabase
          .from("notes")
          .select("id, title, markdown_content")
          .in("box_id", boxIds)
          .neq("status", "trashed")
          .is("branch_id", null)
          .order("updated_at", { ascending: false })
          .limit(cap);

        if (error) {
          return {
            ok: false,
            error: `Failed to read notes: ${error.message}`,
          };
        }

        notes = data ?? [];
      }

      for (const note of notes) {
        const content = `${note.title}\n\n${note.markdown_content ?? ""}`;
        try {
          const didUpsert = await upsertNoteEmbedding(
            supabase,
            note.id,
            content
          );
          if (didUpsert) {
            indexed++;
          } else {
            skipped++;
          }
        } catch (err) {
          console.error(
            "[reindex] failed to embed note",
            note.id,
            err instanceof Error ? err.message : err
          );
          failed++;
        }
      }
    }

    // Audit the run so workspace admins can see who kicked it off.
    // Non-fatal — a failed audit must not fail the reindex.
    try {
      await createAuditEvent(supabase, {
        workspace_id: workspaceId,
        actor_type: "user",
        actor_id: ctx.user.id,
        object_type: "workspace",
        object_id: workspaceId,
        event_type: "embeddings.reindex_run",
        metadata: { indexed, failed, skipped, total, status },
      });
    } catch {
      // swallow — audit is best-effort
    }

    return {
      ok: true,
      data: { indexed, failed, skipped, total, status },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Reindex failed",
    };
  }
}
