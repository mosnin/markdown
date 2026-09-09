import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRelayAuth } from "@/server/auth/relay_auth";
import {
  E_BAD_REQUEST,
  E_INSUFFICIENT_SCOPE,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  getProjectBySlug,
  toProjectSlug,
} from "@/server/repositories/project_repository";
import { listRecentEventsForProject } from "@/server/repositories/session_event_repository";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Streams run as long as the client holds the connection. Vercel caps
// serverless functions well below this; self-hosted Node has no cap.
export const maxDuration = 800;

const HEARTBEAT_MS = 15_000;
/** How many historical events we replay before going live. */
const BACKFILL_LIMIT = 50;

/**
 * GET /api/v1/relay/stream?project=<slug>
 *
 * Server-Sent Events feed of a project's session events, across every agent
 * working on it. This is the live timeline: three agents on three plans, one
 * ordered stream.
 *
 * Flow:
 *   1. Authenticate, resolve the project.
 *   2. Flush recent history so a client that just connected has context,
 *      oldest first (honouring `?since=<iso>` when reconnecting).
 *   3. Subscribe to the project's Realtime broadcast channel and forward
 *      events as they are ingested.
 *   4. Heartbeat every 15s so proxies do not reap an idle connection.
 *
 * The stream never terminates on its own — a project is never "done" the way a
 * single run is — so clients close it when they navigate away.
 *
 * Auth: relay key, or OAuth token with `relay:read`.
 */
export async function GET(request: NextRequest): Promise<Response> {
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
  if (!project) return E_NOT_FOUND(`No project '${slug}' in this workspace`);

  const since = url.searchParams.get("since") ?? undefined;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Controller already closed by a client disconnect.
          closed = true;
        }
      };

      send("open", { project_id: project.id, project_slug: project.slug });

      // ── Backfill ─────────────────────────────────────────────────────────
      try {
        const history = await listRecentEventsForProject(admin, project.id, {
          limit: BACKFILL_LIMIT,
          since,
        });
        // The query returns newest-first; a timeline reads oldest-first.
        for (const event of [...history].reverse()) {
          send("session_event", {
            id: event.id,
            session_id: event.session_id,
            sequence: event.sequence,
            event_type: event.event_type,
            summary: event.summary,
            actor: event.actor,
            tool_name: event.tool_name,
            files: event.files,
            importance: event.importance,
            occurred_at: event.occurred_at,
            historical: true,
          });
        }
        send("backfill_complete", { count: history.length });
      } catch (err) {
        logger.warn({ err, projectId: project.id }, "Relay stream backfill failed");
        send("error", { message: "Backfill failed; live events will still arrive" });
      }

      // ── Live ─────────────────────────────────────────────────────────────
      const channel = admin.channel(`project:${project.id}`, {
        config: { broadcast: { self: false } },
      });

      channel.on("broadcast", { event: "session_event" }, (message) => {
        send("session_event", message.payload);
      });

      await channel.subscribe();

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        void admin.removeChannel(channel);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer streamed responses unless told not to.
      "x-accel-buffering": "no",
    },
  });
}
