import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRelayAuth } from "@/server/auth/relay_auth";
import { withApiHandler } from "@/server/api/with_api_handler";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INSUFFICIENT_SCOPE,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  openOrResumeSession,
  type OpenSessionRequest,
} from "@/server/services/session_ingest_service";
import { listSessionsForProject } from "@/server/repositories/agent_session_repository";
import { getProjectBySlug, toProjectSlug } from "@/server/repositories/project_repository";
import { SESSION_IDLE_AFTER_MS } from "@/server/domain/constants/agent_session_constants";
import { markStaleSessionsIdle } from "@/server/repositories/agent_session_repository";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/relay/sessions
 *
 * Open or resume an agent session. Called by a SessionStart hook, or by any
 * agent that is about to start work and wants to be visible in the timeline.
 *
 * Idempotent on (project, external_id): calling it repeatedly for one agent
 * run returns the same session. Hooks are encouraged to call it on every
 * event batch if they cannot tell whether they have run before.
 *
 * Auth: relay key, or OAuth token with `relay:write`.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const ctx = await resolveRelayAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!ctx.canWrite) return E_INSUFFICIENT_SCOPE("relay:write");

  let body: OpenSessionRequest;
  try {
    body = (await request.json()) as OpenSessionRequest;
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  if (!body?.project) return E_BAD_REQUEST("project is required");
  if (!body?.external_id) return E_BAD_REQUEST("external_id is required");

  const admin = createAdminClient();
  const { project, session, created } = await openOrResumeSession(
    admin,
    ctx.workspaceId,
    body
  );

  return apiOk(
    {
      session_id: session.id,
      project_id: project.id,
      project_slug: project.slug,
      created,
      status: session.status,
      event_count: session.event_count,
      started_at: session.started_at,
    },
    created ? 201 : 200
  );
});

/**
 * GET /api/v1/relay/sessions?project=<slug>
 *
 * List a project's sessions, newest first. This is what a resuming agent calls
 * to see who else is or was working, before deciding whether to ask for a
 * brief.
 *
 * Sessions that have gone quiet past the idle threshold are flipped to 'idle'
 * as a side effect of this read: an agent killed by a usage cap never gets to
 * report that it stopped, so silence has to be interpreted rather than
 * awaited.
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
  if (!project) return apiOk({ project: null, sessions: [] });

  await markStaleSessionsIdle(admin, project.id, SESSION_IDLE_AFTER_MS);

  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") ?? 25) || 25)
  );
  const sessions = await listSessionsForProject(admin, project.id, { limit });

  return apiOk({
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      last_active_at: project.last_active_at,
    },
    sessions,
  });
});
