import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLink } from "@/server/services/object_link_service";
import {
  RELATIONSHIP_TYPE,
  type RelationshipType,
} from "@/server/domain/constants/note_constants";
import {
  apiOk,
  apiError,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_FORBIDDEN,
} from "@/lib/api/response";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

const VALID_RELATIONSHIPS = new Set<string>(Object.values(RELATIONSHIP_TYPE));

/**
 * POST /api/agent/tools/link_notes
 *
 * Internal endpoint invoked by the Workspace Operator. Creates a typed
 * `object_link` between two notes, scoped to the envelope's branch (so
 * the link only appears on main once the user promotes the branch).
 *
 * Body:
 *   - source_note_id: string (required)
 *   - target_note_id: string (required)
 *   - relationship_type: RelationshipType (required)
 *   - relationship_note?: string | null
 *
 * Returns: { link_id, source_note_id, target_note_id, relationship_type, branch_id }
 */
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
        return E_BAD_REQUEST(`Missing required header: ${auth.failure.field}`);
      case "invalid_envelope":
        return E_BAD_REQUEST(
          `Invalid ${auth.failure.field}: ${auth.failure.reason}`
        );
    }
  }
  const { ctx } = auth;

  if (!ctx.branchId) {
    return E_FORBIDDEN(
      "Workspace Operator writes require a branch_id envelope header — links must be branch-scoped"
    );
  }

  let body: {
    source_note_id?: string;
    target_note_id?: string;
    relationship_type?: string;
    relationship_note?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const {
    source_note_id,
    target_note_id,
    relationship_type,
    relationship_note,
  } = body;

  if (typeof source_note_id !== "string" || !source_note_id.trim()) {
    return E_BAD_REQUEST("source_note_id is required");
  }
  if (typeof target_note_id !== "string" || !target_note_id.trim()) {
    return E_BAD_REQUEST("target_note_id is required");
  }
  if (typeof relationship_type !== "string" || !relationship_type.trim()) {
    return E_BAD_REQUEST("relationship_type is required");
  }
  if (!VALID_RELATIONSHIPS.has(relationship_type)) {
    return E_BAD_REQUEST(
      `relationship_type must be one of: ${[...VALID_RELATIONSHIPS].join(", ")}`
    );
  }
  if (
    relationship_note !== undefined &&
    relationship_note !== null &&
    typeof relationship_note !== "string"
  ) {
    return E_BAD_REQUEST("relationship_note must be a string when provided");
  }

  const admin = createAdminClient();

  try {
    const link = await createLink(admin, ctx.workspaceId, {
      sourceObjectType: "note",
      sourceObjectId: source_note_id,
      targetObjectType: "note",
      targetObjectId: target_note_id,
      relationshipType: relationship_type as RelationshipType,
      relationshipNote: relationship_note ?? null,
      branchId: ctx.branchId,
    });

    return apiOk({
      run_id: ctx.runId,
      link_id: link.id,
      source_note_id: link.source_object_id,
      target_note_id: link.target_object_id,
      relationship_type: link.relationship_type,
      branch_id: ctx.branchId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[agent_tools_link_notes] createLink failed", err);
    if (
      message.includes("Self-links") ||
      message.includes("not found in workspace")
    ) {
      return apiError("invalid_link", message, 400);
    }
    return E_INTERNAL();
  }
}
