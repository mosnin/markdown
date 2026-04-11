import { parseZip } from "@/lib/zip";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  type ExportManifest,
  type ManifestNote,
  type ManifestFolder,
  type ManifestLink,
  type ManifestFile,
  type ManifestSkill,
  type ManifestAgent,
  type CollisionMode,
  type ImportSummaryReport,
  type ImportAction,
  type ImportWarning,
} from "@/server/domain/types/import_export";
import { getBoxById, updateBox } from "@/server/repositories/box_repository";
import { getFolderById, createFolder, updateFolder } from "@/server/repositories/folder_repository";
import { getNoteById, updateNote as repoUpdateNote } from "@/server/repositories/note_repository";
import { createNoteLink } from "@/server/repositories/note_link_repository";
import { getLatestVersionForNote, createNoteVersion } from "@/server/repositories/note_version_repository";
import { getFileById } from "@/server/repositories/file_repository";
import { getSkillById } from "@/server/repositories/skill_repository";
import { getAgentById } from "@/server/repositories/agent_repository";
import { slugify } from "@/lib/slugify";
import {
  RELATIONSHIP_TYPE,
  NOTE_READ_HINT,
} from "@/server/domain/constants/note_constants";
import {
  OBJECT_TYPE,
  OBJECT_STATUS,
  OBJECT_ORIGIN_TYPE,
} from "@/server/domain/constants/object_constants";
import { auditGuideNoteAssigned } from "@/server/services/audit_service";

// ─── Canonical vocabulary sets ────────────────────────────────────────────────

const CANONICAL_RELATIONSHIP_TYPES = new Set(Object.values(RELATIONSHIP_TYPE));
const CANONICAL_READ_HINTS = new Set(Object.values(NOTE_READ_HINT));

/**
 * Validate a relationship_type value from an incoming manifest.
 * Returns the value if canonical, null otherwise.
 * Callers should skip the link and add a warning when null is returned.
 */
function validateRelationshipType(value: string): string | null {
  return CANONICAL_RELATIONSHIP_TYPES.has(value as never) ? value : null;
}

/**
 * Sanitize a read_hint value from an incoming manifest.
 * Returns the value if canonical, null otherwise (to avoid DB CHECK violation).
 */
function sanitizeReadHint(value: string | null | undefined): string | null {
  if (!value) return null;
  return CANONICAL_READ_HINTS.has(value as never) ? value : null;
}

/**
 * Import service.
 *
 * Parses incoming .md or .zip packages and applies them to an owned box
 * using the specified collision mode.
 *
 * Ownership is verified before any write. All writes happen inside the
 * caller's authenticated Supabase session.
 *
 * Bounds (hard limits):
 *   - Package size: 25 MB (enforced by the server action before calling here)
 *   - Combined folder + note count: 1000
 *   - Supported files: .md, manifest.json, README.md only (others: warning)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_OBJECT_COUNT = 1000;

// ─── Parsed package ───────────────────────────────────────────────────────────

interface ParsedPackage {
  manifest: ExportManifest | null;
  /** filename → utf-8 content for .md files */
  markdownFiles: Map<string, string>;
  /** filename → utf-8 content for non-.md source files (skills, agents, files) */
  sourceFiles: Map<string, string>;
  warnings: ImportWarning[];
}

// ─── Zip parsing ──────────────────────────────────────────────────────────────

/** File extensions recognized as source content for files/skills/agents. */
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".sh", ".bash",
  ".sql", ".json", ".yaml", ".yml", ".toml", ".xml",
  ".html", ".css", ".txt",
]);

