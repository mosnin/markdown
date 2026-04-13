/**
 * File service.
 *
 * Create and update operations go through Postgres RPC functions
 * (create_object_with_initial_version / update_object_and_create_version)
 * to ensure file content and version snapshots are written atomically.
 *
 * The workspace_objects registry is kept in sync on every mutation.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { type File } from "@/server/domain/types/file";
import { type ObjectVersion } from "@/server/domain/types/object_version";
import { slugify } from "@/lib/slugify";
import { getFolderById } from "@/server/repositories/folder_repository";
import { OBJECT_TYPE, OBJECT_STATUS, OBJECT_ORIGIN_TYPE, type SourceFormat } from "@/server/domain/constants/object_constants";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ObjectRpcResult {
  object: File;
  version: ObjectVersion;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Write an audit event for a file operation, swallowing errors. */
async function writeFileAudit(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  fileId: string,
  eventType: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await createAuditEvent(supabase, {
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: actorId,
      object_type: "file",
      object_id: fileId,
      event_type: eventType,
      metadata: metadata ?? null,
    });
  } catch (err) {
    console.error(`[audit] Failed to write ${eventType} for file/${fileId}`, err);
  }
}

/** Check whether a path_cache is already taken in a box (excluding trashed files). */
async function pathCacheExistsInFiles(
  supabase: SupabaseClient,
  boxId: string,
  pathCache: string
): Promise<boolean> {
  const { data } = await supabase
    .from("files")
    .select("id")
    .eq("box_id", boxId)
    .eq("path_cache", pathCache)
    .neq("status", OBJECT_STATUS.TRASHED)
    .maybeSingle();
  return !!data;
}

/** Check whether a path_cache is already taken for workspace-level files. */
async function pathCacheExistsInWorkspaceFiles(
  supabase: SupabaseClient,
  workspaceId: string,
  pathCache: string
): Promise<boolean> {
  const { data } = await supabase
    .from("files")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("box_id", null)
    .eq("path_cache", pathCache)
    .neq("status", OBJECT_STATUS.TRASHED)
    .maybeSingle();
  return !!data;
}

/** Build path_cache from folder (if any) + slug. */
async function buildPathCache(
  supabase: SupabaseClient,
  folderId: string | null | undefined,
  slug: string
): Promise<string> {
  if (!folderId) return slug;
  const folder = await getFolderById(supabase, folderId);
  if (!folder) throw new Error(`Folder not found: ${folderId}`);
  return `${folder.path_cache}/${slug}`;
}

/** Generate a unique slug/path_cache for a file in a given box+folder. */
async function uniqueFileSlug(
  supabase: SupabaseClient,
  workspaceId: string,
  boxId: string | null | undefined,
  folderId: string | null | undefined,
  name: string
): Promise<{ slug: string; pathCache: string }> {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  let pathCache = await buildPathCache(supabase, folderId, slug);

  // Box-local files enforce uniqueness by box+path_cache.
  // Workspace-level files (box_id NULL) enforce uniqueness by workspace+path_cache.
  while (
    boxId
      ? await pathCacheExistsInFiles(supabase, boxId, pathCache)
      : await pathCacheExistsInWorkspaceFiles(supabase, workspaceId, pathCache)
  ) {
    slug = `${base}-${suffix++}`;
    pathCache = await buildPathCache(supabase, folderId, slug);
  }

  return { slug, pathCache };
}

