import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  apiOk,
  apiError,
  E_INTERNAL,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

/**
 * POST /api/agent/tools/workspace_context
 *
 * Internal endpoint invoked by the Workspace Operator (Modal Python agent)
 * to fetch byte-stable workspace metadata for the prompt-cache prefix block
 * (see `_build_workspace_context_block` in the agent).
 *
 * The payload is intentionally compact and sorted deterministically
 * server-side so the Python agent can concatenate it into the system
 * prompt without running its own sort. Two calls with no workspace-level
 * writes between them return byte-identical bytes, which is what makes the
 * OpenAI auto-cache hit for every run.
 *
 * Body: {} (the envelope headers carry user_id / workspace_id)
 * Returns: {
 *   workspace_id,
 *   workspace_name,
 *   boxes: [{ id, name, note_count }, ...]   // sorted (name, id) asc
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

  const admin = createAdminClient();

  try {
    const { data: ws, error: wsErr } = await admin
      .from("workspaces")
      .select("id, name")
      .eq("id", ctx.workspaceId)
      .maybeSingle();
    if (wsErr) throw wsErr;
    if (!ws) {
      return apiError("workspace_not_found", "Workspace not found", 404);
    }

    // Boxes on main (branch_id is null), excluding trashed. Note counts are
    // a rough signal for the agent; we deliberately count via a grouped
    // query on main to keep results byte-stable across branch state.
    const { data: rawBoxes, error: boxErr } = await admin
      .from("boxes")
      .select("id, name")
      .eq("workspace_id", ctx.workspaceId)
      .neq("status", "trashed")
      .is("branch_id", null);
    if (boxErr) throw boxErr;

    const boxes = (rawBoxes ?? []) as Array<{ id: string; name: string }>;

    // Per-box note count on main. One small query per box keeps the shape
    // simple and avoids a view dependency; workspaces with thousands of boxes
    // aren't the target here.
    const counts = new Map<string, number>();
    for (const b of boxes) {
      const { count } = await admin
        .from("notes")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId)
        .eq("box_id", b.id)
        .is("branch_id", null)
        .neq("status", "trashed");
      counts.set(b.id, count ?? 0);
    }

    // Deterministic ordering: primary (name asc), tie-break on id asc.
    // The agent side sorts again, but server-side sort lets us respond with
    // a ready-to-render list and keeps byte stability even if the Python
    // sort implementation drifts.
    const sorted = [...boxes].sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      return a.id.localeCompare(b.id);
    });

    return apiOk({
      run_id: ctx.runId,
      workspace_id: ws.id,
      workspace_name: ws.name,
      boxes: sorted.map((b) => ({
        id: b.id,
        name: b.name,
        note_count: counts.get(b.id) ?? 0,
      })),
    });
  } catch (err) {
    console.error("[agent_tools_workspace_context] failed", err);
    return E_INTERNAL();
  }
}
