import { createHash } from "node:crypto";
import { buildZip } from "@/lib/zip";
import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import { type Folder } from "@/server/domain/types/folder";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type Box } from "@/server/domain/types/box";
import {
  type ExportManifest,
  type ExportPackage,
  type ManifestNote,
  type ManifestFolder,
  type ManifestLink,
  type ManifestBundle,
  type ExportOptions,
  type BundleExportOptions,
} from "@/server/domain/types/import_export";
import { getNoteById, listAllNotesByBox, getNotesByIds } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { getFolderById, listAllFoldersByBox } from "@/server/repositories/folder_repository";
import { listLinksForNoteSet } from "@/server/repositories/note_link_repository";
import { assembleContextBundle } from "@/server/services/context_bundle_service";

/**
 * Export service.
 *
 * Assembles in-memory ExportPackage objects for note, folder, box, and context
 * bundle exports. Does not zip — callers zip and deliver.
 *
 * Ownership verification is always done inside this service. Pages and actions
 * must not bypass it.
 *
 * Export rules:
 *   - Trashed content: never included
 *   - Archived content: excluded by default (opt-in via includeArchived)
 *   - Relationship types: preserved exactly as stored
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "note"
  );
}

function noteFilePath(note: Note, prefix = "notes"): string {
  return `${prefix}/${note.path_cache.replace(/\//g, "_")}.md`;
}

function toManifestNote(note: Note, isGuideNote: boolean): ManifestNote {
  return {
    id: note.id,
    folder_id: note.folder_id,
    title: note.title,
    slug: note.slug,
    path: note.path_cache,
    status: note.status,
    summary: note.summary,
    tags: note.tags,
    origin_type: note.origin_type,
    read_hint: note.read_hint,
    is_generated: note.is_generated,
    current_version_id: note.current_version_id,
    is_guide_note: isGuideNote,
    content_sha256: sha256(note.markdown_content),
    file_path: noteFilePath(note),
  };
}

function toManifestFolder(folder: Folder): ManifestFolder {
  return {
    id: folder.id,
    parent_id: folder.parent_folder_id,
    name: folder.name,
    slug: folder.slug,
    path: folder.path_cache,
    status: folder.status,
    description: folder.description,
  };
}

function toManifestLink(link: NoteLink): ManifestLink {
  return {
    id: link.id,
    source_note_id: link.source_note_id,
    target_note_id: link.target_note_id,
    relationship_type: link.relationship_type,
    relationship_note: null,
  };
}

function buildNoteMarkdown(note: Note): string {
  const lines: string[] = [];
  lines.push(`# ${note.title}`);
  lines.push("");
  if (note.summary) {
    lines.push(`> ${note.summary}`);
    lines.push("");
  }
  if (note.tags.length > 0) {
    lines.push(`**Tags:** ${note.tags.join(", ")}`);
    lines.push("");
  }
  lines.push(note.markdown_content || "");
  return lines.join("\n");
}

function buildManifestJson(manifest: ExportManifest): string {
  return JSON.stringify(manifest, null, 2);
}

// ─── Collect folder subtree ───────────────────────────────────────────────────

/**
 * Given a root folder id, collect all descendant folders (including itself)
 * from the provided full folder list.
 */
function collectDescendantFolders(
  allFolders: Folder[],
  rootFolderId: string
): Folder[] {
  const result: Folder[] = [];
  const visited = new Set<string>();
  const queue = [rootFolderId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const folder = allFolders.find((f) => f.id === id);
    if (folder) {
      result.push(folder);
      // Add children
      for (const child of allFolders) {
        if (child.parent_folder_id === id) {
          queue.push(child.id);
        }
      }
    }
  }

  return result;
}

// ─── Export: note ─────────────────────────────────────────────────────────────

/**
 * Export a single note as a minimal package.
 * Verifies workspace ownership via the note's box.
 */
