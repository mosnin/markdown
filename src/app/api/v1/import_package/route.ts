import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { importPackage } from "@/server/services/import_service";
import { auditImportCompleted } from "@/server/services/audit_service";
import { type CollisionMode } from "@/server/domain/types/import_export";
import { log } from "@/lib/logger";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_RATE_LIMITED,
} from "@/lib/api/response";
import { importExportLimit } from "@/lib/api/rate_limit";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * POST /api/v1/import_package
 *
 * Imports a .md or .zip package into an owned box.
 *
 * ─── Authentication ──────────────────────────────────────────────────────────
 *
 * This endpoint requires a human session (Supabase SSR cookie auth via
 * getRequestContext). External bearer token connections are NOT supported for
 * import in V1.
 *
 * Rationale: Import creates content from an external untrusted package,
 * potentially at scale (up to 1,000 objects). Allowing external connections to
 * import would let any connection with box-scope access flood a workspace with
 * arbitrary content without human review. The existing connection permission
 * modes (read_only, propose_writes, generate_in_allowed_folders) do not
 * naturally extend to bulk package import, and adding a new permission mode
 * for import is not in scope for V1.
 *
 * Human-initiated import keeps this operation explicitly deliberate.
 *
 * ─── Request ─────────────────────────────────────────────────────────────────
 *
 * Content-Type: multipart/form-data
 *
 * Fields:
 *   file              File     Required. A .md or .zip file (max 25 MB).
 *   box_id            string   Required. UUID of the target box (must be owned by
 *                              the authenticated workspace).
 *   collision_mode    string   Required. One of:
 *                                create_copy         — new ids, -copy suffix on slug collision
 *                                replace_by_id       — update in place by matching id
 *                                merge_metadata_only — merge summary/tags/read_hint only
 *                                remap_ids_and_import — generate new ids for all collisions
 *   target_folder_id  string   Optional. UUID of a folder within the box to import into.
 *                              Must belong to the target box.
 *
 * ─── Package formats ─────────────────────────────────────────────────────────
 *
 * .md file
 *   A single markdown file. Imported as one note. Title is taken from the
 *   first H1 heading or the filename.
 *
 * .zip without manifest.json
 *   Each .md file in the zip becomes one note. Folder structure is not inferred.
 *
 * .zip with manifest.json
 *   The manifest drives folder, note, and link creation. Collision mode applies.
 *   Canonical relationship_type values are validated; non-canonical links are
 *   skipped with a warning. Non-canonical read_hint values are nulled with a warning.
 *
 * ─── Response ────────────────────────────────────────────────────────────────
 *
 * Success (200):
 *   Standard envelope wrapping an ImportSummaryReport:
 *   {
 *     "data": {
 *       "collision_mode": "create_copy",
 *       "created_counts": { "folders": 2, "notes": 5, "links": 3 },
 *       "replaced_counts": { "notes": 0, "folders": 0 },
 *       "duplicated_counts": { "notes": 0, "folders": 0 },
 *       "remapped_counts": { "notes": 0, "folders": 0 },
 *       "skipped_counts": { "notes": 0, "folders": 0, "links": 0 },
 *       "actions": [...],
 *       "warnings": [...]
 *     },
 *     "meta": { "request_id": "...", "api_version": "v1" }
 *   }
 *
 * ─── Hard failures ───────────────────────────────────────────────────────────
 *
 * Malformed zip, invalid manifest schema, unsupported collision mode, or
 * package size > 25 MB produce a 400 with a clear message.
 * Object count > 1,000 produces a 400.
 */
export async function POST(request: NextRequest) {
  // Human session auth only — connections are not supported for import in V1.
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    return E_UNAUTHORIZED(
      "Unauthorized — this endpoint requires a human session. " +
        "External connection auth is not supported for import in V1."
    );
  }

  // Rate limit import/export operations per user.
  const rl = await importExportLimit(ctx.user.id);
  if (!rl.allowed) return E_RATE_LIMITED(rl.retryAfter);

  const supabase = await createClient();
  const workspaceId = ctx.workspace.id;
  const userId = ctx.user.id;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return E_BAD_REQUEST(
      "Request must be multipart/form-data with a 'file' field"
    );
  }

  const file = formData.get("file") as File | null;
  const boxId = formData.get("box_id") as string | null;
  const rawCollisionMode = formData.get("collision_mode") as string | null;
  const targetFolderId =
    (formData.get("target_folder_id") as string | null) || null;

  if (!file) return E_BAD_REQUEST("file is required");
  if (!boxId) return E_BAD_REQUEST("box_id is required");
  if (!rawCollisionMode) return E_BAD_REQUEST("collision_mode is required");

  // Enforce size limit before reading into memory
  if (file.size > MAX_UPLOAD_BYTES) {
    return E_BAD_REQUEST(
      `Package too large — maximum size is 25 MB (received ${(file.size / (1024 * 1024)).toFixed(1)} MB)`
    );
  }

  const validModes: CollisionMode[] = [
    "create_copy",
    "replace_by_id",
    "merge_metadata_only",
    "remap_ids_and_import",
  ];
  if (!validModes.includes(rawCollisionMode as CollisionMode)) {
    return E_BAD_REQUEST(
      `collision_mode must be one of: ${validModes.join(", ")}`
    );
  }
  const collisionMode = rawCollisionMode as CollisionMode;

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  try {
    const report = await importPackage(
      supabase,
      workspaceId,
      userId,
      { buffer, filename: file.name },
      { boxId, targetFolderId },
      collisionMode
    );

    await auditImportCompleted(supabase, workspaceId, userId, boxId, {
      collision_mode: collisionMode,
      created_notes: report.created_counts.notes,
      created_folders: report.created_counts.folders,
      created_links: report.created_counts.links,
      warnings: report.warnings.length,
    });

    return apiOk(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    log.error("import_failed", {
      workspace_id: workspaceId,
      box_id: boxId,
      filename: file.name,
      reason: message,
    });
    // Hard failures from the import service (malformed zip, invalid manifest,
    // bounds exceeded) are surfaced as 400 Bad Request with the original message.
    return E_BAD_REQUEST(message);
  }
}
