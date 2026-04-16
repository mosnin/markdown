import { type NextRequest, NextResponse } from "next/server";
import {
  resolveMcpRequestAuth,
  requireScope,
  requireWrite,
  requireNoBranchTargeting,
  toConnectionRequestContext,
  BranchTargetingNotAllowedError,
} from "@/server/auth/mcp_auth_adapter";
import { createAdminClient } from "@/lib/supabase/admin";
import { createGeneratedNote } from "@/server/services/generated_note_service";
import { auditMcp } from "@/server/services/audit_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_RATE_LIMITED,
  E_INSUFFICIENT_SCOPE,
  E_FORBIDDEN_ROLE,
  E_BRANCH_TARGETING_NOT_ALLOWED,
} from "@/lib/api/response";
import { PERMISSION_MODE } from "@/server/domain/constants/connection_constants";
import { apiWriteLimit } from "@/lib/api/rate_limit";

/**
 * POST /api/v1/generated_notes
 *
 * Creates a generated note directly in a folder.
 *
 * Auth: OAuth access token with `context:generate` scope and a non-
 * viewer workspace role. For legacy csk_v1_ contexts, the
 * permission_mode must be generate_in_allowed_folders (the scope
 * gate short-circuits true).
 *
 * Branch targeting: OAuth-backed writes target main only; a
 * `branch_id` in the body is rejected with 400.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:generate")) {
    return E_INSUFFICIENT_SCOPE("context:generate");
  }
  if (!requireWrite(ctx)) {
    return E_FORBIDDEN_ROLE("Viewer role cannot create generated notes");
  }

  // Rate limit per connection/token (20 writes/min)
  const rl = apiWriteLimit(ctx.connectionId);
  if (!rl.allowed) return E_RATE_LIMITED(rl.retryAfter);

  if (ctx.permissionMode !== PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS) {
    return E_FORBIDDEN(
      "Connection must have generate_in_allowed_folders permission to create generated notes"
    );
  }

  // Defense-in-depth 1MB payload cap. Next.js caps body parsing but an
  // explicit Content-Length check gives clients a clear 413 before the
  // body is buffered.
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json(
      { error: "payload_too_large" },
      { status: 413 }
    );
  }

  let body: {
    folder_id?: string;
    title?: string;
    markdown_content?: string;
    summary?: string;
    tags?: string[];
    read_hint?: string;
    retrieval_priority?: number;
    branch_id?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  try {
    requireNoBranchTargeting(ctx, body.branch_id ?? null);
  } catch (err) {
    if (err instanceof BranchTargetingNotAllowedError) {
      return E_BRANCH_TARGETING_NOT_ALLOWED();
    }
    throw err;
  }

  const { folder_id } = body;
  if (!folder_id) return E_BAD_REQUEST("folder_id is required");

  // Field size guards
  if (body.title && body.title.length > 500) {
    return E_BAD_REQUEST("title must not exceed 500 characters");
  }
  if (body.markdown_content && body.markdown_content.length > 500_000) {
    return E_BAD_REQUEST("markdown_content must not exceed 500,000 characters");
  }
  if (body.summary && body.summary.length > 2000) {
    return E_BAD_REQUEST("summary must not exceed 2000 characters");
  }
  if (Array.isArray(body.tags)) {
    if (!body.tags.every((t) => typeof t === "string")) {
      return E_BAD_REQUEST("tags must be an array of strings");
    }
    if (body.tags.length > 50) {
      return E_BAD_REQUEST("tags must not exceed 50 tags");
    }
    if (body.tags.some((t: string) => t.length > 100)) {
      return E_BAD_REQUEST("Each tag must not exceed 100 characters");
    }
  }

  if (
    body.retrieval_priority !== undefined &&
    (typeof body.retrieval_priority !== "number" ||
      body.retrieval_priority < 0 ||
      body.retrieval_priority > 10)
  ) {
    return E_BAD_REQUEST("retrieval_priority must be a number between 0 and 10");
  }

  const adminClient = createAdminClient();
  const bridge = toConnectionRequestContext(ctx);

  try {
    const result = await createGeneratedNote(adminClient, bridge, {
      folder_id,
      title: body.title ?? null,
      markdown_content: body.markdown_content ?? null,
      summary: body.summary ?? null,
      tags: Array.isArray(body.tags) ? body.tags : null,
      read_hint: body.read_hint ?? null,
      retrieval_priority: body.retrieval_priority,
    });

    // User-attributed MCP audit event — complements the service's
    // existing connection-attributed `note.generated` event.
    if (ctx.source === "oauth" && ctx.userId) {
      auditMcp(adminClient, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        clientId: ctx.clientId,
        connectionId: ctx.connectionId,
        source: ctx.source,
        objectType: "note",
        objectId: result.note.id,
        eventType: "mcp.note.generated",
        metadata: {
          box_id: result.note.box_id,
          folder_id: result.note.folder_id,
          title: result.note.title,
        },
      });
    }

    return apiOk(
      {
        note: {
          id: result.note.id,
          box_id: result.note.box_id,
          folder_id: result.note.folder_id,
          title: result.note.title,
          slug: result.note.slug,
          path_cache: result.note.path_cache,
          summary: result.note.summary,
          tags: result.note.tags,
          read_hint: result.note.read_hint,
          kind: result.note.kind,
          status: result.note.status,
          origin_type: result.note.origin_type,
          is_generated: result.note.is_generated,
          generated_by_connection_id: result.note.generated_by_connection_id,
          created_at: result.note.created_at,
          updated_at: result.note.updated_at,
        },
        version_id: result.version.id,
      },
      201
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) {
      return E_NOT_FOUND("The requested resource was not found");
    }
    if (
      msg.includes("permission") ||
      msg.includes("not in an allowed box") ||
      msg.includes("accepts_generated_notes")
    ) {
      return E_FORBIDDEN("Connection does not have access to this resource");
    }
    if (msg.includes("required")) {
      return E_BAD_REQUEST(msg);
    }
    console.error("[generated_notes] Unexpected error:", err);
    return E_INTERNAL();
  }
}