async function parseZipBuffer(buffer: Buffer): Promise<ParsedPackage> {
  let allFiles: Map<string, string>;
  try {
    allFiles = parseZip(buffer);
  } catch (e) {
    throw new Error(`Malformed zip file — cannot parse: ${e instanceof Error ? e.message : String(e)}`);
  }

  const markdownFiles = new Map<string, string>();
  const sourceFiles = new Map<string, string>();
  const warnings: ImportWarning[] = [];
  let manifest: ExportManifest | null = null;

  for (const [path, content] of allFiles) {
    const lower = path.toLowerCase();

    if (lower === "manifest.json" || lower.endsWith("/manifest.json")) {
      try {
        const parsed = JSON.parse(content) as ExportManifest;
        const version = parsed.schema_version;
        if (version !== "1.0" && version !== "1.1") {
          throw new Error(`Unsupported schema_version: ${version}. Expected "1.0" or "1.1".`);
        }
        manifest = parsed;
      } catch (e) {
        throw new Error(`Invalid manifest.json: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (lower === "readme.md" || lower.endsWith("/readme.md")) {
      // README is informational — skip silently
    } else if (lower.endsWith(".md")) {
      markdownFiles.set(path, content);
    } else if (!lower.endsWith("/")) {
      // Check if this is a known source extension
      const dotIdx = lower.lastIndexOf(".");
      const ext = dotIdx >= 0 ? lower.slice(dotIdx) : "";
      if (SOURCE_EXTENSIONS.has(ext)) {
        sourceFiles.set(path, content);
      } else {
        warnings.push({
          code: "unsupported_file_type",
          message: `File ignored — unrecognized extension "${ext}". Supported: .md, .ts, .js, .py, .sh, .sql, .json, .yaml, .yml, .toml, .xml, .html, .css, .txt`,
          subject: path,
        });
      }
    }
  }

  return { manifest, markdownFiles, sourceFiles, warnings };
}

function parseSingleMarkdown(content: string, filename: string): ParsedPackage {
  const markdownFiles = new Map([[filename, content]]);
  return { manifest: null, markdownFiles, sourceFiles: new Map(), warnings: [] };
}

// ─── Slug uniqueness helpers ──────────────────────────────────────────────────

/** Check if a path_cache is already in use (among non-trashed notes). */
async function notePathExists(
  supabase: SupabaseClient,
  boxId: string,
  pathCache: string
): Promise<boolean> {
  const { data } = await supabase
    .from("notes")
    .select("id")
    .eq("box_id", boxId)
    .eq("path_cache", pathCache)
    .neq("status", "trashed")
    .maybeSingle();
  return !!data;
}

/** Generate a unique path for a note, appending -copy, -copy-2, etc. */
async function uniqueNotePath(
  supabase: SupabaseClient,
  boxId: string,
  basePath: string
): Promise<{ slug: string; pathCache: string }> {
  const parts = basePath.split("/");
  const baseSlug = parts[parts.length - 1];
  const prefix = parts.slice(0, -1).join("/");

  let slug = `${baseSlug}-copy`;
  let pathCache = prefix ? `${prefix}/${slug}` : slug;
  let suffix = 2;

  while (await notePathExists(supabase, boxId, pathCache)) {
    slug = `${baseSlug}-copy-${suffix++}`;
    pathCache = prefix ? `${prefix}/${slug}` : slug;
  }

  return { slug, pathCache };
}

// ─── RPC helpers for note create/update ──────────────────────────────────────

async function rpcCreateNote(
  supabase: SupabaseClient,
  {
    boxId,
    folderId,
    title,
    slug,
    pathCache,
    markdownContent,
    summary,
    tags,
    readHint,
    actorId,
  }: {
    boxId: string;
    folderId: string | null;
    title: string;
    slug: string;
    pathCache: string;
    markdownContent: string;
    summary: string | null;
    tags: string[];
    readHint: string | null;
    actorId: string;
  }
): Promise<{ id: string; current_version_id: string | null }> {
  const { data, error } = await supabase.rpc("create_note_with_initial_version", {
    p_box_id: boxId,
    p_folder_id: folderId,
    p_title: title,
    p_slug: slug,
    p_path_cache: pathCache,
    p_markdown_content: markdownContent,
    p_summary: summary,
    p_tags: tags,
    p_read_hint: readHint,
    p_retrieval_priority: 0,
    p_kind: "note",
    p_actor_id: actorId,
    p_origin_type: "imported",
    p_change_origin: "import",
  });

  if (error || !data) throw new Error(error?.message ?? "Failed to create note");

  const noteId = (data as { note: { id: string } }).note.id;

  return {
    id: noteId,
    current_version_id: (data as { note: { current_version_id: string | null } }).note.current_version_id,
  };
}

async function rpcUpdateNote(
  supabase: SupabaseClient,
  noteId: string,
  {
    title,
    markdownContent,
    summary,
    tags,
    readHint,
    actorId,
  }: {
    title: string;
    markdownContent: string;
    summary: string | null;
    tags: string[];
    readHint: string | null;
    actorId: string;
  }
): Promise<void> {
  const { error } = await supabase.rpc("update_note_and_create_version", {
    p_note_id: noteId,
    p_title: title,
    p_markdown_content: markdownContent,
    p_summary: summary,
    p_tags: tags,
    p_read_hint: readHint,
    p_actor_id: actorId,
    p_change_origin: "import",
  });

  if (error) throw new Error(error.message ?? "Failed to update note");
}

// ─── Single markdown file import ──────────────────────────────────────────────

async function importSingleMarkdown(
  supabase: SupabaseClient,
  boxId: string,
  targetFolderId: string | null,
  filename: string,
  content: string,
  actorId: string,
  actions: ImportAction[],
  warnings: ImportWarning[]
): Promise<void> {
  // Extract title from first H1, or filename
  const h1Match = content.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : filename.replace(/\.md$/, "");
  const slug = slugify(title);

  let pathCache = slug;
  if (targetFolderId) {
    const folder = await getFolderById(supabase, targetFolderId);
    if (folder) pathCache = `${folder.path_cache}/${slug}`;
  }

  // Check for path collision and disambiguate
  let finalSlug = slug;
  let finalPathCache = pathCache;
  if (await notePathExists(supabase, boxId, pathCache)) {
    const unique = await uniqueNotePath(supabase, boxId, pathCache);
    finalSlug = unique.slug;
    finalPathCache = unique.pathCache;
    warnings.push({
      code: "path_collision_resolved",
      message: `Path "${pathCache}" already exists. Created at "${finalPathCache}" instead.`,
      subject: pathCache,
    });
  }

  const result = await rpcCreateNote(supabase, {
    boxId,
    folderId: targetFolderId,
    title,
    slug: finalSlug,
    pathCache: finalPathCache,
    markdownContent: content,
    summary: null,
    tags: [],
    readHint: null,
    actorId,
  });

  actions.push({
    object_type: "note",
    incoming_id: null,
    final_id: result.id,
    incoming_path: filename,
    final_path: finalPathCache,
    action: "created",
    reason: null,
  });
}

// ─── Manifest-based import ────────────────────────────────────────────────────

/**
 * Apply a parsed manifest + files to the target box (or workspace, for reusable objects)
 * using the specified collision mode.
 *
 * boxId may be null for workspace-level imports (reusable skill/agent packages).
 * Returns actions and warnings arrays (mutated throughout).
 */
async function applyManifest(
  supabase: SupabaseClient,
  workspaceId: string,
  boxId: string | null,
  targetFolderId: string | null,
  manifest: ExportManifest,
  markdownFiles: Map<string, string>,
  sourceFiles: Map<string, string>,
  collisionMode: CollisionMode,
  actorId: string,
  actions: ImportAction[],
  warnings: ImportWarning[]
): Promise<void> {
  // Validate object count bound
  const totalObjects = manifest.folders.length + manifest.notes.length;
  if (totalObjects > MAX_OBJECT_COUNT) {
    throw new Error(
      `Package contains ${totalObjects} objects (folders + notes), which exceeds the limit of ${MAX_OBJECT_COUNT}.`
    );
  }

  // Validate manifest internal consistency: note folder_ids must reference manifest folders
  const manifestFolderIds = new Set(manifest.folders.map((f) => f.id));
  for (const note of manifest.notes) {
    if (note.folder_id && !manifestFolderIds.has(note.folder_id)) {
      // folder_id referenced but not in manifest — may be a partial export
      warnings.push({
        code: "broken_folder_reference",
        message: `Note "${note.title}" references folder_id "${note.folder_id}" which is not in the package.`,
        subject: note.id,
      });
    }
  }

  // Step 1: Create/remap folders
  // idMap: incoming id → final id in the database
  const folderIdMap = new Map<string, string>();

  // Sort folders so parents are created before children
  const sortedFolders = [...manifest.folders].sort((a, b) => {
    if (!a.parent_id) return -1;
    if (!b.parent_id) return 1;
    return 0;
  });

  for (const mf of sortedFolders) {
    if (!boxId) {
      warnings.push({ code: "folder_requires_box", message: `Folder "${mf.name}" skipped — workspace-level imports do not support folders.`, subject: mf.id });
      continue;
    }
    await applyFolder(
      supabase,
      boxId,
      targetFolderId,
      mf,
      collisionMode,
      folderIdMap,
      actions,
      warnings
    );
  }

  // Step 2: Create/update notes
  // Notes require a box — workspace-level imports (skills/agents only) skip this step.
  const noteIdMap = new Map<string, string>();

  for (const mn of manifest.notes) {
    if (!boxId) {
      warnings.push({ code: "note_requires_box", message: `Note "${mn.title}" skipped — workspace-level imports do not support notes.`, subject: mn.id });
      continue;
    }
    await applyNote(
      supabase,
      boxId,
      targetFolderId,
      mn,
      markdownFiles,
      collisionMode,
      folderIdMap,
      noteIdMap,
      actions,
      warnings,
      actorId
    );
  }

  // Step 3: Create links (only between notes that were actually created/updated)
  const finalNoteIds = new Set(noteIdMap.values());

  for (const ml of manifest.links) {
    const finalSource = noteIdMap.get(ml.source_note_id) ?? ml.source_note_id;
    const finalTarget = noteIdMap.get(ml.target_note_id) ?? ml.target_note_id;

    // Skip if either endpoint is not in the imported set
    if (!finalNoteIds.has(finalSource) || !finalNoteIds.has(finalTarget)) {
      warnings.push({
        code: "link_endpoint_missing",
        message: `Link from "${ml.source_note_id}" to "${ml.target_note_id}" was skipped — one or both endpoints are not in the imported set.`,
        subject: ml.id,
      });
      actions.push({
        object_type: "link",
        incoming_id: ml.id,
        final_id: null,
        incoming_path: null,
        final_path: null,
        action: "skipped",
        reason: "Endpoint not in imported note set",
      });
      continue;
    }

    // Validate relationship_type against canonical vocabulary
    const validRelationshipType = validateRelationshipType(ml.relationship_type);
    if (!validRelationshipType) {
      warnings.push({
        code: "non_canonical_relationship_type",
        message: `Link "${ml.id}" has non-canonical relationship_type "${ml.relationship_type}". Link skipped.`,
        subject: ml.id,
      });
      actions.push({
        object_type: "link",
        incoming_id: ml.id,
        final_id: null,
        incoming_path: null,
        final_path: null,
        action: "skipped",
        reason: `Non-canonical relationship_type: "${ml.relationship_type}"`,
      });
      continue;
    }

    // Check for existing link to avoid duplicate
    const { data: existingLink } = await supabase
      .from("note_links")
      .select("id")
      .eq("source_note_id", finalSource)
      .eq("target_note_id", finalTarget)
      .eq("relationship_type", validRelationshipType)
      .maybeSingle();

    if (existingLink) {
      actions.push({
        object_type: "link",
        incoming_id: ml.id,
        final_id: existingLink.id,
        incoming_path: null,
        final_path: null,
        action: "skipped",
        reason: "Identical link already exists",
      });
      continue;
    }

    try {
      const link = await createNoteLink(supabase, {
        source_note_id: finalSource,
        target_note_id: finalTarget,
        relationship_type: validRelationshipType as never,
        relationship_note: ml.relationship_note ?? null,
      });
      actions.push({
        object_type: "link",
        incoming_id: ml.id,
        final_id: link.id,
        incoming_path: null,
        final_path: null,
        action: "created",
        reason: null,
      });
    } catch (e) {
      warnings.push({
        code: "link_create_failed",
        message: `Failed to create link: ${e instanceof Error ? e.message : String(e)}`,
        subject: ml.id,
      });
      actions.push({
        object_type: "link",
        incoming_id: ml.id,
        final_id: null,
        incoming_path: null,
        final_path: null,
        action: "skipped",
        reason: "Create failed",
      });
    }
  }

  // Step 4 (v1.1): Import files, skills, agents
  if (manifest.schema_version === "1.1") {
    // Files — only if we have a target box
    const manifestFiles = manifest.object_files ?? [];
    if (boxId && manifestFiles.length > 0) {
      const fileIdMap = new Map<string, string>();
      for (const mf of manifestFiles) {
        await applyFile(supabase, workspaceId, boxId, targetFolderId, mf, sourceFiles, collisionMode, folderIdMap, fileIdMap, actions, warnings, actorId);
      }
    }

    // Skills
    const manifestSkills = manifest.skills ?? [];
    if (manifestSkills.length > 0) {
      const skillIdMap = new Map<string, string>();
      for (const ms of manifestSkills) {
        await applySkill(supabase, workspaceId, boxId, targetFolderId, ms, sourceFiles, collisionMode, folderIdMap, skillIdMap, actions, warnings, actorId);
      }
    }

    // Agents
    const manifestAgents = manifest.agents ?? [];
    if (manifestAgents.length > 0) {
      const agentIdMap = new Map<string, string>();
      for (const ma of manifestAgents) {
        await applyAgent(supabase, workspaceId, boxId, targetFolderId, ma, sourceFiles, collisionMode, folderIdMap, agentIdMap, actions, warnings, actorId);
      }
    }
  }

  // Step 5: Restore guide note assignment from manifest.
  // The export marks the box's current guide note with is_guide_note: true.
  // On import, if that note was successfully created or updated, assign it
  // as the box's guide note. This preserves round-trip fidelity for full
  // box exports. Fire-and-forget: a failure here is non-fatal.
  const manifestGuideNote = manifest.notes.find((n) => n.is_guide_note);
  if (manifestGuideNote && boxId) {
    const finalGuideId = noteIdMap.get(manifestGuideNote.id);
    if (finalGuideId) {
      try {
        await updateBox(supabase, boxId, { guide_note_id: finalGuideId });
        auditGuideNoteAssigned(
          supabase,
          workspaceId,
          actorId,
          boxId,
          finalGuideId,
          manifestGuideNote.title
        );
      } catch {
        warnings.push({
          code: "guide_note_assignment_failed",
          message: `Guide note assignment for "${manifestGuideNote.title}" failed — box guide note unchanged.`,
          subject: manifestGuideNote.id,
        });
      }
    } else {
      warnings.push({
        code: "guide_note_not_imported",
        message: `Manifest declares "${manifestGuideNote.title}" as guide note, but it was not imported. Box guide note unchanged.`,
        subject: manifestGuideNote.id,
      });
    }
  }
}

async function applyFolder(
  supabase: SupabaseClient,
  boxId: string,
  targetFolderId: string | null,
  mf: ManifestFolder,
  collisionMode: CollisionMode,
  folderIdMap: Map<string, string>,
  actions: ImportAction[],
  warnings: ImportWarning[]
): Promise<void> {
  // Resolve parent: if mf.parent_id is set, look it up in folderIdMap;
  // otherwise, use targetFolderId (the import root)
  const resolvedParentId = mf.parent_id
    ? (folderIdMap.get(mf.parent_id) ?? null)
    : targetFolderId;

  if (collisionMode === "replace_by_id" || collisionMode === "merge_metadata_only") {
    const existing = await getFolderById(supabase, mf.id);
    if (existing) {
      if (existing.box_id !== boxId) {
        warnings.push({
          code: "folder_wrong_box",
          message: `Folder "${mf.name}" (${mf.id}) exists but belongs to a different box. Skipping.`,
          subject: mf.id,
        });
        actions.push({
          object_type: "folder",
          incoming_id: mf.id,
          final_id: mf.id,
          incoming_path: mf.path,
          final_path: existing.path_cache,
          action: "skipped",
          reason: "Belongs to different box",
        });
        folderIdMap.set(mf.id, mf.id);
        return;
      }
      // Update metadata only
      await updateFolder(supabase, mf.id, {
        name: mf.name,
        description: mf.description,
      });
      folderIdMap.set(mf.id, mf.id);
      actions.push({
        object_type: "folder",
        incoming_id: mf.id,
        final_id: mf.id,
        incoming_path: mf.path,
        final_path: existing.path_cache,
        action: "replaced",
        reason: null,
      });
      return;
    }
  }

  if (collisionMode === "remap_ids_and_import") {
    // Check if id is already taken
    const existing = await getFolderById(supabase, mf.id);
    if (existing) {
      // Create with a new id by inserting without specifying id
      const slug = slugify(mf.name);
      const parentFolder = resolvedParentId
        ? await getFolderById(supabase, resolvedParentId)
        : null;
      const pathCache = parentFolder ? `${parentFolder.path_cache}/${slug}` : slug;

      const created = await createFolder(supabase, {
        box_id: boxId,
        parent_folder_id: resolvedParentId,
        name: mf.name,
        slug,
        path_cache: pathCache,
        description: mf.description,
      });
      folderIdMap.set(mf.id, created.id);
      actions.push({
        object_type: "folder",
        incoming_id: mf.id,
        final_id: created.id,
        incoming_path: mf.path,
        final_path: created.path_cache,
        action: "remapped",
        reason: `Original id "${mf.id}" was already in use`,
      });
      return;
    }
  }

  // create_copy mode, or no collision detected: create normally
  const slug = slugify(mf.name);
  const parentFolder = resolvedParentId
    ? await getFolderById(supabase, resolvedParentId)
    : null;
  const pathCache = parentFolder ? `${parentFolder.path_cache}/${slug}` : slug;

  // Check for path collision in create_copy mode
  const { data: pathCollision } = await supabase
    .from("folders")
    .select("id")
    .eq("box_id", boxId)
    .eq("path_cache", pathCache)
    .neq("status", "trashed")
    .maybeSingle();

  let finalSlug = slug;
  let finalPathCache = pathCache;

  if (pathCollision) {
    finalSlug = `${slug}-copy`;
    finalPathCache = parentFolder ? `${parentFolder.path_cache}/${finalSlug}` : finalSlug;
    warnings.push({
      code: "folder_path_collision",
      message: `Folder path "${pathCache}" already exists. Created at "${finalPathCache}".`,
      subject: mf.path,
    });
  }

  try {
    const created = await createFolder(supabase, {
      box_id: boxId,
      parent_folder_id: resolvedParentId,
      name: mf.name,
      slug: finalSlug,
      path_cache: finalPathCache,
      description: mf.description,
    });
    folderIdMap.set(mf.id, created.id);
    actions.push({
      object_type: "folder",
      incoming_id: mf.id,
      final_id: created.id,
      incoming_path: mf.path,
      final_path: created.path_cache,
      action: pathCollision ? "duplicated" : "created",
      reason: pathCollision ? "Path collision — created with suffix" : null,
    });
  } catch (e) {
    warnings.push({
      code: "folder_create_failed",
      message: `Failed to create folder "${mf.name}": ${e instanceof Error ? e.message : String(e)}`,
      subject: mf.id,
    });
    actions.push({
      object_type: "folder",
      incoming_id: mf.id,
      final_id: null,
      incoming_path: mf.path,
      final_path: null,
      action: "skipped",
      reason: "Create failed",
    });
  }
}

async function applyNote(
  supabase: SupabaseClient,
  boxId: string,
  targetFolderId: string | null,
  mn: ManifestNote,
  markdownFiles: Map<string, string>,
  collisionMode: CollisionMode,
  folderIdMap: Map<string, string>,
  noteIdMap: Map<string, string>,
  actions: ImportAction[],
  warnings: ImportWarning[],
  actorId: string
): Promise<void> {
  // Get markdown content from the file map
  let markdownContent = markdownFiles.get(mn.file_path) ?? "";
  // Strip the auto-generated header/summary we add on export
  markdownContent = stripExportHeader(markdownContent, mn.title, mn.summary);

  // Resolve folder: use folderIdMap if a folder_id was in manifest
  const resolvedFolderId = mn.folder_id
    ? (folderIdMap.get(mn.folder_id) ?? null)
    : targetFolderId;

  if (collisionMode === "replace_by_id") {
    const existing = await getNoteById(supabase, mn.id);
    if (existing) {
      if (existing.box_id !== boxId) {
        warnings.push({
          code: "note_wrong_box",
          message: `Note "${mn.title}" (${mn.id}) exists but belongs to a different box. Skipping.`,
          subject: mn.id,
        });
        actions.push({
          object_type: "note",
          incoming_id: mn.id,
          final_id: null,
          incoming_path: mn.path,
          final_path: null,
          action: "skipped",
          reason: "Belongs to different box",
        });
        return;
      }
      // Update via RPC (creates new version atomically)
      await rpcUpdateNote(supabase, mn.id, {
        title: mn.title,
        markdownContent,
        summary: mn.summary,
        tags: mn.tags,
        readHint: sanitizeReadHint(mn.read_hint),
        actorId,
      });
      noteIdMap.set(mn.id, mn.id);
      actions.push({
        object_type: "note",
        incoming_id: mn.id,
        final_id: mn.id,
        incoming_path: mn.path,
        final_path: existing.path_cache,
        action: "replaced",
        reason: null,
      });
      return;
    }
  }

  if (collisionMode === "merge_metadata_only") {
    const existing = await getNoteById(supabase, mn.id);
    if (existing) {
      if (existing.box_id !== boxId) {
        actions.push({
          object_type: "note",
          incoming_id: mn.id,
          final_id: null,
          incoming_path: mn.path,
          final_path: null,
          action: "skipped",
          reason: "Belongs to different box",
        });
        return;
      }
      // Merge metadata only — never touch markdown body
      const metaChanged =
        existing.summary !== mn.summary ||
        JSON.stringify(existing.tags) !== JSON.stringify(mn.tags) ||
        existing.read_hint !== mn.read_hint;

      if (metaChanged) {
        // Create a new version with merged metadata but preserve the existing body
        await rpcUpdateNote(supabase, mn.id, {
          title: existing.title,
          markdownContent: existing.markdown_content,
          summary: mn.summary,
          tags: mn.tags,
          readHint: sanitizeReadHint(mn.read_hint),
          actorId,
        });
      }
      noteIdMap.set(mn.id, mn.id);
      actions.push({
        object_type: "note",
        incoming_id: mn.id,
        final_id: mn.id,
        incoming_path: mn.path,
        final_path: existing.path_cache,
        action: "replaced",
        reason: metaChanged ? "Metadata merged" : "No metadata changes — skipped body update",
      });
      return;
    }
  }

  if (collisionMode === "remap_ids_and_import") {
    const existing = await getNoteById(supabase, mn.id);
    if (existing) {
      // Id is already taken — create with new id
      const slug = slugify(mn.title);
      const parentFolder = resolvedFolderId
        ? await getFolderById(supabase, resolvedFolderId)
        : null;
      let pathCache = parentFolder ? `${parentFolder.path_cache}/${slug}` : slug;

      if (await notePathExists(supabase, boxId, pathCache)) {
        const unique = await uniqueNotePath(supabase, boxId, pathCache);
        pathCache = unique.pathCache;
      }

      const result = await rpcCreateNote(supabase, {
        boxId,
        folderId: resolvedFolderId,
        title: mn.title,
        slug: slugify(mn.title),
        pathCache,
        markdownContent,
        summary: mn.summary,
        tags: mn.tags,
        readHint: sanitizeReadHint(mn.read_hint),
        actorId,
      });
      noteIdMap.set(mn.id, result.id);
      actions.push({
        object_type: "note",
        incoming_id: mn.id,
        final_id: result.id,
        incoming_path: mn.path,
        final_path: pathCache,
        action: "remapped",
        reason: `Original id "${mn.id}" was already in use`,
      });
      return;
    }
  }

  // create_copy or no collision: create normally
  const slug = slugify(mn.title);
  const parentFolder = resolvedFolderId
    ? await getFolderById(supabase, resolvedFolderId)
    : null;
  let pathCache = parentFolder ? `${parentFolder.path_cache}/${slug}` : slug;
  let finalSlug = slug;

  if (await notePathExists(supabase, boxId, pathCache)) {
    const unique = await uniqueNotePath(supabase, boxId, pathCache);
    finalSlug = unique.slug;
    pathCache = unique.pathCache;
    warnings.push({
      code: "note_path_collision",
      message: `Note path "${mn.path}" already exists. Created at "${pathCache}" instead.`,
      subject: mn.path,
    });
  }

  const result = await rpcCreateNote(supabase, {
    boxId,
    folderId: resolvedFolderId,
    title: mn.title,
    slug: finalSlug,
    pathCache,
    markdownContent,
    summary: mn.summary,
    tags: mn.tags,
    readHint: mn.read_hint,
    actorId,
  });

  noteIdMap.set(mn.id, result.id);
  actions.push({
    object_type: "note",
    incoming_id: mn.id,
    final_id: result.id,
    incoming_path: mn.path,
    final_path: pathCache,
    action: "created",
    reason: null,
  });
}

/**
 * Strip the auto-generated export header from a markdown file.
 * The export service prepends "# Title\n\n> Summary\n\n**Tags:**...\n\n" before the body.
 * On import, we strip this header to recover the original body.
 */
function stripExportHeader(content: string, title: string, summary: string | null): string {
  let c = content;
  // Strip leading H1 title line
  const titleLine = `# ${title}`;
  if (c.startsWith(titleLine)) {
    c = c.slice(titleLine.length).trimStart();
  }
  // Strip summary blockquote
  if (summary && c.startsWith(`> ${summary}`)) {
    c = c.slice(`> ${summary}`.length).trimStart();
  }
  return c;
}

// ─── RPC helpers for file/skill/agent create/update ──────────────────────────

/** Infer SourceFormat from a file extension. */
function extensionToSourceFormat(ext: string): string {
  const map: Record<string, string> = {
    ".md": "markdown",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".xml": "xml",
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".sh": "shell",
    ".bash": "shell",
    ".sql": "sql",
    ".html": "html",
    ".css": "css",
    ".txt": "plain_text",
  };
  return map[ext.toLowerCase()] ?? "plain_text";
}

/** Insert a row into workspace_objects for a newly created file/skill/agent. */
async function registerWorkspaceObject(
  supabase: SupabaseClient,
  {
    workspaceId,
    boxId,
    folderId,
    objectType,
    objectId,
    displayName,
    isReusable,
  }: {
    workspaceId: string;
    boxId: string | null;
    folderId: string | null;
    objectType: string;
    objectId: string;
    displayName: string;
    isReusable: boolean;
  }
): Promise<void> {
  const { error } = await supabase.from("workspace_objects").insert({
    workspace_id: workspaceId,
    box_id: boxId,
    folder_id: folderId,
    object_type: objectType,
    object_id: objectId,
    display_name: displayName,
    status: OBJECT_STATUS.ACTIVE,
    is_reusable: isReusable,
  });
  if (error) {
    console.error("[import] Failed to register workspace_object for", objectType, objectId, error);
  }
}

async function rpcCreateFile(
  supabase: SupabaseClient,
  {
    workspaceId,
    boxId,
    folderId,
    name,
    slug,
    pathCache,
    sourceContent,
    canonicalFormat,
    fileExtension,
    description,
    tags,
    summary,
    actorId,
  }: {
    workspaceId: string;
    boxId: string;
    folderId: string | null;
    name: string;
    slug: string;
    pathCache: string;
    sourceContent: string;
    canonicalFormat: string;
    fileExtension: string | null;
    description: string | null;
    tags: string[];
    summary: string | null;
    actorId: string;
  }
): Promise<{ id: string }> {
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");
  const { data, error } = await supabase.rpc("create_object_with_initial_version", {
    p_object_type: OBJECT_TYPE.FILE,
    p_workspace_id: workspaceId,
    p_box_id: boxId,
    p_folder_id: folderId,
    p_name: name,
    p_slug: slug,
    p_path_cache: pathCache,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_canonical_format: canonicalFormat,
    p_file_extension: fileExtension,
    p_description: description,
    p_tags: tags,
    p_summary: summary,
    p_origin_type: OBJECT_ORIGIN_TYPE.IMPORTED,
    p_actor_id: actorId,
  });
  if (error || !data) throw new Error(error?.message ?? "Failed to create file");
  return { id: (data as { object: { id: string } }).object.id };
}

async function rpcUpdateFile(
  supabase: SupabaseClient,
  fileId: string,
  {
    sourceContent,
    description,
    tags,
    summary,
    actorId,
  }: {
    sourceContent: string;
    description: string | null;
    tags: string[];
    summary: string | null;
    actorId: string;
  }
): Promise<void> {
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");
  const { error } = await supabase.rpc("update_object_and_create_version", {
    p_object_type: OBJECT_TYPE.FILE,
    p_object_id: fileId,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_description: description,
    p_tags: tags,
    p_summary: summary,
    p_actor_id: actorId,
    p_change_origin: "import",
  });
  if (error) throw new Error(error.message ?? "Failed to update file");
}

async function rpcCreateSkill(
  supabase: SupabaseClient,
  {
    workspaceId,
    boxId,
    folderId,
    name,
    slug,
    pathCache,
    sourceContent,
    canonicalFormat,
    description,
    tags,
    summary,
    isReusable,
    actorId,
  }: {
    workspaceId: string;
    boxId: string | null;
    folderId: string | null;
    name: string;
    slug: string;
    pathCache: string;
    sourceContent: string;
    canonicalFormat: string;
    description: string | null;
    tags: string[];
    summary: string | null;
    isReusable: boolean;
    actorId: string;
  }
): Promise<{ id: string }> {
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");
  const { data, error } = await supabase.rpc("create_object_with_initial_version", {
    p_object_type: OBJECT_TYPE.SKILL,
    p_workspace_id: workspaceId,
    p_box_id: boxId,
    p_folder_id: folderId,
    p_name: name,
    p_slug: slug,
    p_path_cache: pathCache,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_canonical_format: canonicalFormat,
    p_description: description,
    p_tags: tags,
    p_summary: summary,
    p_is_reusable: isReusable,
    p_origin_type: OBJECT_ORIGIN_TYPE.IMPORTED,
    p_actor_id: actorId,
  });
  if (error || !data) throw new Error(error?.message ?? "Failed to create skill");
  return { id: (data as { object: { id: string } }).object.id };
}

async function rpcUpdateSkill(
  supabase: SupabaseClient,
  skillId: string,
  {
    sourceContent,
    description,
    tags,
    summary,
    actorId,
  }: {
    sourceContent: string;
    description: string | null;
    tags: string[];
    summary: string | null;
    actorId: string;
  }
): Promise<void> {
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");
  const { error } = await supabase.rpc("update_object_and_create_version", {
    p_object_type: OBJECT_TYPE.SKILL,
    p_object_id: skillId,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_description: description,
    p_tags: tags,
    p_summary: summary,
    p_actor_id: actorId,
    p_change_origin: "import",
  });
  if (error) throw new Error(error.message ?? "Failed to update skill");
}

async function rpcCreateAgent(
  supabase: SupabaseClient,
  {
    workspaceId,
    boxId,
    folderId,
    name,
    slug,
    pathCache,
    sourceContent,
    canonicalFormat,
    agentType,
    description,
    tags,
    summary,
    isReusable,
    actorId,
  }: {
    workspaceId: string;
    boxId: string | null;
    folderId: string | null;
    name: string;
    slug: string;
    pathCache: string;
    sourceContent: string;
    canonicalFormat: string;
    agentType: string | null;
    description: string | null;
    tags: string[];
    summary: string | null;
    isReusable: boolean;
    actorId: string;
  }
): Promise<{ id: string }> {
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");
  const { data, error } = await supabase.rpc("create_object_with_initial_version", {
    p_object_type: OBJECT_TYPE.AGENT,
    p_workspace_id: workspaceId,
    p_box_id: boxId,
    p_folder_id: folderId,
    p_name: name,
    p_slug: slug,
    p_path_cache: pathCache,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_canonical_format: canonicalFormat,
    p_agent_type: agentType,
    p_description: description,
    p_tags: tags,
    p_summary: summary,
    p_is_reusable: isReusable,
    p_origin_type: OBJECT_ORIGIN_TYPE.IMPORTED,
    p_actor_id: actorId,
  });
  if (error || !data) throw new Error(error?.message ?? "Failed to create agent");
  return { id: (data as { object: { id: string } }).object.id };
}

async function rpcUpdateAgent(
  supabase: SupabaseClient,
  agentId: string,
  {
    sourceContent,
    description,
    tags,
    summary,
    actorId,
  }: {
    sourceContent: string;
    description: string | null;
    tags: string[];
    summary: string | null;
    actorId: string;
  }
): Promise<void> {
  const contentBytes = Buffer.byteLength(sourceContent, "utf8");
  const { error } = await supabase.rpc("update_object_and_create_version", {
    p_object_type: OBJECT_TYPE.AGENT,
    p_object_id: agentId,
    p_source_content: sourceContent,
    p_content_bytes: contentBytes,
    p_description: description,
    p_tags: tags,
    p_summary: summary,
    p_actor_id: actorId,
    p_change_origin: "import",
  });
  if (error) throw new Error(error.message ?? "Failed to update agent");
}

// ─── applyFile ────────────────────────────────────────────────────────────────

async function applyFile(
  supabase: SupabaseClient,
  workspaceId: string,
  boxId: string,
  targetFolderId: string | null,
  mf: ManifestFile,
  sourceFiles: Map<string, string>,
  collisionMode: CollisionMode,
  folderIdMap: Map<string, string>,
  fileIdMap: Map<string, string>,
  actions: ImportAction[],
  warnings: ImportWarning[],
  actorId: string
): Promise<void> {
  const sourceContent = sourceFiles.get(mf.file_path) ?? "";
  const resolvedFolderId = mf.folder_id
    ? (folderIdMap.get(mf.folder_id) ?? null)
    : targetFolderId;

  // Infer format from file_path extension if canonical_format is unknown
  const dotIdx = mf.file_path.lastIndexOf(".");
  const ext = dotIdx >= 0 ? mf.file_path.slice(dotIdx) : "";
  const canonicalFormat = mf.canonical_format || extensionToSourceFormat(ext);

  if (collisionMode === "replace_by_id") {
    const existing = await getFileById(supabase, mf.id);
    if (existing) {
      if (existing.box_id !== boxId) {
        warnings.push({ code: "file_wrong_box", message: `File "${mf.name}" (${mf.id}) exists in a different box. Skipping.`, subject: mf.id });
        actions.push({ object_type: "file", incoming_id: mf.id, final_id: null, incoming_path: mf.path, final_path: null, action: "skipped", reason: "Belongs to different box" });
        return;
      }
      await rpcUpdateFile(supabase, mf.id, { sourceContent, description: mf.description, tags: mf.tags, summary: mf.summary, actorId });
      fileIdMap.set(mf.id, mf.id);
      actions.push({ object_type: "file", incoming_id: mf.id, final_id: mf.id, incoming_path: mf.path, final_path: existing.path_cache, action: "replaced", reason: null });
      return;
    }
  }

  if (collisionMode === "merge_metadata_only") {
    const existing = await getFileById(supabase, mf.id);
    if (existing) {
      if (existing.box_id !== boxId) {
        actions.push({ object_type: "file", incoming_id: mf.id, final_id: null, incoming_path: mf.path, final_path: null, action: "skipped", reason: "Belongs to different box" });
        return;
      }
      // Merge metadata only — never replace source content
      const metaChanged = existing.description !== mf.description || JSON.stringify(existing.tags) !== JSON.stringify(mf.tags);
      if (metaChanged) {
        await rpcUpdateFile(supabase, mf.id, { sourceContent: existing.source_content, description: mf.description, tags: mf.tags, summary: mf.summary, actorId });
      }
      fileIdMap.set(mf.id, mf.id);
      actions.push({ object_type: "file", incoming_id: mf.id, final_id: mf.id, incoming_path: mf.path, final_path: existing.path_cache, action: "replaced", reason: metaChanged ? "Metadata merged" : "No changes" });
      return;
    }
  }

  if (collisionMode === "remap_ids_and_import") {
    const existing = await getFileById(supabase, mf.id);
    if (existing) {
      const newSlug = slugify(mf.name);
      const parentFolder = resolvedFolderId ? await getFolderById(supabase, resolvedFolderId) : null;
      const pathCache = parentFolder ? `${parentFolder.path_cache}/${newSlug}` : newSlug;
      const result = await rpcCreateFile(supabase, { workspaceId, boxId, folderId: resolvedFolderId, name: mf.name, slug: newSlug, pathCache, sourceContent, canonicalFormat, fileExtension: mf.file_extension, description: mf.description, tags: mf.tags, summary: mf.summary, actorId });
      await registerWorkspaceObject(supabase, { workspaceId, boxId, folderId: resolvedFolderId, objectType: OBJECT_TYPE.FILE, objectId: result.id, displayName: mf.name, isReusable: false });
      fileIdMap.set(mf.id, result.id);
      actions.push({ object_type: "file", incoming_id: mf.id, final_id: result.id, incoming_path: mf.path, final_path: pathCache, action: "remapped", reason: `Original id "${mf.id}" was already in use` });
      return;
    }
  }

  // create_copy or no collision
  const slug = slugify(mf.name);
  const parentFolder = resolvedFolderId ? await getFolderById(supabase, resolvedFolderId) : null;
  const pathCache = parentFolder ? `${parentFolder.path_cache}/${slug}` : slug;

  try {
    const result = await rpcCreateFile(supabase, { workspaceId, boxId, folderId: resolvedFolderId, name: mf.name, slug, pathCache, sourceContent, canonicalFormat, fileExtension: mf.file_extension, description: mf.description, tags: mf.tags, summary: mf.summary, actorId });
    await registerWorkspaceObject(supabase, { workspaceId, boxId, folderId: resolvedFolderId, objectType: OBJECT_TYPE.FILE, objectId: result.id, displayName: mf.name, isReusable: false });
    fileIdMap.set(mf.id, result.id);
    actions.push({ object_type: "file", incoming_id: mf.id, final_id: result.id, incoming_path: mf.path, final_path: pathCache, action: "created", reason: null });
  } catch (e) {
    warnings.push({ code: "file_create_failed", message: `Failed to create file "${mf.name}": ${e instanceof Error ? e.message : String(e)}`, subject: mf.id });
    actions.push({ object_type: "file", incoming_id: mf.id, final_id: null, incoming_path: mf.path, final_path: null, action: "skipped", reason: "Create failed" });
  }
}

// ─── applySkill ───────────────────────────────────────────────────────────────

async function applySkill(
  supabase: SupabaseClient,
  workspaceId: string,
  boxId: string | null,
  targetFolderId: string | null,
  ms: ManifestSkill,
  sourceFiles: Map<string, string>,
  collisionMode: CollisionMode,
  folderIdMap: Map<string, string>,
  skillIdMap: Map<string, string>,
  actions: ImportAction[],
  warnings: ImportWarning[],
  actorId: string
): Promise<void> {
  // is_reusable is ALWAYS preserved from the manifest
  const isReusable = ms.is_reusable;
  // Reusable skills go to workspace library (no box); box-local need a box
  const targetBoxId = isReusable ? null : (boxId ?? null);

  if (!targetBoxId && !isReusable) {
    warnings.push({ code: "skill_no_box", message: `Skill "${ms.name}" is box-local (is_reusable=false) but no target box is available. Skipping.`, subject: ms.id });
    actions.push({ object_type: "skill", incoming_id: ms.id, final_id: null, incoming_path: ms.path, final_path: null, action: "skipped", reason: "Box-local skill but no target box" });
    return;
  }

  const sourceContent = sourceFiles.get(ms.file_path) ?? "";
  const resolvedFolderId = ms.folder_id
    ? (folderIdMap.get(ms.folder_id) ?? null)
    : targetFolderId;

  if (collisionMode === "replace_by_id") {
    const existing = await getSkillById(supabase, ms.id);
    if (existing) {
      if (targetBoxId && existing.box_id !== targetBoxId) {
        warnings.push({ code: "skill_wrong_box", message: `Skill "${ms.name}" (${ms.id}) exists in a different box. Skipping.`, subject: ms.id });
        actions.push({ object_type: "skill", incoming_id: ms.id, final_id: null, incoming_path: ms.path, final_path: null, action: "skipped", reason: "Belongs to different box" });
        return;
      }
      await rpcUpdateSkill(supabase, ms.id, { sourceContent, description: ms.description, tags: ms.tags, summary: ms.summary, actorId });
      skillIdMap.set(ms.id, ms.id);
      actions.push({ object_type: "skill", incoming_id: ms.id, final_id: ms.id, incoming_path: ms.path, final_path: existing.path_cache, action: "replaced", reason: null });
      return;
    }
  }

  if (collisionMode === "merge_metadata_only") {
    const existing = await getSkillById(supabase, ms.id);
    if (existing) {
      const metaChanged = existing.description !== ms.description || JSON.stringify(existing.tags) !== JSON.stringify(ms.tags);
      if (metaChanged) {
        await rpcUpdateSkill(supabase, ms.id, { sourceContent: existing.source_content, description: ms.description, tags: ms.tags, summary: ms.summary, actorId });
      }
      skillIdMap.set(ms.id, ms.id);
      actions.push({ object_type: "skill", incoming_id: ms.id, final_id: ms.id, incoming_path: ms.path, final_path: existing.path_cache, action: "replaced", reason: metaChanged ? "Metadata merged" : "No changes" });
      return;
    }
  }

  if (collisionMode === "remap_ids_and_import") {
    const existing = await getSkillById(supabase, ms.id);
    if (existing) {
      const newSlug = slugify(ms.name);
      const pathCache = isReusable ? newSlug : (() => { return newSlug; })();
      const result = await rpcCreateSkill(supabase, { workspaceId, boxId: targetBoxId, folderId: resolvedFolderId, name: ms.name, slug: newSlug, pathCache, sourceContent, canonicalFormat: ms.canonical_format, description: ms.description, tags: ms.tags, summary: ms.summary, isReusable, actorId });
      await registerWorkspaceObject(supabase, { workspaceId, boxId: targetBoxId, folderId: resolvedFolderId, objectType: OBJECT_TYPE.SKILL, objectId: result.id, displayName: ms.name, isReusable });
      skillIdMap.set(ms.id, result.id);
      actions.push({ object_type: "skill", incoming_id: ms.id, final_id: result.id, incoming_path: ms.path, final_path: pathCache, action: "remapped", reason: `Original id "${ms.id}" was already in use` });
      return;
    }
  }

  // create_copy or no collision
  const slug = slugify(ms.name);
  const pathCache = slug;
  try {
    const result = await rpcCreateSkill(supabase, { workspaceId, boxId: targetBoxId, folderId: resolvedFolderId, name: ms.name, slug, pathCache, sourceContent, canonicalFormat: ms.canonical_format, description: ms.description, tags: ms.tags, summary: ms.summary, isReusable, actorId });
    await registerWorkspaceObject(supabase, { workspaceId, boxId: targetBoxId, folderId: resolvedFolderId, objectType: OBJECT_TYPE.SKILL, objectId: result.id, displayName: ms.name, isReusable });
    skillIdMap.set(ms.id, result.id);
    actions.push({ object_type: "skill", incoming_id: ms.id, final_id: result.id, incoming_path: ms.path, final_path: pathCache, action: "created", reason: null });
  } catch (e) {
    warnings.push({ code: "skill_create_failed", message: `Failed to create skill "${ms.name}": ${e instanceof Error ? e.message : String(e)}`, subject: ms.id });
    actions.push({ object_type: "skill", incoming_id: ms.id, final_id: null, incoming_path: ms.path, final_path: null, action: "skipped", reason: "Create failed" });
  }
}

// ─── applyAgent ───────────────────────────────────────────────────────────────

async function applyAgent(
  supabase: SupabaseClient,
  workspaceId: string,
  boxId: string | null,
  targetFolderId: string | null,
  ma: ManifestAgent,
  sourceFiles: Map<string, string>,
  collisionMode: CollisionMode,
  folderIdMap: Map<string, string>,
  agentIdMap: Map<string, string>,
  actions: ImportAction[],
  warnings: ImportWarning[],
  actorId: string
): Promise<void> {
  const isReusable = ma.is_reusable;
  const targetBoxId = isReusable ? null : (boxId ?? null);

  if (!targetBoxId && !isReusable) {
    warnings.push({ code: "agent_no_box", message: `Agent "${ma.name}" is box-local (is_reusable=false) but no target box is available. Skipping.`, subject: ma.id });
    actions.push({ object_type: "agent", incoming_id: ma.id, final_id: null, incoming_path: ma.path, final_path: null, action: "skipped", reason: "Box-local agent but no target box" });
    return;
  }

  const sourceContent = sourceFiles.get(ma.file_path) ?? "";
  const resolvedFolderId = ma.folder_id
    ? (folderIdMap.get(ma.folder_id) ?? null)
    : targetFolderId;

  if (collisionMode === "replace_by_id") {
    const existing = await getAgentById(supabase, ma.id);
    if (existing) {
      if (targetBoxId && existing.box_id !== targetBoxId) {
        warnings.push({ code: "agent_wrong_box", message: `Agent "${ma.name}" (${ma.id}) exists in a different box. Skipping.`, subject: ma.id });
        actions.push({ object_type: "agent", incoming_id: ma.id, final_id: null, incoming_path: ma.path, final_path: null, action: "skipped", reason: "Belongs to different box" });
        return;
      }
      await rpcUpdateAgent(supabase, ma.id, { sourceContent, description: ma.description, tags: ma.tags, summary: ma.summary, actorId });
      agentIdMap.set(ma.id, ma.id);
      actions.push({ object_type: "agent", incoming_id: ma.id, final_id: ma.id, incoming_path: ma.path, final_path: existing.path_cache, action: "replaced", reason: null });
      return;
    }
  }

  if (collisionMode === "merge_metadata_only") {
    const existing = await getAgentById(supabase, ma.id);
    if (existing) {
      const metaChanged = existing.description !== ma.description || JSON.stringify(existing.tags) !== JSON.stringify(ma.tags);
      if (metaChanged) {
        await rpcUpdateAgent(supabase, ma.id, { sourceContent: existing.source_content, description: ma.description, tags: ma.tags, summary: ma.summary, actorId });
      }
      agentIdMap.set(ma.id, ma.id);
      actions.push({ object_type: "agent", incoming_id: ma.id, final_id: ma.id, incoming_path: ma.path, final_path: existing.path_cache, action: "replaced", reason: metaChanged ? "Metadata merged" : "No changes" });
      return;
    }
  }

  if (collisionMode === "remap_ids_and_import") {
    const existing = await getAgentById(supabase, ma.id);
    if (existing) {
      const newSlug = slugify(ma.name);
      const pathCache = newSlug;
      const result = await rpcCreateAgent(supabase, { workspaceId, boxId: targetBoxId, folderId: resolvedFolderId, name: ma.name, slug: newSlug, pathCache, sourceContent, canonicalFormat: ma.canonical_format, agentType: ma.agent_type, description: ma.description, tags: ma.tags, summary: ma.summary, isReusable, actorId });
      await registerWorkspaceObject(supabase, { workspaceId, boxId: targetBoxId, folderId: resolvedFolderId, objectType: OBJECT_TYPE.AGENT, objectId: result.id, displayName: ma.name, isReusable });
      agentIdMap.set(ma.id, result.id);
      actions.push({ object_type: "agent", incoming_id: ma.id, final_id: result.id, incoming_path: ma.path, final_path: pathCache, action: "remapped", reason: `Original id "${ma.id}" was already in use` });
      return;
    }
  }

  // create_copy or no collision
  const slug = slugify(ma.name);
  const pathCache = slug;
  try {
    const result = await rpcCreateAgent(supabase, { workspaceId, boxId: targetBoxId, folderId: resolvedFolderId, name: ma.name, slug, pathCache, sourceContent, canonicalFormat: ma.canonical_format, agentType: ma.agent_type, description: ma.description, tags: ma.tags, summary: ma.summary, isReusable, actorId });
    await registerWorkspaceObject(supabase, { workspaceId, boxId: targetBoxId, folderId: resolvedFolderId, objectType: OBJECT_TYPE.AGENT, objectId: result.id, displayName: ma.name, isReusable });
    agentIdMap.set(ma.id, result.id);
    actions.push({ object_type: "agent", incoming_id: ma.id, final_id: result.id, incoming_path: ma.path, final_path: pathCache, action: "created", reason: null });
  } catch (e) {
    warnings.push({ code: "agent_create_failed", message: `Failed to create agent "${ma.name}": ${e instanceof Error ? e.message : String(e)}`, subject: ma.id });
    actions.push({ object_type: "agent", incoming_id: ma.id, final_id: null, incoming_path: ma.path, final_path: null, action: "skipped", reason: "Create failed" });
  }
}

// ─── Build summary report ─────────────────────────────────────────────────────

function buildSummary(
  collisionMode: CollisionMode,
  actions: ImportAction[],
  warnings: ImportWarning[]
): ImportSummaryReport {
  const created = { folders: 0, notes: 0, links: 0, files: 0, skills: 0, agents: 0 };
  const replaced = { notes: 0, folders: 0, files: 0, skills: 0, agents: 0 };
  const duplicated = { notes: 0, folders: 0, files: 0, skills: 0, agents: 0 };
  const remapped = { notes: 0, folders: 0, files: 0, skills: 0, agents: 0 };
  const skipped = { notes: 0, folders: 0, links: 0, files: 0, skills: 0, agents: 0 };

  for (const a of actions) {
    const t = a.object_type;
    if (a.action === "created") {
      if (t === "link") created.links++;
      else if (t === "note") created.notes++;
      else if (t === "folder") created.folders++;
      else if (t === "file") created.files++;
      else if (t === "skill") created.skills++;
      else if (t === "agent") created.agents++;
    } else if (a.action === "replaced") {
      if (t === "note") replaced.notes++;
      else if (t === "folder") replaced.folders++;
      else if (t === "file") replaced.files++;
      else if (t === "skill") replaced.skills++;
      else if (t === "agent") replaced.agents++;
    } else if (a.action === "duplicated") {
      if (t === "note") duplicated.notes++;
      else if (t === "folder") duplicated.folders++;
      else if (t === "file") duplicated.files++;
      else if (t === "skill") duplicated.skills++;
      else if (t === "agent") duplicated.agents++;
    } else if (a.action === "remapped") {
      if (t === "note") remapped.notes++;
      else if (t === "folder") remapped.folders++;
      else if (t === "file") remapped.files++;
      else if (t === "skill") remapped.skills++;
      else if (t === "agent") remapped.agents++;
    } else if (a.action === "skipped") {
      if (t === "link") skipped.links++;
      else if (t === "note") skipped.notes++;
      else if (t === "folder") skipped.folders++;
      else if (t === "file") skipped.files++;
      else if (t === "skill") skipped.skills++;
      else if (t === "agent") skipped.agents++;
    }
  }

  return {
    collision_mode: collisionMode,
    created_counts: created,
    replaced_counts: replaced,
    duplicated_counts: duplicated,
    remapped_counts: remapped,
    skipped_counts: skipped,
    actions,
    warnings,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ImportInput {
  /** Raw file bytes. Either a .md or .zip. */
  buffer: Buffer;
  /** Original filename — used to detect type and extract title for .md files. */
  filename: string;
  /** 25 MB limit enforced here. */
  maxSizeBytes?: number;
}

export interface ImportTarget {
  /**
   * The target box id. Required for notes/files/folders.
   * For reusable skill/agent packages, may be null (objects go to workspace library).
   */
  boxId: string | null;
  /** Optional folder to import into. Must belong to the box. */
  targetFolderId?: string | null;
}

/**
 * Parse and apply an import package to the target box.
 *
 * @throws Error on hard failures (malformed zip, invalid manifest, bounds exceeded, ownership violation)
 * @returns ImportSummaryReport on success (may include warnings)
 */
export async function importPackage(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  input: ImportInput,
  target: ImportTarget,
  collisionMode: CollisionMode
): Promise<ImportSummaryReport> {
  const maxSize = input.maxSizeBytes ?? 25 * 1024 * 1024;
  if (input.buffer.length > maxSize) {
    throw new Error(
      `Package size ${input.buffer.length} bytes exceeds the ${maxSize / 1024 / 1024} MB limit.`
    );
  }

  // Verify supported collision mode
  const validModes: CollisionMode[] = [
    "create_copy",
    "replace_by_id",
    "merge_metadata_only",
    "remap_ids_and_import",
  ];
  if (!validModes.includes(collisionMode)) {
    throw new Error(`Unsupported collision mode: "${collisionMode}"`);
  }

  // Verify ownership of target box (if provided)
  if (target.boxId) {
    const box = await getBoxById(supabase, target.boxId);
    if (!box || box.workspace_id !== workspaceId) {
      throw new Error("Target box not found or not owned by this workspace.");
    }

    // Verify target folder (if provided) belongs to the box
    if (target.targetFolderId) {
      const folder = await getFolderById(supabase, target.targetFolderId);
      if (!folder || folder.box_id !== target.boxId) {
        throw new Error("Target folder not found or does not belong to the target box.");
      }
    }
  }

  const actions: ImportAction[] = [];
  const warnings: ImportWarning[] = [];

  const isMd =
    input.filename.toLowerCase().endsWith(".md") ||
    input.filename.toLowerCase() === "md";
  const isZip =
    input.filename.toLowerCase().endsWith(".zip") ||
    (!isMd && input.buffer[0] === 0x50 && input.buffer[1] === 0x4b); // PK magic bytes

  if (isMd) {
    if (!target.boxId) {
      throw new Error("A target box is required when importing a single markdown file.");
    }
    const content = input.buffer.toString("utf-8");
    await importSingleMarkdown(
      supabase,
      target.boxId,
      target.targetFolderId ?? null,
      input.filename,
      content,
      actorId,
      actions,
      warnings
    );
  } else if (isZip) {
    const parsed = await parseZipBuffer(input.buffer);
    warnings.push(...parsed.warnings);

    if (parsed.manifest) {
      await applyManifest(
        supabase,
        workspaceId,
        target.boxId,
        target.targetFolderId ?? null,
        parsed.manifest,
        parsed.markdownFiles,
        parsed.sourceFiles,
        collisionMode,
        actorId,
        actions,
        warnings
      );
    } else {
      // No manifest — import each markdown file as a note (requires box)
      if (!target.boxId) {
        throw new Error("A target box is required when importing a zip without a manifest.");
      }
      for (const [filename, content] of parsed.markdownFiles) {
        await importSingleMarkdown(
          supabase,
          target.boxId,
          target.targetFolderId ?? null,
          filename,
          content,
          actorId,
          actions,
          warnings
        );
      }
    }
  } else {
    throw new Error(
      "Unsupported file type. Only .md and .zip files are supported for import."
    );
  }

  return buildSummary(collisionMode, actions, warnings);
}
