import { type NextRequest } from "next/server";
import { apiOk, apiError, E_INTERNAL } from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listMemories,
  createMemory,
  touchMemory,
  type AgentMemoryType,
} from "@/server/services/agent_memories_service";

/**
 * POST /api/agent/tools/memories
 *
 * Unified memory read/write tool exposed to the Python agent. The
 * `operation` discriminator picks which agent_memories_service call to
 * dispatch to:
 *
 *   read   — listMemories() filtered by optional memory_type
 *   write  — createMemory() stamped with the run's id (createdByRun)
 *   boost  — touchMemory() to refresh last_used_at on reuse
 *
 * Any write or boost is scoped to the envelope's workspace, so the agent
 * cannot leak memories across workspace boundaries even if it fumbles the
 * IDs.
 *
 * Body: { operation: "read"|"write"|"boost", memory_type?, title?, content?,
 *         relevance?, memory_id?, limit? }
 */

const ALLOWED_MEMORY_TYPES = new Set<AgentMemoryType>([
  "workspace_facts",
  "user_preferences",
  "recent_work",
  "learned_schemas",
  "project_context",
]);

interface Body {
  operation?: string;
  memory_type?: string;
  title?: string;
  content?: string;
  relevance?: number;
  memory_id?: string;
  limit?: number;
}

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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return apiError("bad_request", "Invalid JSON body", 400);
  }

  const op = body.operation;
  if (op !== "read" && op !== "write" && op !== "boost") {
    return apiError(
      "bad_request",
      "operation must be one of: read, write, boost",
      400
    );
  }

  const admin = createAdminClient();

  try {
    if (op === "read") {
      let memoryType: AgentMemoryType | undefined;
      if (body.memory_type !== undefined) {
        if (!ALLOWED_MEMORY_TYPES.has(body.memory_type as AgentMemoryType)) {
          return apiError(
            "bad_request",
            `Invalid memory_type: ${body.memory_type}`,
            400
          );
        }
        memoryType = body.memory_type as AgentMemoryType;
      }
      const limit =
        typeof body.limit === "number" && Number.isFinite(body.limit)
          ? body.limit
          : 10;
      const memories = await listMemories(admin, {
        workspaceId: ctx.workspaceId,
        memoryType,
        limit,
      });
      return apiOk({ memories });
    }

    if (op === "write") {
      if (!body.memory_type || typeof body.memory_type !== "string") {
        return apiError("bad_request", "memory_type is required for write", 400);
      }
      if (!ALLOWED_MEMORY_TYPES.has(body.memory_type as AgentMemoryType)) {
        return apiError(
          "bad_request",
          `Invalid memory_type: ${body.memory_type}`,
          400
        );
      }
      if (!body.title || typeof body.title !== "string") {
        return apiError("bad_request", "title is required for write", 400);
      }
      if (!body.content || typeof body.content !== "string") {
        return apiError("bad_request", "content is required for write", 400);
      }

      try {
        const memory = await createMemory(admin, {
          workspaceId: ctx.workspaceId,
          memoryType: body.memory_type as AgentMemoryType,
          title: body.title,
          content: body.content,
          relevance: body.relevance,
          createdByRun: ctx.runId,
        });
        return apiOk({ memory });
      } catch (err) {
        // createMemory throws on length / range violations; surface those
        // as a 400 rather than a generic 500 so the agent can self-correct.
        const msg = err instanceof Error ? err.message : "unknown";
        if (
          /must be between|is required/i.test(msg)
        ) {
          return apiError("bad_request", msg, 400);
        }
        throw err;
      }
    }

    // op === "boost"
    if (!body.memory_id || typeof body.memory_id !== "string") {
      return apiError("bad_request", "memory_id is required for boost", 400);
    }
    await touchMemory(admin, body.memory_id);
    return apiOk({ ok: true });
  } catch (err) {
    console.error("[agent_tools_memories] failed", err);
    return E_INTERNAL();
  }
}
