import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  deleteMemory,
  updateMemory,
  type UpdateMemoryPatch,
} from "@/server/services/agent_memories_service";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * PUT /api/agent/memories/[id]
 * DELETE /api/agent/memories/[id]
 *
 * Mutate a single memory row. RLS enforces workspace membership on
 * UPDATE and `can_admin_workspace` on DELETE, so ownership errors
 * surface as Postgres errors that we map to 500 — callers outside
 * the workspace simply hit an empty result set and the service layer
 * throws.
 */

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<Record<string, string>>;
}

interface UpdateMemoryBody {
  title?: unknown;
  content?: unknown;
  relevance?: unknown;
}

export const PUT = withApiHandler(async (request: NextRequest, { params }: RouteParams) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED("Valid session required.");
  }

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return E_NOT_FOUND("memory not found");
  }

  let body: UpdateMemoryBody;
  try {
    body = (await request.json()) as UpdateMemoryBody;
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON.");
  }

  const patch: UpdateMemoryPatch = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string") {
      return E_BAD_REQUEST("title must be a string.");
    }
    const trimmed = body.title.trim();
    if (trimmed.length < 1 || trimmed.length > 200) {
      return E_BAD_REQUEST("title must be between 1 and 200 characters.");
    }
    patch.title = trimmed;
  }
  if (body.content !== undefined) {
    if (typeof body.content !== "string") {
      return E_BAD_REQUEST("content must be a string.");
    }
    const trimmed = body.content.trim();
    if (trimmed.length < 1 || trimmed.length > 8000) {
      return E_BAD_REQUEST("content must be between 1 and 8000 characters.");
    }
    patch.content = trimmed;
  }
  if (body.relevance !== undefined) {
    if (
      typeof body.relevance !== "number" ||
      !Number.isFinite(body.relevance)
    ) {
      return E_BAD_REQUEST("relevance must be a finite number.");
    }
    if (body.relevance < 0 || body.relevance > 10) {
      return E_BAD_REQUEST("relevance must be between 0 and 10.");
    }
    patch.relevance = body.relevance;
  }

  try {
    const memory = await updateMemory(supabase, id, patch);
    return apiOk({ memory });
  } catch (err) {
    console.error("[agent memories PUT] failed", {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to update agent memory.");
  }
});

export const DELETE = withApiHandler(async (_request: NextRequest, { params }: RouteParams) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED("Valid session required.");
  }

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return E_NOT_FOUND("memory not found");
  }

  try {
    await deleteMemory(supabase, id);
    return apiOk({ deleted: true });
  } catch (err) {
    console.error("[agent memories DELETE] failed", {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to delete agent memory.");
  }
});
