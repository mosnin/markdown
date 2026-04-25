import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  createMemory,
  listMemories,
  type AgentMemoryType,
} from "@/server/services/agent_memories_service";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * GET /api/agent/memories?workspace_id=...&memory_type=...&limit=...
 *
 * List persistent agent memories for a workspace. RLS scopes rows to
 * workspaces the caller is a member of, so unauthorized workspace ids
 * simply return an empty list rather than 403.
 *
 * POST /api/agent/memories
 *
 * Create a new memory. The DB INSERT policy permits any workspace
 * member; validation here mirrors the service-layer CHECK bounds so
 * callers get a clean 400 before the query runs.
 */

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEMORY_TYPES: ReadonlySet<AgentMemoryType> = new Set<AgentMemoryType>([
  "workspace_facts",
  "user_preferences",
  "recent_work",
  "learned_schemas",
  "project_context",
]);

function isMemoryType(value: string): value is AgentMemoryType {
  return MEMORY_TYPES.has(value as AgentMemoryType);
}

export const GET = withApiHandler(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED("Valid session required.");
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace_id");
  const memoryTypeRaw = url.searchParams.get("memory_type");
  const limitRaw = url.searchParams.get("limit");

  if (!workspaceId) {
    return E_BAD_REQUEST("workspace_id query parameter is required.");
  }
  if (!UUID_RE.test(workspaceId)) {
    return E_BAD_REQUEST("workspace_id must be a valid UUID.");
  }

  let memoryType: AgentMemoryType | undefined;
  if (memoryTypeRaw !== null) {
    if (!isMemoryType(memoryTypeRaw)) {
      return E_BAD_REQUEST(
        `memory_type must be one of: ${Array.from(MEMORY_TYPES).join(", ")}.`
      );
    }
    memoryType = memoryTypeRaw;
  }

  let limit = 20;
  if (limitRaw !== null) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return E_BAD_REQUEST("limit must be a positive integer.");
    }
    limit = parsed;
  }

  try {
    const rows = await listMemories(supabase, {
      workspaceId,
      memoryType,
      limit,
    });
    return apiOk({ memories: rows });
  } catch (err) {
    console.error("[agent memories GET] failed", {
      workspace_id: workspaceId,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to list agent memories.");
  }
});

interface CreateMemoryBody {
  workspace_id?: unknown;
  memory_type?: unknown;
  title?: unknown;
  content?: unknown;
  relevance?: unknown;
}

export const POST = withApiHandler(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED("Valid session required.");
  }

  let body: CreateMemoryBody;
  try {
    body = (await request.json()) as CreateMemoryBody;
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON.");
  }

  const { workspace_id, memory_type, title, content, relevance } = body;

  if (typeof workspace_id !== "string" || !UUID_RE.test(workspace_id)) {
    return E_BAD_REQUEST("workspace_id must be a valid UUID.");
  }
  if (typeof memory_type !== "string" || !isMemoryType(memory_type)) {
    return E_BAD_REQUEST(
      `memory_type must be one of: ${Array.from(MEMORY_TYPES).join(", ")}.`
    );
  }
  if (typeof title !== "string") {
    return E_BAD_REQUEST("title must be a string.");
  }
  const trimmedTitle = title.trim();
  if (trimmedTitle.length < 1 || trimmedTitle.length > 200) {
    return E_BAD_REQUEST("title must be between 1 and 200 characters.");
  }
  if (typeof content !== "string") {
    return E_BAD_REQUEST("content must be a string.");
  }
  const trimmedContent = content.trim();
  if (trimmedContent.length < 1 || trimmedContent.length > 8000) {
    return E_BAD_REQUEST("content must be between 1 and 8000 characters.");
  }

  let relevanceValue: number | undefined;
  if (relevance !== undefined && relevance !== null) {
    if (typeof relevance !== "number" || !Number.isFinite(relevance)) {
      return E_BAD_REQUEST("relevance must be a finite number.");
    }
    if (relevance < 0 || relevance > 10) {
      return E_BAD_REQUEST("relevance must be between 0 and 10.");
    }
    relevanceValue = relevance;
  }

  try {
    const memory = await createMemory(supabase, {
      workspaceId: workspace_id,
      memoryType: memory_type,
      title: trimmedTitle,
      content: trimmedContent,
      relevance: relevanceValue,
    });
    return apiOk({ memory }, 201);
  } catch (err) {
    console.error("[agent memories POST] failed", {
      workspace_id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to create agent memory.");
  }
});
