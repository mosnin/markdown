import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  deletePersona,
  updatePersona,
  type UpdatePersonaPatch,
} from "@/server/services/agent_personas_service";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * PUT /api/agent/personas/[id]
 * DELETE /api/agent/personas/[id]
 *
 * Mutate a persona row. The service refuses system-seeded rows with a
 * `Cannot edit|delete system persona` error; we map that to 403. RLS
 * gates ownership so cross-workspace edits raise as Postgres errors.
 */

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SLUG_RE = /^[a-z0-9_-]{2,40}$/;

interface RouteParams {
  params: Promise<Record<string, string>>;
}

interface UpdatePersonaBody {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  system_prompt?: unknown;
  tool_allowlist?: unknown;
  model?: unknown;
  max_turns?: unknown;
  requires_approval?: unknown;
  plan_first?: unknown;
  must_cite_per_claim?: unknown;
}

function isSystemRowError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /system persona/i.test(err.message);
}

function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /persona not found/i.test(err.message);
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
    return E_NOT_FOUND("persona not found");
  }

  let body: UpdatePersonaBody;
  try {
    body = (await request.json()) as UpdatePersonaBody;
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON.");
  }

  const patch: UpdatePersonaPatch = {};

  if (body.slug !== undefined) {
    if (typeof body.slug !== "string" || !SLUG_RE.test(body.slug)) {
      return E_BAD_REQUEST("slug must match ^[a-z0-9_-]{2,40}$.");
    }
    patch.slug = body.slug;
  }
  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return E_BAD_REQUEST("name must be a string.");
    }
    const trimmed = body.name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      return E_BAD_REQUEST("name must be between 1 and 80 characters.");
    }
    patch.name = trimmed;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      return E_BAD_REQUEST("description must be a string or null.");
    }
    patch.description = body.description;
  }
  if (body.system_prompt !== undefined) {
    if (body.system_prompt !== null && typeof body.system_prompt !== "string") {
      return E_BAD_REQUEST("system_prompt must be a string or null.");
    }
    patch.systemPrompt = body.system_prompt;
  }
  if (body.tool_allowlist !== undefined) {
    if (
      !Array.isArray(body.tool_allowlist) ||
      !body.tool_allowlist.every((t): t is string => typeof t === "string")
    ) {
      return E_BAD_REQUEST("tool_allowlist must be an array of strings.");
    }
    patch.toolAllowlist = body.tool_allowlist;
  }
  if (body.model !== undefined) {
    if (body.model !== null && typeof body.model !== "string") {
      return E_BAD_REQUEST("model must be a string or null.");
    }
    patch.model = body.model;
  }
  if (body.max_turns !== undefined) {
    if (body.max_turns !== null) {
      if (
        typeof body.max_turns !== "number" ||
        !Number.isInteger(body.max_turns)
      ) {
        return E_BAD_REQUEST("max_turns must be an integer or null.");
      }
      if (body.max_turns < 1 || body.max_turns > 200) {
        return E_BAD_REQUEST("max_turns must be between 1 and 200 or null.");
      }
    }
    patch.maxTurns = body.max_turns as number | null;
  }
  if (body.requires_approval !== undefined) {
    if (typeof body.requires_approval !== "boolean") {
      return E_BAD_REQUEST("requires_approval must be a boolean.");
    }
    patch.requiresApproval = body.requires_approval;
  }
  if (body.plan_first !== undefined) {
    if (typeof body.plan_first !== "boolean") {
      return E_BAD_REQUEST("plan_first must be a boolean.");
    }
    patch.planFirst = body.plan_first;
  }
  if (body.must_cite_per_claim !== undefined) {
    if (typeof body.must_cite_per_claim !== "boolean") {
      return E_BAD_REQUEST("must_cite_per_claim must be a boolean.");
    }
    patch.mustCitePerClaim = body.must_cite_per_claim;
  }

  try {
    const persona = await updatePersona(supabase, id, patch);
    return apiOk({ persona });
  } catch (err) {
    if (isSystemRowError(err)) {
      return apiError(
        "forbidden",
        "System personas cannot be edited.",
        403
      );
    }
    if (isNotFoundError(err)) {
      return E_NOT_FOUND("persona not found");
    }
    console.error("[agent personas PUT] failed", {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to update agent persona.");
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
    return E_NOT_FOUND("persona not found");
  }

  try {
    await deletePersona(supabase, id);
    return apiOk({ deleted: true });
  } catch (err) {
    if (isSystemRowError(err)) {
      return apiError(
        "forbidden",
        "System personas cannot be deleted.",
        403
      );
    }
    if (isNotFoundError(err)) {
      return E_NOT_FOUND("persona not found");
    }
    console.error("[agent personas DELETE] failed", {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to delete agent persona.");
  }
});