/** Verify a file belongs to the given workspace via its box. */
async function verifyFileWorkspaceOwnership(
  supabase: SupabaseClient,
  file: File,
  workspaceId: string
): Promise<void> {
  if (!file.box_id) {
    // Reusable / workspace-level file — check workspace_id directly
    if (file.workspace_id !== workspaceId) {
      throw new Error("File does not belong to the specified workspace");
    }
    return;
  }
  const { data: box } = await supabase
    .from("boxes")
    .select("workspace_id")
    .eq("id", file.box_id)
    .single();
  if (!box || box.workspace_id !== workspaceId) {
    throw new Error("File does not belong to the specified workspace");
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listFiles(
  supabase: SupabaseClient,
  boxId: string
): Promise<File[]> {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("box_id", boxId)
    .neq("status", OBJECT_STATUS.TRASHED)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data as File[];
}

/**
 * Fetch a file, verifying it belongs to the given workspace via its box.
 * Returns null if not found or not owned.
 *
 * When `branchId` is provided AND a branch head exists for this
 * file, the returned File's `source_content`, `content_bytes`, and
 * `current_version_id` are patched to reflect the branch-head
 * version. Non-versioned fields (name, description, tags, status,
 * is_reusable, etc.) still come from the canonical `files` row.
 * This mirrors the Notes branch-read contract exactly.
 */
export async function getFileForWorkspace(
  supabase: SupabaseClient,
  fileId: string,
  workspaceId: string,
  branchId: string | null = null
): Promise<File | null> {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", fileId)
    .single();

  if (error || !data) return null;
  const file = data as File;

  try {
    await verifyFileWorkspaceOwnership(supabase, file, workspaceId);
  } catch {
    return null;
  }

  if (branchId) {
    const { resolveBranchObjectVersion } = await import("./object_branch_service");
    const branchVer = await resolveBranchObjectVersion(supabase, branchId, "file", fileId);
    if (branchVer) {
      return {
        ...file,
        source_content: branchVer.source_content,
        content_bytes: branchVer.content_bytes,
        current_version_id: branchVer.id,
      } as File;
    }
  }

  return file;
}

/**
 * Branch-aware write for a file's canonical source content. Thin
 * wrapper around the shared `updateObjectContentOnBranch` helper so
 * every File call site routes through one consistent path.
 */
export async function updateFileContentOnBranch(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  branchId: string,
  fileId: string,
  sourceContent: string
) {
  const { updateObjectContentOnBranch } = await import("./object_branch_service");
  return updateObjectContentOnBranch(
    supabase, userId, workspaceId, branchId, "file", fileId, { sourceContent }
  );
}

/**
 * Create a file and its initial version atomically via RPC.
 * Registers the file in workspace_objects.
 * Returns the created File.
 */
export async function createFile(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  params: {
    boxId?: string | null;
    folderId?: string | null;
    name: string;
    sourceContent: string;
    canonicalFormat: SourceFormat;
    sourceLanguage?: string | null;
    fileExtension?: string | null;
    mimeType?: string | null;
    description?: string | null;
    tags?: string[];
    summary?: string | null;
  }
): Promise<File> {
  const {
    boxId,
    folderId,
    name,
    sourceContent,
    canonicalFormat,
    sourceLanguage,
    fileExtension,
    mimeType,
    description,
    tags = [],
    summary,
  } = params;

  const { slug, pathCache } = await uniqueFileSlug(supabase, workspaceId, boxId, folderId, name);
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");

  const { data, error } = await supabase.rpc("create_object_with_initial_version", {
    p_object_type: OBJECT_TYPE.FILE,
    p_workspace_id: workspaceId,
    p_box_id: boxId,
    p_folder_id: folderId ?? null,
    p_name: name,
    p_slug: slug,
    p_path_cache: pathCache,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_canonical_format: canonicalFormat,
    p_source_language: sourceLanguage ?? null,
    p_file_extension: fileExtension ?? null,
    p_mime_type: mimeType ?? null,
    p_description: description ?? null,
    p_tags: tags,
    p_summary: summary ?? null,
    p_origin_type: OBJECT_ORIGIN_TYPE.USER_CREATED,
    p_actor_id: userId,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create file");
  }

  const result = data as ObjectRpcResult;
  const file = result.object;

  // Register in workspace_objects
  const { error: regError } = await supabase
    .from("workspace_objects")
    .insert({
      workspace_id: workspaceId,
      box_id: boxId,
      folder_id: folderId ?? null,
      object_type: OBJECT_TYPE.FILE,
      object_id: file.id,
      display_name: name,
      status: OBJECT_STATUS.ACTIVE,
      is_reusable: false,
      sort_order: Date.now(),
    });

  if (regError) {
    console.error("[file_service] Failed to register workspace object for file", file.id, regError);
  }

  await writeFileAudit(supabase, workspaceId, userId, file.id, "file.created", {
    name,
    box_id: boxId,
    folder_id: folderId ?? null,
  });

  return file;
}

/**
 * Update a file's content and metadata, creating a new version atomically via RPC.
 * Returns the updated File.
 */
/**
 * Create a file whose existence is scoped to a draft branch.
 *
 * Shape: call the normal `createFile` path first (which runs the
 * atomic RPC + workspace_objects + audit), then stamp `branch_id`
 * on the resulting row. Until promote, main-scoped readers filter
 * out rows with `branch_id IS NOT NULL`; branch readers union main
 * with rows where `branch_id = <active branch>`.
 *
 * Discard of the owning branch hard-deletes these rows because they
 * never reached main and have no audit history to preserve. See
 * `docs/branch_local_structural_creation_v1.md`.
 *
 * This is the only supported way for the UI to add a child file to
 * a Skill / Agent package while a branch is active. The normal
 * `createFile` path remains main-only.
 */
export async function createFileOnBranch(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  branchId: string,
  params: Parameters<typeof createFile>[3]
): Promise<File> {
  // Re-validate the branch is open and belongs to this workspace
  // up-front so we never write a file pointing at a stale branch.
  const { data: branch } = await supabase
    .from("draft_branches")
    .select("id, workspace_id, status")
    .eq("id", branchId)
    .maybeSingle();
  if (!branch || branch.workspace_id !== workspaceId || branch.status !== "open") {
    throw new Error("Branch not found or not open");
  }

  const file = await createFile(supabase, userId, workspaceId, params);

  // Stamp branch_id. We also mirror the column onto workspace_objects
  // so tree / navigation filters that read the registry can scope
  // branch-local rows just as cheaply as the files table.
  await supabase
    .from("files")
    .update({ branch_id: branchId })
    .eq("id", file.id);

  // Distinct audit event: "file.branch_created" — separate from
  // "file.created" so the Audit Log makes branch-scoped structural
  // creation easy to filter.
  const { createAuditEvent } = await import(
    "@/server/repositories/audit_event_repository"
  );
  await createAuditEvent(supabase, {
    workspace_id: workspaceId,
    actor_type: "user",
    actor_id: userId,
    object_type: "file",
    object_id: file.id,
    event_type: "file.branch_created",
    metadata: {
      branch_id: branchId,
      box_id: file.box_id,
      parent_skill_id: file.parent_skill_id ?? null,
      parent_agent_id: file.parent_agent_id ?? null,
    },
  });

  return { ...file, branch_id: branchId } as File;
}

export async function updateFileContent(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  fileId: string,
  params: {
    sourceContent: string;
    description?: string | null;
    tags?: string[];
    summary?: string | null;
  }
): Promise<File> {
  const existing = await getFileForWorkspace(supabase, fileId, workspaceId);
  if (!existing) {
    throw new Error(`File not found or not accessible: ${fileId}`);
  }

  const { sourceContent, description, tags, summary } = params;
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");

  const { data, error } = await supabase.rpc("update_object_and_create_version", {
    p_object_type: OBJECT_TYPE.FILE,
    p_object_id: fileId,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_description: description !== undefined ? description : existing.description,
    p_tags: tags !== undefined ? tags : existing.tags,
    p_summary: summary !== undefined ? summary : existing.summary,
    p_actor_id: userId,
    p_change_origin: "human_edit",
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update file");
  }

  const result = data as ObjectRpcResult;
  const updatedFile = result.object;

  // Sync display_name in workspace_objects if name changed
  const { error: syncError } = await supabase
    .from("workspace_objects")
    .update({ display_name: updatedFile.name, updated_at: new Date().toISOString() })
    .eq("object_type", OBJECT_TYPE.FILE)
    .eq("object_id", fileId);

  if (syncError) {
    console.error("[file_service] Failed to sync workspace_objects display_name for file", fileId, syncError);
  }

  await writeFileAudit(supabase, workspaceId, userId, fileId, "file.updated", {
    name: updatedFile.name,
    box_id: existing.box_id,
  });

  return updatedFile;
}
