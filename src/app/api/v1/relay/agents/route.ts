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
import { listActiveAgents } from "@/server/services/coordination_service";
import {
  getProjectBySlug,
  toProjectSlug,
} from "@/server/repositories/project_repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/relay/agents?project=
 *
 * Who is working on this project right now, what each one says it is doing,
 * and what each one has claimed.
 *
 * A read-only roster, for a human opening the dashboard or an agent orienting
 * itself before it starts. Sessions that have gone quiet past the idle
 * threshold are demoted as a side effect of this read — an agent killed by a
 * usage cap never reports that it stopped, so silence has to be interpreted
 * rather than waited on, or a dead agent appears live to its peers forever.
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
  if (!project) return apiOk({ project: null, agents: [] });

  const agents = await listActiveAgents(admin, project.id);

  return apiOk({
    project: { id: project.id, slug: project.slug, name: project.name },
    agents,
    active_count: agents.filter((a) => a.status === "active").length,
  });
});
