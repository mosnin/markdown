import { type NextRequest } from "next/server";
import {
  resolveMcpRequestAuth,
  requireScope,
  requireWrite,
} from "@/server/auth/mcp_auth_adapter";
import { getRequestContext } from "@/server/auth/get_request_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  promoteBranch,
  getDraftBranch,
  type PromoteProgressEvent,
} from "@/server/services/branch_service";
import {
  E_UNAUTHORIZED,
  E_INSUFFICIENT_SCOPE,
  E_FORBIDDEN_ROLE,
  E_BAD_REQUEST,
} from "@/lib/api/response";

/**
 * POST /api/v1/promote_stream
 *
 * Streaming endpoint that runs a branch promotion and emits
 * newline-delimited JSON progress events over an SSE-style
 * `text/event-stream` response.
 *
 * Request body:
 *   { branch_id: string, selected_objects?: Array<{objectType, objectId}>,
 *     force?: boolean, skip_gates?: boolean }
 *
 * Auth: OAuth / legacy-csk via `resolveMcpRequestAuth`, OR
 *       session-cookie via `getRequestContext`. The first path that
 *       resolves wins. Both require a write-capable role.
 *
 * Events (one JSON object per line):
 *   { step: 'gates',     status: 'running' }
 *   { step: 'gates',     status: 'passed', results: [...] }
 *   { step: 'gates',     status: 'skipped' }
 *   { step: 'promoting', current: 3, total: 12, object_type: 'note' }
 *   { step: 'done',      change_set_id: '...' }
 *   { step: 'error',     message: '...' }
 */
export async function POST(request: NextRequest) {
  // ── Resolve auth (MCP token OR session cookie) ───────────────────
  let workspaceId: string;
  let actorId: string;
  let supabase: ReturnType<typeof createAdminClient>;

  const mcpCtx = await resolveMcpRequestAuth(request);
  if (mcpCtx) {
    if (!requireScope(mcpCtx, "context:read")) {
      return E_INSUFFICIENT_SCOPE("context:read");
    }
    if (!requireWrite(mcpCtx)) {
      return E_FORBIDDEN_ROLE("Viewer role cannot promote branches");
    }
    workspaceId = mcpCtx.workspaceId;
    actorId = mcpCtx.userId ?? mcpCtx.connectionId;
    supabase = createAdminClient();
  } else {
    // Fall back to session-cookie auth (browser-initiated request).
    const sessionCtx = await getRequestContext();
    if (
      !sessionCtx.isAuthenticated ||
      !sessionCtx.user ||
      !sessionCtx.workspace
    ) {
      return E_UNAUTHORIZED();
    }
    const role = sessionCtx.workspace.role;
    if (role !== "owner" && role !== "admin" && role !== "member") {
      return E_FORBIDDEN_ROLE("Viewer role cannot promote branches");
    }
    workspaceId = sessionCtx.workspace.id;
    actorId = sessionCtx.user.id;
    supabase = (await createClient()) as unknown as ReturnType<
      typeof createAdminClient
    >;
  }

  // ── Parse body ───────────────────────────────────────────────────
  let body: {
    branch_id?: string;
    selected_objects?: Array<{ objectType: string; objectId: string }>;
    force?: boolean;
    skip_gates?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const branchId = body.branch_id;
  if (!branchId || typeof branchId !== "string") {
    return E_BAD_REQUEST("branch_id is required");
  }

  // Validate branch belongs to workspace before opening the stream,
  // so obvious errors return a normal JSON error response.
  const branch = await getDraftBranch(supabase, branchId);
  if (!branch || branch.workspace_id !== workspaceId) {
    return E_BAD_REQUEST("Branch not found in this workspace");
  }
  if (branch.status !== "open") {
    return E_BAD_REQUEST(`Branch is ${branch.status}, cannot promote`);
  }

  // ── Build streaming response ─────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      /** Enqueue one newline-delimited JSON event. */
      const send = (event: PromoteProgressEvent): void => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Controller may be closed if the client disconnected.
        }
      };

      try {
        const result = await promoteBranch(
          supabase,
          workspaceId,
          actorId,
          branchId,
          {
            force: body.force ?? false,
            skip_gates: body.skip_gates ?? false,
            selectedObjects: body.selected_objects,
            onProgress: send,
          },
        );

        // The promoteBranch function emits { step: 'done' } via the
        // callback, but we also send it here as a safety net in case
        // the callback ordering changes in the future. Duplicate
        // 'done' events are harmless — clients should treat the first
        // as authoritative.
        send({ step: "done", change_set_id: result.changeSetId });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Promote failed";
        send({ step: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
