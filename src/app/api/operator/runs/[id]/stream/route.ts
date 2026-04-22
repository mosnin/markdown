/**
 * GET /api/operator/runs/[id]/stream
 *
 * Server-Sent Events stream of operator_run_events for a single run.
 *
 * Flow:
 *   1. Authenticate via bearer token OR Supabase session cookie.
 *   2. Resolve workspace membership → ensure caller owns the run.
 *   3. Flush historical events (optionally from Last-Event-ID / cursor).
 *   4. Open a Supabase Realtime subscription to the run's event channel
 *      and forward INSERTs as SSE messages.
 *   5. Close on terminal events (completed / failed / cancelled) OR when
 *      the client disconnects.
 *
 * Re-connects: clients may send `Last-Event-ID: <sequence>` so we skip
 * already-delivered events. A `?afterSequence=N` query param is also
 * honoured for hand-testing.
 */
import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import {
  parseOperatorBearer,
  verifyApiKey,
} from "@/server/services/operator_api_keys_service";
import {
  listEventsForRun,
  type OperatorRunEventRow,
} from "@/server/services/operator_run_events_service";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";
import { isWorkspaceOperatorEnabled } from "@/lib/env";

export const runtime = "nodejs";
// Stream responses run as long as the client holds the connection open.
// Vercel serverless functions cap at 10-15m; self-hosted Node has no cap.
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TERMINAL_EVENTS = new Set(["completed", "failed", "cancelled"]);
const HEARTBEAT_MS = 15_000;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Authenticate the stream request. Returns the workspace id + user id
 * on success; a Response when the caller should be rejected.
 */
async function authenticate(
  request: NextRequest
): Promise<
  | { ok: true; workspaceId: string }
  | { ok: false; response: Response }
> {
  // Bearer path first — matches /api/operator/runs/[id] GET.
  const bearer = parseOperatorBearer(request.headers.get("authorization"));
  if (bearer) {
    const verified = await verifyApiKey(bearer);
    if (!verified) {
      return {
        ok: false,
        response: new Response("Unauthorized", { status: 401 }),
      };
    }
    return { ok: true, workspaceId: verified.workspaceId };
  }

  // Fallback to Supabase session cookie (browser requests).
  try {
    const supabase = await createSessionClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        ok: false,
        response: new Response("Unauthorized", { status: 401 }),
      };
    }
    // Resolve the caller's workspace via the membership they're signed into.
    // We rely on the RLS client to filter — any row it returns is legitimate.
    const { data: memberships } = await supabase
      .from("workspace_memberships")
      .select("workspace_id")
      .eq("user_id", user.id);
    if (!memberships || memberships.length === 0) {
      return {
        ok: false,
        response: new Response("Forbidden", { status: 403 }),
      };
    }
    // Caller may belong to multiple workspaces; we resolve the run's
    // workspace below and cross-check membership, so any workspace id
    // here works as the seed value.
    return { ok: true, workspaceId: memberships[0].workspace_id as string };
  } catch {
    return {
      ok: false,
      response: new Response("Unauthorized", { status: 401 }),
    };
  }
}

function sseEncode(
  row: Pick<
    OperatorRunEventRow,
    "id" | "sequence" | "event_type" | "payload"
  > & { sequence: number; event_type: string; payload: unknown }
): string {
  // Standard SSE framing. Include the sequence as the event id so the
  // browser's EventSource sends it back in Last-Event-ID on reconnect.
  const payload = JSON.stringify({
    sequence: row.sequence,
    event_type: row.event_type,
    payload: row.payload,
  });
  return `event: ${row.event_type}\nid: ${row.sequence}\ndata: ${payload}\n\n`;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isWorkspaceOperatorEnabled()) {
    return new Response("Operator disabled", { status: 503 });
  }

  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  const admin = createAdminClient();
  const run = await getOperatorRun(admin, id);
  if (!run) {
    return new Response("Not found", { status: 404 });
  }

  const bearer = parseOperatorBearer(request.headers.get("authorization"));
  if (bearer) {
    // Bearer path: the key's workspace must match the run's workspace.
    if (auth.workspaceId !== run.workspace_id) {
      return new Response("Not found", { status: 404 });
    }
  } else {
    // Cookie path: resolve the caller's user id and verify an explicit
    // membership row exists for THIS workspace (not just any workspace).
    // A previous version only checked "does the workspace have any
    // members", which trivially passed for any authenticated caller.
    const sessionClient = await createSessionClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();
    if (!user) {
      return new Response("Not found", { status: 404 });
    }
    const { data: membership } = await admin
      .from("workspace_memberships")
      .select("workspace_id")
      .eq("workspace_id", run.workspace_id)
      .eq("user_id", user.id)
      .limit(1);
    if (!membership || membership.length === 0) {
      return new Response("Not found", { status: 404 });
    }
  }

  // Parse reconnection cursor.
  const lastEventIdHeader = request.headers.get("last-event-id");
  const afterSequenceQuery = request.nextUrl.searchParams.get("afterSequence");
  const initialCursor =
    (lastEventIdHeader && Number.parseInt(lastEventIdHeader, 10)) ||
    (afterSequenceQuery && Number.parseInt(afterSequenceQuery, 10)) ||
    0;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function safeEnqueue(chunk: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      }

      function closeStream() {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      // 1. Flush history. Paginate in case the cursor is old enough that
      //    there are >500 events to replay.
      let cursor: number | null = initialCursor > 0 ? initialCursor : null;
      let sawTerminal = false;
      // Starting `:ok` comment lets the client know the stream is live.
      safeEnqueue(": ok\n\n");

      // Safety cap on history replay so we don't flood a long run.
      for (let guard = 0; guard < 20; guard++) {
        const { rows, nextCursor } = await listEventsForRun(admin, {
          runId: id,
          afterSequence: cursor,
          limit: 500,
        });
        for (const row of rows) {
          safeEnqueue(sseEncode(row));
          if (TERMINAL_EVENTS.has(row.event_type)) {
            sawTerminal = true;
          }
        }
        if (!nextCursor || rows.length < 500) break;
        cursor = nextCursor;
      }

      if (sawTerminal) {
        safeEnqueue("event: done\ndata: {}\n\n");
        closeStream();
        return;
      }

      // 2. Subscribe to Realtime for new events on this run.
      const channel = admin
        .channel(`operator_run_events:${id}`, {
          config: { broadcast: { self: false } },
        })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "operator_run_events",
            filter: `run_id=eq.${id}`,
          },
          (payload) => {
            const row = payload.new as unknown as OperatorRunEventRow;
            if (!row) return;
            safeEnqueue(sseEncode(row));
            if (TERMINAL_EVENTS.has(row.event_type)) {
              safeEnqueue("event: done\ndata: {}\n\n");
              void admin.removeChannel(channel);
              closeStream();
            }
          }
        )
        .subscribe();

      // 3. Heartbeat comment lines so intermediaries don't kill idle
      //    connections and the browser keeps the EventSource alive.
      const heartbeat = setInterval(() => {
        safeEnqueue(`: hb ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      // 4. Client disconnect cleanup.
      const abortHandler = () => {
        clearInterval(heartbeat);
        void admin.removeChannel(channel);
        closeStream();
      };
      request.signal.addEventListener("abort", abortHandler, { once: true });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
