/**
 * POST /api/agent/tools/list_skills_plugins
 *
 * Internal endpoint. Called by the orchestrator (Pog) when it needs to know
 * which skills in the workspace are available as sub-agents. Returns a slim
 * descriptor list ordered by recency — orchestrator picks based on name +
 * description, then calls invoke_subagent with the chosen skill id.
 *
 * Body: { limit?: number } (default 20)
 * Returns: { run_id, skills: SkillPluginSummary[] }
 */
import { type NextRequest } from "next/server";
import { apiOk, apiError, E_BAD_REQUEST } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SkillPluginSummary } from "@/server/domain/types/subagent";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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
        return E_BAD_REQUEST(`Missing required header: ${auth.failure.field}`);
      case "invalid_envelope":
        return E_BAD_REQUEST(
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`
        );
    }
  }
  const { ctx } = auth;

  let body: { limit?: number };
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const limit = Math.max(
    1,
    Math.min(
      MAX_LIMIT,
      typeof body.limit === "number" && Number.isFinite(body.limit)
        ? Math.floor(body.limit)
        : DEFAULT_LIMIT
    )
  );

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("skills")
    .select("id, name, description, subagent_tools, subagent_max_turns")
    .eq("workspace_id", ctx.workspaceId)
    .eq("is_subagent", true)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    return apiError("internal", `Failed to list skills: ${error.message}`, 500);
  }

  const skills: SkillPluginSummary[] = (data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string) ?? "",
    description: (row.description as string | null) ?? null,
    subagent_tools: (row.subagent_tools as string[] | null) ?? null,
    subagent_max_turns: (row.subagent_max_turns as number | null) ?? null,
  }));

  return apiOk({ run_id: ctx.runId, skills });
}