export async function exportNote(
  supabase: SupabaseClient,
  workspaceId: string,
  noteId: string,
  _options: ExportOptions = {}
): Promise<ExportPackage> {
  const note = await getNoteById(supabase, noteId);
  if (!note) throw new Error("Note not found");

  const box = await getBoxById(supabase, note.box_id);
  if (!box || box.workspace_id !== workspaceId) throw new Error("Not found");

  const isGuideNote = box.guide_note_id === noteId;
  const manifestNote = toManifestNote(note, isGuideNote);
  const filePath = noteFilePath(note);

  const manifest: ExportManifest = {
    schema_version: "1.0",
    export_type: "note",
    exported_at: new Date().toISOString(),
    workspace: { id: box.workspace_id, name: "" },
    box: null,
    root: null,
    folders: [],
    notes: [manifestNote],
    links: [],
    bundle: null,
    files: [filePath],
    counts: { folders: 0, notes: 1, links: 0, files: 1 },
  };

  const files: Record<string, string> = {
    "manifest.json": buildManifestJson(manifest),
    [filePath]: buildNoteMarkdown(note),
  };

  return {
    filename: `${slugify(note.title)}.zip`,
    files,
    manifest,
  };
}

// ─── Export: folder ───────────────────────────────────────────────────────────

/**
 * Export a folder and all its descendants (sub-folders + notes).
 * Only links where both endpoints are inside the exported note set are included.
 */
export async function exportFolder(
  supabase: SupabaseClient,
  workspaceId: string,
  folderId: string,
  options: ExportOptions = {}
): Promise<ExportPackage> {
  const rootFolder = await getFolderById(supabase, folderId);
  if (!rootFolder) throw new Error("Folder not found");

  const box = await getBoxById(supabase, rootFolder.box_id);
  if (!box || box.workspace_id !== workspaceId) throw new Error("Not found");

  const { includeArchived = false } = options;

  // Collect all folders in the box, then filter to this subtree
  const allBoxFolders = await listAllFoldersByBox(supabase, box.id, { includeArchived });
  const exportFolders = collectDescendantFolders(allBoxFolders, folderId);
  const exportFolderIds = new Set(exportFolders.map((f) => f.id));

  // Collect all notes in box, filter to those inside the subtree
  const allBoxNotes = await listAllNotesByBox(supabase, box.id, { includeArchived });
  const exportNotes = allBoxNotes.filter(
    (n) => n.folder_id !== null && exportFolderIds.has(n.folder_id)
  );
  const exportNoteIds = new Set(exportNotes.map((n) => n.id));

  // Links where both endpoints are in the exported note set
  const allLinks = await listLinksForNoteSet(supabase, [...exportNoteIds]);
  const exportLinks = allLinks.filter(
    (l) => exportNoteIds.has(l.source_note_id) && exportNoteIds.has(l.target_note_id)
  );

  const manifestFolders = exportFolders.map(toManifestFolder);
  const manifestNotes = exportNotes.map((n) => toManifestNote(n, box.guide_note_id === n.id));
  const manifestLinks = exportLinks.map(toManifestLink);

  const noteFilePaths = exportNotes.map((n) => noteFilePath(n));

  const manifest: ExportManifest = {
    schema_version: "1.0",
    export_type: "folder",
    exported_at: new Date().toISOString(),
    workspace: { id: box.workspace_id, name: "" },
    box: { id: box.id, name: box.name, slug: box.slug },
    root: folderId,
    folders: manifestFolders,
    notes: manifestNotes,
    links: manifestLinks,
    bundle: null,
    files: noteFilePaths,
    counts: {
      folders: manifestFolders.length,
      notes: manifestNotes.length,
      links: manifestLinks.length,
      files: noteFilePaths.length,
    },
  };

  const files: Record<string, string> = {
    "manifest.json": buildManifestJson(manifest),
  };
  for (const note of exportNotes) {
    files[noteFilePath(note)] = buildNoteMarkdown(note);
  }

  return {
    filename: `${slugify(rootFolder.name)}-folder.zip`,
    files,
    manifest,
  };
}

// ─── Export: box ──────────────────────────────────────────────────────────────

/**
 * Export an entire box: all active folders, notes, and qualifying links.
 */
