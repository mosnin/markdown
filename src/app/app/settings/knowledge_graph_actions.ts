"use server";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { extractAndStoreEntities } from "@/server/services/knowledge_graph_service";
import {
  createBackfillJob,
  updateBackfillJob,
  getLatestBackfillJob,
} from "@/server/repositories/kg_backfill_job_repository";
import type { KgBackfillJob } from "@/server/domain/types/kg_backfill_job";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function startKgBackfillAction(): Promise<
  ActionResult<{ jobId: string; totalNotes: number }>
> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    // Block concurrent backfills
    const latest = await getLatestBackfillJob(supabase, ctx.workspace.id);
    if (latest && (latest.status === "pending" || latest.status === "running")) {
      return {
        ok: false,
        error: `Backfill already in progress (${latest.processed_notes}/${latest.total_notes})`,
      };
    }

    // Count notes in the workspace (join through boxes)
    const { data: boxes } = await supabase
      .from("boxes")
      .select("id")
      .eq("workspace_id", ctx.workspace.id);
    const boxIds = (boxes ?? []).map((b) => b.id);
    const { count } = await supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .in("box_id", boxIds);
    const totalNotes = count ?? 0;

    const job = await createBackfillJob(
      supabase,
      ctx.workspace.id,
      ctx.user.id,
      totalNotes
    );

    // Fire the actual backfill work asynchronously
    const workspaceId = ctx.workspace.id;
    after(async () => {
      const supa = await createClient();
      await runBackfill(supa, job.id, workspaceId, boxIds);
    });

    return { ok: true, data: { jobId: job.id, totalNotes } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed",
    };
  }
}

export async function getBackfillStatusAction(): Promise<
  ActionResult<KgBackfillJob | null>
> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const job = await getLatestBackfillJob(supabase, ctx.workspace.id);
    return { ok: true, data: job };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed",
    };
  }
}

// ─── Internal worker ────────────────────────────────────────────────────

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500; // gentle rate-limit between batches

async function runBackfill(
  supabase: SupabaseClient,
  jobId: string,
  workspaceId: string,
  boxIds: string[]
): Promise<void> {
  await updateBackfillJob(supabase, jobId, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  let processed = 0;
  let failed = 0;
  let offset = 0;

  try {
    while (true) {
      const { data: notes, error } = await supabase
        .from("notes")
        .select("id, title, markdown_content, box_id")
        .in("box_id", boxIds)
        .is("kg_last_extracted_at", null)
        .range(offset, offset + BATCH_SIZE - 1);
      if (error) throw error;
      if (!notes || notes.length === 0) break;

      // Process the batch in parallel (OpenAI can handle ~10 concurrent)
      const results = await Promise.allSettled(
        notes.map((n) =>
          extractAndStoreEntities(supabase, {
            workspaceId,
            noteId: n.id,
            title: n.title ?? "",
            content: n.markdown_content ?? "",
            branchId: null,
          })
        )
      );
      for (const r of results) {
        if (r.status === "fulfilled") processed += 1;
        else failed += 1;
      }

      await updateBackfillJob(supabase, jobId, {
        processed_notes: processed,
        failed_notes: failed,
      });
      offset += BATCH_SIZE;

      // Gentle rate limit
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }

    await updateBackfillJob(supabase, jobId, {
      status: "completed",
      processed_notes: processed,
      failed_notes: failed,
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    await updateBackfillJob(supabase, jobId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      completed_at: new Date().toISOString(),
    });
  }
}
