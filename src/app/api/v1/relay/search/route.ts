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
import { searchTranscripts } from "@/server/services/transcript_service";
import {
  getProjectBySlug,
  toProjectSlug,
} from "@/server/repositories/project_repository";
import { searchEvents } from "@/server/repositories/session_event_repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/relay/search?project=&q=
 *
 * Search everything earlier agents did and said on a project — the event log
 * and the conversation together.
 *
 * This is the counterpart to the handoff brief. The brief is what an agent
 * reads unprompted at session start, sized to a budget. This is what it calls
 * when it has a specific question the brief did not answer: "did anyone try
 * optimistic locking here?", "what happened last time this test failed?"
 *
 * Progressive disclosure is the point. Rather than inflate every brief with
 * detail most sessions will not need, the brief stays small and the detail
 * stays one query away.
 *
 * Query parameters:
 *   project  required
 *   q        required — the search text
 *   limit    optional, default 12, max 50
 *   kind     optional — "conversation" (default) | "events" | "all"
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

  const query = url.searchParams.get("q");
  if (!query || query.trim().length === 0) {
    return E_BAD_REQUEST("q query parameter is required");
  }

  const slug = toProjectSlug(projectRaw);
  if (!slug) return E_BAD_REQUEST("project is not a usable identifier");

  const admin = createAdminClient();
  const project = await getProjectBySlug(admin, ctx.workspaceId, slug);
  if (!project) {
    return apiOk({ project: null, conversation: [], events: [] });
  }

  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit") ?? 12) || 12)
  );
  const kind = url.searchParams.get("kind") ?? "conversation";

  const conversation =
    kind === "events"
      ? []
      : await searchTranscripts(admin, ctx.workspaceId, {
          projectId: project.id,
          query,
          limit,
        });

  const events =
    kind === "conversation"
      ? []
      : (await searchEvents(admin, project.id, query, { limit })).map((event) => ({
          session_id: event.session_id,
          sequence: event.sequence,
          event_type: event.event_type,
          summary: event.summary,
          importance: event.importance,
          occurred_at: event.occurred_at,
        }));

  return apiOk({
    project: { id: project.id, slug: project.slug, name: project.name },
    query,
    conversation,
    events,
    // Tells the caller how to turn a hit into readable context, which is not
    // obvious from a bare list of matching paragraphs.
    hint:
      conversation.length > 0
        ? "Use GET /api/v1/relay/transcripts/{session_id}?around={ordinal} to read the conversation around a hit."
        : undefined,
  });
});