export async function exportBox(
  supabase: SupabaseClient,
  workspaceId: string,
  boxId: string,
  options: ExportOptions = {}
): Promise<ExportPackage> {
  const box = await getBoxById(supabase, boxId);
  if (!box || box.workspace_id !== workspaceId) throw new Error("Not found");

  const { includeArchived = false } = options;

  const [allFolders, allNotes] = await Promise.all([
    listAllFoldersByBox(supabase, boxId, { includeArchived }),
    listAllNotesByBox(supabase, boxId, { includeArchived }),
  ]);

  const exportNoteIds = new Set(allNotes.map((n) => n.id));
  const allLinks = await listLinksForNoteSet(supabase, [...exportNoteIds]);
  const exportLinks = allLinks.filter(
    (l) => exportNoteIds.has(l.source_note_id) && exportNoteIds.has(l.target_note_id)
  );

  const manifestFolders = allFolders.map(toManifestFolder);
  const manifestNotes = allNotes.map((n) => toManifestNote(n, box.guide_note_id === n.id));
  const manifestLinks = exportLinks.map(toManifestLink);
  const noteFilePaths = allNotes.map((n) => noteFilePath(n));

  const manifest: ExportManifest = {
    schema_version: "1.0",
    export_type: "box",
    exported_at: new Date().toISOString(),
    workspace: { id: box.workspace_id, name: "" },
    box: { id: box.id, name: box.name, slug: box.slug },
    root: null,
    folders: manifestFolders,
    notes: manifestNotes,
    links: manifestLinks,
    bundle: null,
    files: noteFilePaths,
    counts: {
      folders: manifestFolders.length,
      notes: manifestNotes.length,
      links: manifestLinks.length,
      files: noteFilePaths.length,
    },
  };

  const files: Record<string, string> = {
    "manifest.json": buildManifestJson(manifest),
  };
  for (const note of allNotes) {
    files[noteFilePath(note)] = buildNoteMarkdown(note);
  }

  return {
    filename: `${slugify(box.name)}-box.zip`,
    files,
    manifest,
  };
}

// ─── Export: context bundle ───────────────────────────────────────────────────

/**
 * Export a context bundle for a note.
 *
 * Uses assembleContextBundle as the source of truth for which notes are
 * included and in what order. Fetches full markdown bodies separately.
 * Does not mutate the ContextBundle output shape.
 *
 * Package includes:
 *   - manifest.json
 *   - README.md (suggested upload order)
 *   - entry note markdown
 *   - guide note markdown (if included)
 *   - ancestor summary note markdown (if included)
 *   - linked notes markdown (in bundle order)
 */
