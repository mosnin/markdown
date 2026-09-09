import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRelayAuth } from "@/server/auth/relay_auth";
import { withApiHandler } from "@/server/api/with_api_handler";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INSUFFICIENT_SCOPE,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import { createBriefForProject } from "@/server/services/handoff_brief_service";
import {
  getProjectBySlug,
  toProjectSlug,
} from "@/server/repositories/project_repository";
import { DEFAULT_BRIEF_BUDGET_TOKENS } from "@/server/domain/constants/agent_session_constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/relay/handoff?project=<slug>&budget=<tokens>
 *
 * The endpoint this product exists for: "what happened before me?"
 *
 * Returns a markdown brief sized to a token budget, assembled deterministically
 * from prior sessions' checkpoints and salient events, ordered so that what
 * survives a small budget is what a fresh agent would most regret not knowing —
 * why the last session stopped, what is blocked, what was decided, what is
 * half-done.
 *
 * Query parameters:
 *   project    required. Repo URL, directory name, or slug.
 *   budget     optional token budget (default 4000, max 32000).
 *   session_id optional. The asking session, excluded from its own history and
 *              recorded as the brief's requester.
 *   sessions   optional. How many prior sessions to fold in (default 5).
 *   format     optional. "markdown" (default) returns text/markdown so a hook
 *              can pipe the body straight into an agent's context.
 *
 * Auth: relay key, or OAuth token with `relay:read`.
 */
export const GET = withApiHandler(async (request: NextRequest) => {
  const ctx = await resolveRelayAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!ctx.canRead) return E_INSUFFICIENT_SCOPE("relay:read");

  const url = new URL(request.url);

  const projectRaw = url.searchParams.get("project");
  if (!projectRaw) return E_BAD_REQUEST("project query parameter is required");

  const slug = toProjectSlug(projectRaw);
  if (!slug) return E_BAD_REQUEST("project is not a usable identifier");

  const admin = createAdminClient();
  const project = await getProjectBySlug(admin, ctx.workspaceId, slug);
  if (!project) {
    return E_NOT_FOUND(
      `No project '${slug}' in this workspace. Nothing has been logged for it yet.`
    );
  }

  const budget = Number(url.searchParams.get("budget") ?? DEFAULT_BRIEF_BUDGET_TOKENS);
  const maxSessions = Number(url.searchParams.get("sessions") ?? 5);
  const requestingSessionId = url.searchParams.get("session_id");

  const { brief, assembled } = await createBriefForProject(admin, ctx.workspaceId, {
    project_id: project.id,
    budget_tokens: Number.isFinite(budget) ? budget : undefined,
    max_sessions: Number.isFinite(maxSessions) ? maxSessions : undefined,
    requesting_session_id: requestingSessionId,
  });

  // Hooks pipe this straight into an agent's context, so serve raw markdown
  // when asked rather than making the shim unwrap a JSON envelope.
  if (url.searchParams.get("format") === "markdown") {
    return new Response(assembled.body, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "x-relay-token-estimate": String(assembled.token_estimate),
        "x-relay-source-sessions": String(assembled.source_session_ids.length),
      },
    });
  }

  return apiOk({
    brief_id: brief?.id ?? null,
    project: { id: project.id, slug: project.slug, name: project.name },
    body: assembled.body,
    state: assembled.state,
    token_estimate: assembled.token_estimate,
    budget_tokens: assembled.budget_tokens,
    source_session_ids: assembled.source_session_ids,
    empty: assembled.empty,
  });
});
