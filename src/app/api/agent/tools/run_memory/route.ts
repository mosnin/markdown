import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  apiOk,
  apiError,
  E_INTERNAL,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/run_memory
 *
 * Returns compact summaries of the user's recent operator runs in this
 * workspace so the Python agent can inject "what you just did" memory
 * into the current run's prompt prologue. Without this the agent has
 * amnesia between runs — it re-solves the same discovery problem every
 * time.
 *
 * The response is deliberately small (≤5 runs × a couple hundred chars)
 * so it doesn't dominate the context window. We exclude the current run
 * (by run_id from the envelope) and only include completed runs — an
 * in-flight sibling run isn't useful as memory.
 *
 * Body: { limit?: number } — default 5, capped at 10
 * Returns: {
 *   run_id,
 *   recent_runs: [{
 *     run_id, created_at, mode, prompt_preview, summary, note_titles
 *   }]
 * }
 */
export async function POST(request: NextRequest) {
  const auth = verifyAgentRequest(request);
  if (!auth.ok) {
    switch (auth.failure.kind) {
      case "feature_disabled":
        return apiError("feature_disabled", "Workspace Operator is not enabled", 404);
      case "missing_secret":
        return apiError("server_misconfigured", "Shared secret is not configured", 500);
      case "invalid_secret":
        return apiError("unauthorized", "Invalid shared secret", 401);
      case "missing_envelope":
        return apiError("bad_request", `Missing required header: ${auth.failure.field}`, 400);
      case "invalid_envelope":
        return apiError(
          "bad_request",
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`,
          400
        );
    }
  }
  const { ctx } = auth;

  let body: { limit?: number } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? Math.min(10, Math.max(1, Math.floor(body.limit)))
      : 5;

  const admin = createAdminClient();

  try {
    const { data: rows, error } = await admin
      .from("workspace_operator_runs")
      .select("id, created_at, mode, prompt, status, notes_created")
      .eq("workspace_id", ctx.workspaceId)
      .eq("user_id", ctx.userId)
      .neq("id", ctx.runId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const runs = rows ?? [];

    // Look up titles for the notes each run created (capped at 3 per run so
    // the memory block stays compact).
    const allNoteIds = Array.from(
      new Set(
        runs.flatMap((r) =>
          Array.isArray(r.notes_created) ? r.notes_created.slice(0, 3) : []
        )
      )
    );
    const noteTitles = new Map<string, string>();
    if (allNoteIds.length > 0) {
      // Constrain to notes whose box is in this workspace. `notes` has no
      // workspace_id column, so we filter via the boxes inner-join — this
      // hardens against any stale/poisoned note id in `notes_created`.
      const { data: noteRows } = await admin
        .from("notes")
        .select("id, title, boxes!inner(workspace_id)")
        .in("id", allNoteIds)
        .eq("boxes.workspace_id", ctx.workspaceId);
      for (const n of noteRows ?? []) {
        noteTitles.set(n.id as string, (n.title as string) ?? "");
      }
    }

    const recent_runs = runs.map((r) => {
      const promptText = typeof r.prompt === "string" ? r.prompt : "";
      const preview =
        promptText.length > 160 ? promptText.slice(0, 160) + "…" : promptText;
      const createdIds = Array.isArray(r.notes_created)
        ? (r.notes_created as string[]).slice(0, 3)
        : [];
      return {
        run_id: r.id,
        created_at: r.created_at,
        mode: r.mode,
        prompt_preview: preview,
        note_titles: createdIds
          .map((id) => noteTitles.get(id))
          .filter((t): t is string => !!t),
      };
    });

    return apiOk({ run_id: ctx.runId, recent_runs });
  } catch (err) {
    console.error("[agent_tools_run_memory] failed", err);
    return E_INTERNAL();
  }
}
