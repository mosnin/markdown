import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createGeneratedNote } from "@/server/services/generated_note_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_RATE_LIMITED,
} from "@/lib/api/response";
import { PERMISSION_MODE } from "@/server/domain/constants/connection_constants";
import { apiWriteLimit } from "@/lib/api/rate_limit";

/**
 * POST /api/v1/generated_notes
 *
 * Creates a generated note directly in a folder.
 * Allowed only for connections with permission_mode = generate_in_allowed_folders.
 *
 * The folder must:
 *   - belong to a box in the connection's scope
 *   - have accepts_generated_notes = true
 *
 * Request body:
 *   {
 *     folder_id:          string,   // required
 *     title?:             string,
 *     markdown_content?:  string,
 *     summary?:           string,
 *     proposed_tags?:     string[],
 *     read_hint?:         string,
 *     retrieval_priority?: number
 *   }
 *
 * Response: { note: NoteDetail, version_id: string }
 */
export async function POST(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  // Rate limit per connection (20 writes/min)
  const rl = apiWriteLimit(ctx.connection.id);
  if (!rl.allowed) return E_RATE_LIMITED(rl.retryAfter);

  if (ctx.connection.permission_mode !== PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS) {
    return E_FORBIDDEN(
      "Connection must have generate_in_allowed_folders permission to create generated notes"
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
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const oauthMainOnlyBranchAttempt =
    ctx.connection.metadata?.auth_source === "oauth" &&
    (Object.prototype.hasOwnProperty.call(body, "branch_id") ||
      Object.prototype.hasOwnProperty.call(body, "target_branch_id"));
  if (oauthMainOnlyBranchAttempt) {
    return E_BAD_REQUEST(
      "OAuth-backed writes are main-only in this version. Branch targeting is not supported for OAuth requests."
    );
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

  try {
    const result = await createGeneratedNote(adminClient, ctx, {
      folder_id,
      title: body.title ?? null,
      markdown_content: body.markdown_content ?? null,
      summary: body.summary ?? null,
      tags: Array.isArray(body.tags) ? body.tags : null,
      read_hint: body.read_hint ?? null,
      retrieval_priority: body.retrieval_priority,
    });

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
