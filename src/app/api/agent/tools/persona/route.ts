import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPersonaBySlug } from "@/server/services/agent_personas_service";

/**
 * POST /api/agent/tools/persona
 *
 * Internal endpoint invoked by the Workspace Operator (Modal Python agent)
 * at run start to load the persona configuration for a run. The agent
 * passes the `persona_slug` field from OperatorInput; we resolve it to a
 * workspace-scoped row (falling back to the global row) via
 * `getPersonaBySlug` and return the raw persona row.
 *
 * When the slug is unknown (or RLS hides the row), the route returns
 * `{ persona: null }` so the operator can fall back to default persona
 * semantics without blowing up the run.
 *
 * Body: { slug: string }
 * Returns: { persona: AgentPersonaRow | null }
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

  let body: { slug?: unknown };
  try {
    body = (await request.json()) as { slug?: unknown };
  } catch {
    return apiError("bad_request", "Invalid JSON body", 400);
  }

  if (typeof body.slug !== "string" || body.slug.trim().length === 0) {
    return apiError("bad_request", "slug is required", 400);
  }
  const slug = body.slug.trim();

  const admin = createAdminClient();

  try {
    const persona = await getPersonaBySlug(admin, ctx.workspaceId, slug);
    return apiOk({ persona });
  } catch (err) {
    console.error("[agent_tools_persona] failed", err);
    return E_INTERNAL();
  }
}