export async function exportBundle(
  supabase: SupabaseClient,
  workspaceId: string,
  noteId: string,
  options: BundleExportOptions = {}
): Promise<ExportPackage> {
  // Assemble bundle for metadata and selection
  const bundle = await assembleContextBundle(supabase, workspaceId, noteId, {
    includeGuide: options.includeGuide ?? true,
    includeAncestorSummary: options.includeAncestorSummary ?? true,
    linkedLimit: options.linkedLimit ?? 10,
    includeArchived: options.includeArchived ?? false,
  });

  const box = bundle.box;

  // Collect all note ids in the bundle
  const allBundleNoteIds = [
    bundle.target_note.id,
    ...(bundle.guide_note ? [bundle.guide_note.id] : []),
    ...(bundle.ancestor_summary_note ? [bundle.ancestor_summary_note.id] : []),
    ...bundle.linked_notes.map((n) => n.id),
  ];

  // Fetch full note objects (with markdown_content)
  const fullNotes = await getNotesByIds(supabase, allBundleNoteIds);
  const noteMap = new Map(fullNotes.map((n) => [n.id, n]));

  // Build the README upload order
  const uploadOrder: string[] = [];
  if (bundle.guide_note && noteMap.has(bundle.guide_note.id)) {
    uploadOrder.push(`1. **Guide note**: ${bundle.guide_note.title}`);
  }
  uploadOrder.push(`${bundle.guide_note ? "2" : "1"}. **Entry note**: ${bundle.target_note.title}`);
  let idx = uploadOrder.length + 1;
  if (bundle.ancestor_summary_note && noteMap.has(bundle.ancestor_summary_note.id)) {
    uploadOrder.push(`${idx++}. **Ancestor summary**: ${bundle.ancestor_summary_note.title}`);
  }
  for (const ln of bundle.linked_notes) {
    if (noteMap.has(ln.id)) {
      uploadOrder.push(`${idx++}. **Linked note** (${ln.relationship_type}): ${ln.title}`);
    }
  }

  const readmeContent = [
    `# Context Bundle: ${bundle.target_note.title}`,
    "",
    `Box: **${box.name}**`,
    `Exported: ${new Date().toLocaleString()}`,
    "",
    "## Suggested upload order",
    "",
    "When importing these notes into another system, upload in the order below",
    "so that orientation notes are available before dependent content:",
    "",
    ...uploadOrder,
    "",
    "## Notes in this bundle",
    "",
    `- **Entry note**: ${bundle.target_note.title}`,
    ...(bundle.guide_note ? [`- **Guide note**: ${bundle.guide_note.title}`] : []),
    ...(bundle.ancestor_summary_note
      ? [`- **Ancestor summary**: ${bundle.ancestor_summary_note.title}`]
      : []),
    ...bundle.linked_notes.map(
      (ln) => `- **Linked** (${ln.direction}, ${ln.relationship_type}): ${ln.title}`
    ),
    "",
    bundle.truncated
      ? `> ⚠️ Bundle is partial. Reasons: ${bundle.truncation_reasons.join(", ")}`
      : "> Bundle includes all qualifying notes within the configured limits.",
  ].join("\n");

  // Build manifest notes/links
  const manifestNotes: ManifestNote[] = [];
  const files: Record<string, string> = {};

  function addNote(note: Note, prefix = "notes"): string {
    const fp = noteFilePath(note, prefix);
    const isGuide = box.guide_note_id === note.id;
    manifestNotes.push({
      id: note.id,
      folder_id: note.folder_id,
      title: note.title,
      slug: note.slug,
      path: note.path_cache,
      status: note.status,
      summary: note.summary,
      tags: note.tags,
      origin_type: note.origin_type,
      read_hint: note.read_hint,
      is_generated: note.is_generated,
      current_version_id: note.current_version_id,
      is_guide_note: isGuide,
      content_sha256: sha256(note.markdown_content),
      file_path: fp,
    });
    files[fp] = buildNoteMarkdown(note);
    return fp;
  }

  // Add notes in bundle order
  const entryNote = noteMap.get(bundle.target_note.id);
  if (entryNote) addNote(entryNote, "notes");

  if (bundle.guide_note) {
    const gn = noteMap.get(bundle.guide_note.id);
    if (gn) addNote(gn, "notes");
  }

  if (bundle.ancestor_summary_note) {
    const an = noteMap.get(bundle.ancestor_summary_note.id);
    if (an) addNote(an, "notes");
  }

  for (const ln of bundle.linked_notes) {
    const n = noteMap.get(ln.id);
    if (n) addNote(n, "notes");
  }

  // Links: only edges between included notes
  const includedIds = new Set(allBundleNoteIds);
  const bundleLinks = await listLinksForNoteSet(supabase, [...includedIds]);
  const exportLinks = bundleLinks.filter(
    (l) => includedIds.has(l.source_note_id) && includedIds.has(l.target_note_id)
  );
  const manifestLinks: ManifestLink[] = exportLinks.map(toManifestLink);

  const bundleManifest: ManifestBundle = {
    entry_note_id: bundle.target_note.id,
    guide_note_id: bundle.guide_note?.id ?? null,
    ancestor_summary_note_id: bundle.ancestor_summary_note?.id ?? null,
    included_note_ids: allBundleNoteIds,
    linked_limit: bundle.assembly_metadata.linked_limit,
    truncated: bundle.truncated,
    truncation_reasons: bundle.truncation_reasons,
  };

  const noteFilePaths = Object.keys(files);

  const manifest: ExportManifest = {
    schema_version: "1.0",
    export_type: "bundle",
    exported_at: new Date().toISOString(),
    workspace: { id: box.workspace_id, name: "" },
    box: { id: box.id, name: box.name, slug: box.slug },
    root: null,
    folders: [],
    notes: manifestNotes,
    links: manifestLinks,
    bundle: bundleManifest,
    files: noteFilePaths,
    counts: {
      folders: 0,
      notes: manifestNotes.length,
      links: manifestLinks.length,
      files: noteFilePaths.length,
    },
  };

  files["manifest.json"] = buildManifestJson(manifest);
  files["README.md"] = readmeContent;

  return {
    filename: `bundle-${slugify(bundle.target_note.title)}.zip`,
    files,
    manifest,
  };
}

// ─── Zip packaging ────────────────────────────────────────────────────────────

/**
 * Convert an ExportPackage to a zip buffer.
 * Returns a Buffer suitable for sending as a file download.
 */
export function packageToZip(pkg: ExportPackage): Buffer {
  return buildZip(pkg.files);
}
