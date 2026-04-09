import { parseZip } from "@/lib/zip";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  type ExportManifest,
  type ManifestNote,
  type ManifestFolder,
  type ManifestLink,
  type CollisionMode,
  type ImportSummaryReport,
  type ImportAction,
  type ImportWarning,
} from "@/server/domain/types/import_export";
import { getBoxById } from "@/server/repositories/box_repository";
import { getFolderById, createFolder, updateFolder } from "@/server/repositories/folder_repository";
import { getNoteById, updateNote as repoUpdateNote } from "@/server/repositories/note_repository";
import { createNoteLink } from "@/server/repositories/note_link_repository";
import { getLatestVersionForNote, createNoteVersion } from "@/server/repositories/note_version_repository";
import { slugify } from "@/lib/slugify";

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
  /** filename → utf-8 content */
  markdownFiles: Map<string, string>;
  warnings: ImportWarning[];
}

// ─── Zip parsing ──────────────────────────────────────────────────────────────

async function parseZipBuffer(buffer: Buffer): Promise<ParsedPackage> {
  let allFiles: Map<string, string>;
  try {
    allFiles = parseZip(buffer);
  } catch (e) {
    throw new Error(`Malformed zip file — cannot parse: ${e instanceof Error ? e.message : String(e)}`);
  }

  const markdownFiles = new Map<string, string>();
  const warnings: ImportWarning[] = [];
  let manifest: ExportManifest | null = null;

  for (const [path, content] of allFiles) {
    const lower = path.toLowerCase();

    if (lower === "manifest.json" || lower.endsWith("/manifest.json")) {
      try {
        const parsed = JSON.parse(content) as ExportManifest;
        if (parsed.schema_version !== "1.0") {
          throw new Error(`Unsupported schema_version: ${parsed.schema_version}`);
        }
        manifest = parsed;
      } catch (e) {
        throw new Error(`Invalid manifest.json: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (lower.endsWith(".md")) {
      markdownFiles.set(path, content);
    } else if (lower === "readme.md" || lower.endsWith("/readme.md")) {
      // README is informational — skip silently
    } else if (!lower.endsWith("/")) {
      // Non-directory, non-recognized file
      warnings.push({
        code: "unsupported_file_type",
        message: `File ignored — only .md and manifest.json are supported.`,
        subject: path,
      });
    }
  }

  return { manifest, markdownFiles, warnings };
}

function parseSingleMarkdown(content: string, filename: string): ParsedPackage {
  const markdownFiles = new Map([[filename, content]]);
  return { manifest: null, markdownFiles, warnings: [] };
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
    originType,
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
    originType: string;
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
  });

  if (error || !data) throw new Error(error?.message ?? "Failed to create note");

  // Override origin_type to 'imported' (the RPC defaults to 'human')
  const noteId = (data as { note: { id: string } }).note.id;
  await supabase.from("notes").update({ origin_type: originType }).eq("id", noteId);

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
    originType: "imported",
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
 * Apply a parsed manifest + markdown files to the target box using the
 * specified collision mode.
 *
 * Returns actions and warnings arrays (mutated throughout).
 */
async function applyManifest(
  supabase: SupabaseClient,
  boxId: string,
  targetFolderId: string | null,
  manifest: ExportManifest,
  markdownFiles: Map<string, string>,
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
  const noteIdMap = new Map<string, string>();

  for (const mn of manifest.notes) {
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

    // Check for existing link to avoid duplicate
    const { data: existingLink } = await supabase
      .from("note_links")
      .select("id")
      .eq("source_note_id", finalSource)
      .eq("target_note_id", finalTarget)
      .eq("relationship_type", ml.relationship_type)
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
        relationship_type: ml.relationship_type as never,
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
        readHint: mn.read_hint,
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
          readHint: mn.read_hint,
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
        readHint: mn.read_hint,
        originType: "imported",
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
    originType: "imported",
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

// ─── Build summary report ─────────────────────────────────────────────────────

function buildSummary(
  collisionMode: CollisionMode,
  actions: ImportAction[],
  warnings: ImportWarning[]
): ImportSummaryReport {
  const created = { folders: 0, notes: 0, links: 0 };
  const replaced = { notes: 0, folders: 0 };
  const duplicated = { notes: 0, folders: 0 };
  const remapped = { notes: 0, folders: 0 };
  const skipped = { notes: 0, folders: 0, links: 0 };

  for (const a of actions) {
    const type = a.object_type as "note" | "folder" | "link";
    if (a.action === "created") {
      if (type === "link") created.links++;
      else if (type === "note") created.notes++;
      else if (type === "folder") created.folders++;
    } else if (a.action === "replaced") {
      if (type === "note") replaced.notes++;
      else if (type === "folder") replaced.folders++;
    } else if (a.action === "duplicated") {
      if (type === "note") duplicated.notes++;
      else if (type === "folder") duplicated.folders++;
    } else if (a.action === "remapped") {
      if (type === "note") remapped.notes++;
      else if (type === "folder") remapped.folders++;
    } else if (a.action === "skipped") {
      if (type === "link") skipped.links++;
      else if (type === "note") skipped.notes++;
      else if (type === "folder") skipped.folders++;
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
  boxId: string;
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

  // Verify ownership of target box
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

  const actions: ImportAction[] = [];
  const warnings: ImportWarning[] = [];

  const isMd =
    input.filename.toLowerCase().endsWith(".md") ||
    input.filename.toLowerCase() === "md";
  const isZip =
    input.filename.toLowerCase().endsWith(".zip") ||
    (!isMd && input.buffer[0] === 0x50 && input.buffer[1] === 0x4b); // PK magic bytes

  if (isMd) {
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
        target.boxId,
        target.targetFolderId ?? null,
        parsed.manifest,
        parsed.markdownFiles,
        collisionMode,
        actorId,
        actions,
        warnings
      );
    } else {
      // No manifest — import each markdown file as a note
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
