import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  createPersona,
  listPersonasForWorkspace,
  type CreatePersonaInput,
} from "@/server/services/agent_personas_service";

/**
 * GET /api/agent/personas?workspace_id=...
 *
 * List personas visible to a workspace — workspace-authored rows plus
 * every global/system persona. Ordering puts workspace overrides before
 * globals so the UI can surface them in picker order.
 *
 * POST /api/agent/personas
 *
 * Create a workspace-scoped persona. The DB's INSERT policy gates this
 * on `can_admin_workspace`; a non-admin caller hits a Postgres error
 * that we surface as 500.
 */

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SLUG_RE = /^[a-z0-9_-]{2,40}$/;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED("Valid session required.");
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace_id");
  if (!workspaceId) {
    return E_BAD_REQUEST("workspace_id query parameter is required.");
  }
  if (!UUID_RE.test(workspaceId)) {
    return E_BAD_REQUEST("workspace_id must be a valid UUID.");
  }

  try {
    const personas = await listPersonasForWorkspace(supabase, workspaceId);
    return apiOk({ personas });
  } catch (err) {
    console.error("[agent personas GET] failed", {
      workspace_id: workspaceId,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to list agent personas.");
  }
}

interface CreatePersonaBody {
  workspace_id?: unknown;
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

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED("Valid session required.");
  }

  let body: CreatePersonaBody;
  try {
    body = (await request.json()) as CreatePersonaBody;
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON.");
  }

  if (typeof body.workspace_id !== "string" || !UUID_RE.test(body.workspace_id)) {
    return E_BAD_REQUEST("workspace_id must be a valid UUID.");
  }
  if (typeof body.slug !== "string" || !SLUG_RE.test(body.slug)) {
    return E_BAD_REQUEST(
      "slug must match ^[a-z0-9_-]{2,40}$."
    );
  }
  if (typeof body.name !== "string") {
    return E_BAD_REQUEST("name must be a string.");
  }
  const trimmedName = body.name.trim();
  if (trimmedName.length < 1 || trimmedName.length > 80) {
    return E_BAD_REQUEST("name must be between 1 and 80 characters.");
  }

  // tool_allowlist is required by the service type; default to [] when
  // the caller omits it to keep the API friendly for "allow nothing extra"
  // personas that rely on the built-in defaults.
  let toolAllowlist: string[] = [];
  if (body.tool_allowlist !== undefined) {
    if (
      !Array.isArray(body.tool_allowlist) ||
      !body.tool_allowlist.every((t): t is string => typeof t === "string")
    ) {
      return E_BAD_REQUEST("tool_allowlist must be an array of strings.");
    }
    toolAllowlist = body.tool_allowlist;
  }

  const input: CreatePersonaInput = {
    workspaceId: body.workspace_id,
    slug: body.slug,
    name: trimmedName,
    toolAllowlist,
  };

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      return E_BAD_REQUEST("description must be a string or null.");
    }
    input.description = body.description;
  }
  if (body.system_prompt !== undefined) {
    if (body.system_prompt !== null && typeof body.system_prompt !== "string") {
      return E_BAD_REQUEST("system_prompt must be a string or null.");
    }
    input.systemPrompt = body.system_prompt;
  }
  if (body.model !== undefined) {
    if (body.model !== null && typeof body.model !== "string") {
      return E_BAD_REQUEST("model must be a string or null.");
    }
    input.model = body.model;
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
    input.maxTurns = body.max_turns as number | null;
  }
  if (body.requires_approval !== undefined) {
    if (typeof body.requires_approval !== "boolean") {
      return E_BAD_REQUEST("requires_approval must be a boolean.");
    }
    input.requiresApproval = body.requires_approval;
  }
  if (body.plan_first !== undefined) {
    if (typeof body.plan_first !== "boolean") {
      return E_BAD_REQUEST("plan_first must be a boolean.");
    }
    input.planFirst = body.plan_first;
  }
  if (body.must_cite_per_claim !== undefined) {
    if (typeof body.must_cite_per_claim !== "boolean") {
      return E_BAD_REQUEST("must_cite_per_claim must be a boolean.");
    }
    input.mustCitePerClaim = body.must_cite_per_claim;
  }

  try {
    const persona = await createPersona(supabase, input);
    return apiOk({ persona }, 201);
  } catch (err) {
    console.error("[agent personas POST] failed", {
      workspace_id: body.workspace_id,
      slug: body.slug,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to create agent persona.");
  }
}
