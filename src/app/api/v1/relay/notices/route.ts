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
import { answerNotice, postNotice } from "@/server/services/coordination_service";
import {
  getProjectBySlug,
  toProjectSlug,
} from "@/server/repositories/project_repository";

export const dynamic = "force-dynamic";

/**
 * Notices — the agent-to-agent channel.
 *
 * The event log records what happened and a brief summarises the past; neither
 * lets a running agent say something to its peers right now. Without this,
 * coordination degrades to agents inferring each other's intent from file-edit
 * events, which is guesswork.
 *
 * Notices are delivered through check-in rather than pushed, for the same
 * reason everything else here is: agents poll, humans stream.
 */

/**
 * POST /api/v1/relay/notices
 *
 * Body: { project, body, kind?, session_id?, to_session_id?, importance? }
 *   kind: broadcast (default) | direct | alert | question | answer
 *
 * `question` notices keep surfacing in every peer's check-in until somebody
 * answers them, which is what stops a question scrolling away unanswered.
 *
 * Auth: relay key, or OAuth token with `relay:write`.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const ctx = await resolveRelayAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!ctx.canWrite) return E_INSUFFICIENT_SCOPE("relay:write");

  let body: {
    project?: string;
    body?: string;
    kind?: "broadcast" | "direct" | "alert" | "question" | "answer";
    session_id?: string;
    to_session_id?: string;
    importance?: number;
    answers_notice_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  if (!body.project) return E_BAD_REQUEST("project is required");
  if (!body.body?.trim()) return E_BAD_REQUEST("body is required");

  const slug = toProjectSlug(body.project);
  if (!slug) return E_BAD_REQUEST("project is not a usable identifier");

  const admin = createAdminClient();
  const project = await getProjectBySlug(admin, ctx.workspaceId, slug);
  if (!project) return E_NOT_FOUND(`No project '${slug}' in this workspace`);

  const notice = await postNotice(admin, ctx.workspaceId, body.session_id ?? null, {
    projectId: project.id,
    body: body.body,
    kind: body.kind,
    toSessionId: body.to_session_id ?? null,
    importance: body.importance,
  });

  // Answering closes the question so it stops appearing in everyone's check-in.
  if (body.answers_notice_id) {
    await answerNotice(admin, ctx.workspaceId, body.answers_notice_id);
  }

  return apiOk(notice, 201);
});

/**
 * GET /api/v1/relay/notices?project=&limit=
 *
 * Recent notices on a project, newest first. The dashboard's view of the
 * channel; agents normally receive these through check-in instead.
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
  if (!project) return apiOk({ project: null, notices: [] });

  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50)
  );

  const { data, error } = await admin
    .from("project_notices")
    .select(
      "id, from_session_id, to_session_id, kind, body, importance, answered_at, created_at"
    )
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return E_BAD_REQUEST(`Failed to list notices: ${error.message}`);
  }

  return apiOk({
    project: { id: project.id, slug: project.slug, name: project.name },
    notices: data ?? [],
  });
});
