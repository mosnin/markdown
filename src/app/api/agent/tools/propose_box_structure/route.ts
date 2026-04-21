import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/agent/tools/propose_box_structure
 *
 * STUB: the real implementation will cluster note embeddings and
 * synthesise a proposed reorganisation of the workspace's boxes. That
 * requires on-demand embedding access + non-trivial clustering cost we
 * don't want to spend until the UX around the proposals is ready.
 *
 * For now we implement a simple heuristic: pull each box's note count
 * and flag any box holding more than 40 notes as a split candidate. The
 * UI treats this as a "coarse suggestion, not a decision" — the summary
 * field makes the heuristic origin explicit so reviewers don't treat
 * the output as semantic.
 *
 * Body: { workspace_scope?: "all"|"box", box_id? }
 */

const SPLIT_THRESHOLD = 40;

interface Body {
  workspace_scope?: string;
  box_id?: string;
}

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
        return apiError(
          "bad_request",
          `Missing required header: ${auth.failure.field}`,
          400
        );
      case "invalid_envelope":
        return apiError(
          "bad_request",
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`,
          400
        );
    }
  }
  const { ctx } = auth;

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // Empty / invalid body is fine — all fields are optional.
    body = {};
  }

  const scope = body.workspace_scope ?? "all";
  if (scope !== "all" && scope !== "box") {
    return apiError(
      "bad_request",
      "workspace_scope must be one of: all, box",
      400
    );
  }
  if (scope === "box" && (!body.box_id || typeof body.box_id !== "string")) {
    return apiError(
      "bad_request",
      "box_id is required when workspace_scope='box'",
      400
    );
  }

  const admin = createAdminClient();

  try {
    let boxQuery = admin
      .from("boxes")
      .select("id, name")
      .eq("workspace_id", ctx.workspaceId)
      .limit(100);
    if (scope === "box" && body.box_id) {
      boxQuery = boxQuery.eq("id", body.box_id);
    }

    const { data: boxes, error: boxErr } = await boxQuery;
    if (boxErr) throw boxErr;

    const boxRows = (boxes ?? []) as { id: string; name: string }[];

    // Count notes per box. One round-trip per box; capped at 100 boxes
    // above so this is bounded. Returning `count` via head:true means
    // Postgres doesn't materialise rows.
    const currentStructure: Array<{
      box_id: string;
      name: string;
      note_count: number;
    }> = [];
    for (const b of boxRows) {
      const { count, error: countErr } = await admin
        .from("notes")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId)
        .eq("box_id", b.id);
      if (countErr) throw countErr;
      currentStructure.push({
        box_id: b.id,
        name: b.name,
        note_count: count ?? 0,
      });
    }

    const proposed = currentStructure
      .filter((b) => b.note_count > SPLIT_THRESHOLD)
      .map((b) => ({
        kind: "split" as const,
        box_id: b.box_id,
        rationale: `Box '${b.name}' holds ${b.note_count} notes (> ${SPLIT_THRESHOLD}); consider splitting into sub-boxes.`,
        suggested_sub_boxes: [
          `${b.name} — recent`,
          `${b.name} — reference`,
        ],
      }));

    const summary =
      proposed.length === 0
        ? `No boxes exceed the ${SPLIT_THRESHOLD}-note heuristic threshold. This is a heuristic proposal, not a semantic analysis.`
        : `Heuristic proposal: ${proposed.length} box(es) above the ${SPLIT_THRESHOLD}-note threshold are candidates for splitting. Embedding-based clustering is not enabled in this deploy.`;

    return apiOk({
      current_structure: currentStructure,
      proposed_reorganization: proposed,
      summary,
    });
  } catch (err) {
    console.error("[agent_tools_propose_box_structure] failed", err);
    return E_INTERNAL();
  }
}
