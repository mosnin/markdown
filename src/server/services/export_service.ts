import { createHash } from "node:crypto";
import { buildZip } from "@/lib/zip";
import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import { type Folder } from "@/server/domain/types/folder";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type Box } from "@/server/domain/types/box";
import { type File } from "@/server/domain/types/file";
import { type Skill } from "@/server/domain/types/skill";
import { type Agent } from "@/server/domain/types/agent";
import {
  type ExportManifest,
  type ExportPackage,
  type RawExportContent,
  type ManifestNote,
  type ManifestFolder,
  type ManifestLink,
  type ManifestBundle,
  type ManifestFile,
  type ManifestSkill,
  type ManifestAgent,
  type ManifestObjectLink,
  type ExportOptions,
  type BundleExportOptions,
  type ExportMode,
} from "@/server/domain/types/import_export";
import { getNoteById, listAllNotesByBox, getNotesByIds } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { getFolderById, listAllFoldersByBox } from "@/server/repositories/folder_repository";
import { listLinksForNoteSet } from "@/server/repositories/note_link_repository";
import { getFileById, listAllFilesByBox } from "@/server/repositories/file_repository";
import { getSkillById, listSkillsByBox } from "@/server/repositories/skill_repository";
import { getAgentById, listAgentsByBox } from "@/server/repositories/agent_repository";
import { getAllObjectLinksForObject } from "@/server/repositories/object_link_repository";
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
    relationship_note: link.relationship_note,
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
    counts: { folders: 0, notes: 1, links: 0, files: 1, skills: 0, agents: 0 },
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
  if (!rootFolder.box_id) throw new Error("Folder has no box");

  const box = await getBoxById(supabase, rootFolder.box_id!);
  if (!box || box.workspace_id !== workspaceId) throw new Error("Not found");

  const { includeArchived = false } = options;

  // Collect all folders in the box, then filter to this subtree.
  // Exports are canonical (main-only) by design — no branchId threaded.
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

  // Collect all files, skills, and agents in the box, then filter to subtree
  const [allBoxFiles, allBoxSkills, allBoxAgents] = await Promise.all([
    listAllFilesByBox(supabase, box.id, { includeArchived }),
    listSkillsByBox(supabase, box.id, { includeArchived }),
    listAgentsByBox(supabase, box.id, { includeArchived }),
  ]);

  const subtreeFiles = allBoxFiles.filter(
    (f) => f.folder_id !== null && exportFolderIds.has(f.folder_id)
  );
  const subtreeSkills = allBoxSkills.filter(
    (s) => s.folder_id !== null && exportFolderIds.has(s.folder_id)
  );
  const subtreeAgents = allBoxAgents.filter(
    (a) => a.folder_id !== null && exportFolderIds.has(a.folder_id)
  );

  const manifestFolders = exportFolders.map(toManifestFolder);
  const manifestNotes = exportNotes.map((n) =>
    toManifestNote(n, box.guide_note_id === n.id)
  );
  const manifestLinks = exportLinks.map(toManifestLink);
  const manifestFiles = subtreeFiles.map(toManifestFile);
  const manifestSkills = subtreeSkills.map(toManifestSkill);
  const manifestAgents = subtreeAgents.map(toManifestAgent);

  // Populate cross-type object_links within the exported subtree
  const known = new Set<string>([
    ...exportNotes.map((n) => `note:${n.id}`),
    ...exportFolders.map((f) => `folder:${f.id}`),
    ...subtreeFiles.map((f) => `file:${f.id}`),
    ...subtreeSkills.map((s) => `skill:${s.id}`),
    ...subtreeAgents.map((a) => `agent:${a.id}`),
  ]);
  const objectLinks: ManifestObjectLink[] = [];
  const linkSeen = new Set<string>();
  const linkSources: Array<{ type: "skill" | "agent" | "file"; id: string }> = [
    ...subtreeSkills.map((s) => ({ type: "skill" as const, id: s.id })),
    ...subtreeAgents.map((a) => ({ type: "agent" as const, id: a.id })),
    ...subtreeFiles.map((f) => ({ type: "file" as const, id: f.id })),
  ];
  for (const src of linkSources) {
    const links = await collectObjectLinksForExport(supabase, workspaceId, src, known);
    for (const l of links) {
      if (linkSeen.has(l.id)) continue;
      linkSeen.add(l.id);
      objectLinks.push(l);
    }
  }

  const noteFilePaths = exportNotes.map((n) => noteFilePath(n));
  const objectFilePaths = [
    ...manifestFiles.map((f) => f.file_path),
    ...manifestSkills.map((s) => s.file_path),
    ...manifestAgents.map((a) => a.file_path),
  ];
  const allFilePaths = [...noteFilePaths, ...objectFilePaths];

  const schemaVersion: "1.0" | "1.1" =
    manifestFiles.length + manifestSkills.length + manifestAgents.length > 0
      ? "1.1"
      : "1.0";

  const manifest: ExportManifest = {
    schema_version: schemaVersion,
    export_type: "folder",
    exported_at: new Date().toISOString(),
    workspace: { id: box.workspace_id, name: "" },
    box: { id: box.id, name: box.name, slug: box.slug },
    root: folderId,
    folders: manifestFolders,
    notes: manifestNotes,
    links: manifestLinks,
    bundle: null,
    files: allFilePaths,
    counts: {
      folders: manifestFolders.length,
      notes: manifestNotes.length,
      links: manifestLinks.length,
      files: allFilePaths.length,
      skills: manifestSkills.length,
      agents: manifestAgents.length,
    },
    object_files: manifestFiles,
    skills: manifestSkills,
    agents: manifestAgents,
    object_links: objectLinks,
  };

  const files: Record<string, string> = {
    "manifest.json": buildManifestJson(manifest),
  };
  for (const note of exportNotes) {
    files[noteFilePath(note)] = buildNoteMarkdown(note);
  }
  for (let i = 0; i < subtreeFiles.length; i++) {
    files[manifestFiles[i].file_path] = subtreeFiles[i].source_content;
  }
  for (let i = 0; i < subtreeSkills.length; i++) {
    files[manifestSkills[i].file_path] = subtreeSkills[i].source_content;
  }
  for (let i = 0; i < subtreeAgents.length; i++) {
    files[manifestAgents[i].file_path] = subtreeAgents[i].source_content;
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

  // Exports are canonical (main-only) by design — no branchId threaded.
  const [allFolders, allNotes, allFiles, allSkills, allAgents] = await Promise.all([
    listAllFoldersByBox(supabase, boxId, { includeArchived }),
    listAllNotesByBox(supabase, boxId, { includeArchived }),
    listAllFilesByBox(supabase, boxId, { includeArchived }),
    listSkillsByBox(supabase, boxId, { includeArchived }),
    listAgentsByBox(supabase, boxId, { includeArchived }),
  ]);

  const exportNoteIds = new Set(allNotes.map((n) => n.id));
  const allLinks = await listLinksForNoteSet(supabase, [...exportNoteIds]);
  const exportLinks = allLinks.filter(
    (l) => exportNoteIds.has(l.source_note_id) && exportNoteIds.has(l.target_note_id)
  );

  const manifestFolders = allFolders.map(toManifestFolder);
  const manifestNotes = allNotes.map((n) => toManifestNote(n, box.guide_note_id === n.id));
  const manifestLinks = exportLinks.map(toManifestLink);
  const manifestFiles = allFiles.map(toManifestFile);
  const manifestSkills = allSkills.map(toManifestSkill);
  const manifestAgents = allAgents.map(toManifestAgent);

  // Collect cross-type object_links within the box
  const known = new Set<string>([
    ...allNotes.map((n) => `note:${n.id}`),
    ...allFolders.map((f) => `folder:${f.id}`),
    ...allFiles.map((f) => `file:${f.id}`),
    ...allSkills.map((s) => `skill:${s.id}`),
    ...allAgents.map((a) => `agent:${a.id}`),
  ]);
  const objectLinks: ManifestObjectLink[] = [];
  const linkSeen = new Set<string>();
  const linkSources: Array<{ type: "skill" | "agent" | "file"; id: string }> = [
    ...allSkills.map((s) => ({ type: "skill" as const, id: s.id })),
    ...allAgents.map((a) => ({ type: "agent" as const, id: a.id })),
    ...allFiles.map((f) => ({ type: "file" as const, id: f.id })),
  ];
  for (const src of linkSources) {
    const links = await collectObjectLinksForExport(supabase, workspaceId, src, known);
    for (const l of links) {
      if (linkSeen.has(l.id)) continue;
      linkSeen.add(l.id);
      objectLinks.push(l);
    }
  }

  const noteFilePaths = allNotes.map((n) => noteFilePath(n));
  const objectFilePaths = [
    ...manifestFiles.map((f) => f.file_path),
    ...manifestSkills.map((s) => s.file_path),
    ...manifestAgents.map((a) => a.file_path),
  ];
  const allFilePaths = [...noteFilePaths, ...objectFilePaths];

  const schemaVersion: "1.0" | "1.1" =
    manifestFiles.length + manifestSkills.length + manifestAgents.length > 0
      ? "1.1"
      : "1.0";

  const manifest: ExportManifest = {
    schema_version: schemaVersion,
    export_type: "box",
    exported_at: new Date().toISOString(),
    workspace: { id: box.workspace_id, name: "" },
    box: { id: box.id, name: box.name, slug: box.slug },
    root: null,
    folders: manifestFolders,
    notes: manifestNotes,
    links: manifestLinks,
    bundle: null,
    files: allFilePaths,
    counts: {
      folders: manifestFolders.length,
      notes: manifestNotes.length,
      links: manifestLinks.length,
      files: allFilePaths.length,
      skills: manifestSkills.length,
      agents: manifestAgents.length,
    },
    object_files: manifestFiles,
    skills: manifestSkills,
    agents: manifestAgents,
    object_links: objectLinks,
  };

  const files: Record<string, string> = {
    "manifest.json": buildManifestJson(manifest),
  };
  for (const note of allNotes) {
    files[noteFilePath(note)] = buildNoteMarkdown(note);
  }
  for (let i = 0; i < allFiles.length; i++) {
    files[manifestFiles[i].file_path] = allFiles[i].source_content;
  }
  for (let i = 0; i < allSkills.length; i++) {
    files[manifestSkills[i].file_path] = allSkills[i].source_content;
  }
  for (let i = 0; i < allAgents.length; i++) {
    files[manifestAgents[i].file_path] = allAgents[i].source_content;
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
      skills: 0,
      agents: 0,
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

// ─── Source format → file extension map ──────────────────────────────────────

const FORMAT_EXTENSION: Record<string, string> = {
  markdown: ".md",
  json: ".json",
  yaml: ".yaml",
  typescript: ".ts",
  python: ".py",
  javascript: ".js",
  shell: ".sh",
  sql: ".sql",
  html: ".html",
  css: ".css",
  toml: ".toml",
  xml: ".xml",
  plain_text: ".txt",
};

const FORMAT_MIME: Record<string, string> = {
  markdown: "text/markdown",
  json: "application/json",
  yaml: "text/yaml",
  typescript: "text/x-typescript",
  python: "text/x-python",
  javascript: "text/javascript",
  shell: "text/x-shellscript",
  sql: "application/sql",
  html: "text/html",
  css: "text/css",
  toml: "text/x-toml",
  xml: "application/xml",
  plain_text: "text/plain",
};

function sourceFormatExtension(format: string): string {
  return FORMAT_EXTENSION[format] ?? ".txt";
}

function sourceFormatMime(format: string): string {
  return FORMAT_MIME[format] ?? "text/plain";
}

function emptyV11Fields(): { object_files: ManifestFile[]; skills: ManifestSkill[]; agents: ManifestAgent[]; object_links: ManifestObjectLink[] } {
  return { object_files: [], skills: [], agents: [], object_links: [] };
}

// ─── Child-object collection helpers (skills and agents as packages) ─────────

/**
 * Collect all files and folders owned by a skill, traversing the
 * `parent_skill_id` FK chain. Folders owned directly by the skill AND any
 * nested descendant folders (owned by those folders) are included. Files
 * are collected both by direct `parent_skill_id` FK and by `folder_id`
 * pointing into one of the collected folders.
 */
async function collectSkillPackageContents(
  supabase: SupabaseClient,
  workspaceId: string,
  skillId: string
): Promise<{ folders: Folder[]; files: File[] }> {
  // Step 1: direct child folders — folders.parent_skill_id = skillId
  const { data: directFoldersData } = await supabase
    .from("folders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("parent_skill_id", skillId)
    .neq("status", "trashed");
  const directFolders = (directFoldersData ?? []) as Folder[];

  // Step 2: recursively walk folder subtree using parent_folder_id
  const allFolders: Folder[] = [...directFolders];
  const seenFolderIds = new Set(directFolders.map((f) => f.id));
  const queue = [...directFolders.map((f) => f.id)];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const { data: children } = await supabase
      .from("folders")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("parent_folder_id", parentId)
      .neq("status", "trashed");
    for (const child of (children ?? []) as Folder[]) {
      if (seenFolderIds.has(child.id)) continue;
      seenFolderIds.add(child.id);
      allFolders.push(child);
      queue.push(child.id);
    }
  }

  // Step 3: direct child files — files.parent_skill_id = skillId
  const { data: directFiles } = await supabase
    .from("files")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("parent_skill_id", skillId)
    .neq("status", "trashed");
  const files: File[] = [...((directFiles ?? []) as File[])];

  // Step 4: files inside any collected folder — files.folder_id IN collected
  if (allFolders.length > 0) {
    const folderIds = allFolders.map((f) => f.id);
    const { data: folderFiles } = await supabase
      .from("files")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("folder_id", folderIds)
      .neq("status", "trashed");
    const seenFileIds = new Set(files.map((f) => f.id));
    for (const file of (folderFiles ?? []) as File[]) {
      if (seenFileIds.has(file.id)) continue;
      seenFileIds.add(file.id);
      files.push(file);
    }
  }

  return { folders: allFolders, files };
}

/**
 * Collect all files and folders owned by an agent via `parent_agent_id`.
 * Mirrors collectSkillPackageContents but scoped to agents.
 */
async function collectAgentPackageContents(
  supabase: SupabaseClient,
  workspaceId: string,
  agentId: string
): Promise<{ folders: Folder[]; files: File[] }> {
  const { data: directFoldersData } = await supabase
    .from("folders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("parent_agent_id", agentId)
    .neq("status", "trashed");
  const directFolders = (directFoldersData ?? []) as Folder[];

  const allFolders: Folder[] = [...directFolders];
  const seenFolderIds = new Set(directFolders.map((f) => f.id));
  const queue = [...directFolders.map((f) => f.id)];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const { data: children } = await supabase
      .from("folders")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("parent_folder_id", parentId)
      .neq("status", "trashed");
    for (const child of (children ?? []) as Folder[]) {
      if (seenFolderIds.has(child.id)) continue;
      seenFolderIds.add(child.id);
      allFolders.push(child);
      queue.push(child.id);
    }
  }

  const { data: directFiles } = await supabase
    .from("files")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("parent_agent_id", agentId)
    .neq("status", "trashed");
  const files: File[] = [...((directFiles ?? []) as File[])];

  if (allFolders.length > 0) {
    const folderIds = allFolders.map((f) => f.id);
    const { data: folderFiles } = await supabase
      .from("files")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("folder_id", folderIds)
      .neq("status", "trashed");
    const seenFileIds = new Set(files.map((f) => f.id));
    for (const file of (folderFiles ?? []) as File[]) {
      if (seenFileIds.has(file.id)) continue;
      seenFileIds.add(file.id);
      files.push(file);
    }
  }

  return { folders: allFolders, files };
}

/** Fetch outgoing object_links for a given object id, filtered to a known
 *  set of target object references. The target filter prevents manifests
 *  from referring to objects that are not in the package. */
async function collectObjectLinksForExport(
  supabase: SupabaseClient,
  workspaceId: string,
  source: { type: "skill" | "agent" | "folder" | "file" | "note"; id: string },
  knownTargets: Set<string> // format `${type}:${id}`
): Promise<ManifestObjectLink[]> {
  const links = await getAllObjectLinksForObject(
    supabase,
    workspaceId,
    source.type,
    source.id
  );
  const result: ManifestObjectLink[] = [];
  for (const l of links) {
    const sourceKey = `${l.source_object_type}:${l.source_object_id}`;
    const targetKey = `${l.target_object_type}:${l.target_object_id}`;
    // Only include the edge if both endpoints are known (in the package)
    if (!knownTargets.has(sourceKey) || !knownTargets.has(targetKey)) continue;
    result.push({
      id: l.id,
      source_type: l.source_object_type,
      source_id: l.source_object_id,
      target_type: l.target_object_type,
      target_id: l.target_object_id,
      relationship_type: l.relationship_type,
      relationship_note: l.relationship_note,
    });
  }
  return result;
}

/** Build a unique zip path for a file, prefixed so child files don&rsquo;t
 *  collide with other sections. */
function filePathForChildFile(
  file: File,
  rootPrefix: string,
  folderPathById: Map<string, string>
): string {
  const ext =
    file.file_extension ?? sourceFormatExtension(file.canonical_format);
  const safeName = slugify(file.name);
  const folderPath = file.folder_id ? folderPathById.get(file.folder_id) : null;
  return folderPath
    ? `${rootPrefix}/${folderPath}/${safeName}${ext}`
    : `${rootPrefix}/${safeName}${ext}`;
}

/** Manifest entry for a child file owned by a skill or agent package. */
function toManifestChildFile(file: File, relativePath: string): ManifestFile {
  return {
    id: file.id,
    folder_id: file.folder_id,
    name: file.name,
    slug: file.slug,
    path: file.path_cache,
    status: file.status,
    description: file.description,
    summary: file.summary,
    tags: file.tags,
    origin_type: file.origin_type,
    canonical_format: file.canonical_format,
    file_extension: file.file_extension,
    source_language: file.source_language ?? null,
    content_sha256: sha256(file.source_content),
    file_path: relativePath,
  };
}

// ─── Manifest conversion helpers ─────────────────────────────────────────────

function toManifestFile(file: File): ManifestFile {
  const ext = file.file_extension ?? sourceFormatExtension(file.canonical_format);
  const safeName = slugify(file.name);
  return {
    id: file.id,
    folder_id: file.folder_id,
    name: file.name,
    slug: file.slug,
    path: file.path_cache,
    status: file.status,
    description: file.description,
    summary: file.summary,
    tags: file.tags,
    origin_type: file.origin_type,
    canonical_format: file.canonical_format,
    file_extension: file.file_extension,
    source_language: file.source_language ?? null,
    content_sha256: sha256(file.source_content),
    file_path: `files/${safeName}${ext}`,
  };
}

function toManifestSkill(skill: Skill): ManifestSkill {
  const ext = sourceFormatExtension(skill.canonical_format);
  const safeName = slugify(skill.name);
  return {
    id: skill.id,
    folder_id: skill.folder_id,
    name: skill.name,
    slug: skill.slug,
    path: skill.path_cache,
    status: skill.status,
    description: skill.description,
    summary: skill.summary,
    tags: skill.tags,
    origin_type: skill.origin_type,
    canonical_format: skill.canonical_format,
    is_reusable: skill.is_reusable,
    content_sha256: sha256(skill.source_content),
    file_path: `skills/${safeName}${ext}`,
  };
}

function toManifestAgent(agent: Agent): ManifestAgent {
  const ext = sourceFormatExtension(agent.canonical_format);
  const safeName = slugify(agent.name);
  return {
    id: agent.id,
    folder_id: agent.folder_id,
    name: agent.name,
    slug: agent.slug,
    path: agent.path_cache,
    status: agent.status,
    description: agent.description,
    summary: agent.summary,
    tags: agent.tags,
    origin_type: agent.origin_type,
    agent_type: agent.agent_type,
    canonical_format: agent.canonical_format,
    is_reusable: agent.is_reusable,
    content_sha256: sha256(agent.source_content),
    file_path: `agents/${safeName}${ext}`,
  };
}

// ─── Export: file ─────────────────────────────────────────────────────────────

/**
 * Export a single file as a packaged zip.
 * Verifies workspace ownership via the file's box.
 */
export async function exportFile(
  supabase: SupabaseClient,
  workspaceId: string,
  fileId: string
): Promise<ExportPackage> {
  const file = await getFileById(supabase, fileId);
  if (!file) throw new Error("File not found");

  if (file.box_id) {
    const box = await getBoxById(supabase, file.box_id);
    if (!box || box.workspace_id !== workspaceId) throw new Error("Not found");
  } else if (file.workspace_id !== workspaceId) {
    throw new Error("Not found");
  }

  const mf = toManifestFile(file);

  const manifest: ExportManifest = {
    schema_version: "1.1",
    export_type: "file",
    exported_at: new Date().toISOString(),
    workspace: { id: workspaceId, name: "" },
    box: null,
    root: null,
    folders: [],
    notes: [],
    links: [],
    bundle: null,
    files: [mf.file_path],
    counts: { folders: 0, notes: 0, links: 0, files: 1, skills: 0, agents: 0 },
    ...emptyV11Fields(),
    object_files: [mf],
  };

  const exportFiles: Record<string, string> = {
    "manifest.json": buildManifestJson(manifest),
    [mf.file_path]: file.source_content,
  };

  return {
    filename: `${slugify(file.name)}-file.zip`,
    files: exportFiles,
    manifest,
  };
}

// ─── Export: skill ────────────────────────────────────────────────────────────

/**
 * Export a single skill.
 *
 * mode = "canonical_source": returns a RawExportContent (single source file, no zip)
 * mode = "packaged": returns an ExportPackage (zip with manifest.json + source file)
 */
export async function exportSkill(
  supabase: SupabaseClient,
  workspaceId: string,
  skillId: string,
  mode: ExportMode = "packaged"
): Promise<ExportPackage | RawExportContent> {
  const skill = await getSkillById(supabase, skillId);
  if (!skill) throw new Error("Skill not found");

  if (skill.box_id) {
    const box = await getBoxById(supabase, skill.box_id);
    if (!box || box.workspace_id !== workspaceId) throw new Error("Not found");
  } else if (skill.workspace_id !== workspaceId) {
    throw new Error("Not found");
  }

  const ext = sourceFormatExtension(skill.canonical_format);
  const safeName = slugify(skill.name);
  const filename = `${safeName}${ext}`;

  if (mode === "canonical_source") {
    return {
      filename,
      content: skill.source_content,
      contentType: sourceFormatMime(skill.canonical_format),
    } satisfies RawExportContent;
  }

  // Packaged skill export: canonical source + child files + nested folders
  // Canonical source is placed at the zip root so it&rsquo;s immediately visible.
  // Child files and folders live under children/ preserving their folder tree.
  const canonicalPath = `source${ext}`;
  const ms: ManifestSkill = { ...toManifestSkill(skill), file_path: canonicalPath };

  const { folders: childFolders, files: childFiles } =
    await collectSkillPackageContents(supabase, workspaceId, skillId);

  // Map each folder id to its relative path inside children/
  // We use path_cache where possible but root folders get a path relative to
  // the skill itself, not the box. Walk the tree to build relative paths.
  const folderPathById = new Map<string, string>();
  // Only direct children of the skill have no parent_folder chain relevant to
  // us; nested folders use parent_folder_id to build their path.
  const folderById = new Map(childFolders.map((f) => [f.id, f]));
  function relPathForFolder(folder: Folder): string {
    const segments: string[] = [];
    let current: Folder | undefined = folder;
    const guard = new Set<string>();
    while (current) {
      if (guard.has(current.id)) break;
      guard.add(current.id);
      segments.unshift(slugify(current.name));
      if (current.parent_folder_id && folderById.has(current.parent_folder_id)) {
        current = folderById.get(current.parent_folder_id);
      } else {
        break;
      }
    }
    return segments.join("/");
  }
  for (const f of childFolders) folderPathById.set(f.id, relPathForFolder(f));

  const manifestChildFolders: ManifestFolder[] = childFolders.map((f) => ({
    id: f.id,
    parent_id: f.parent_folder_id,
    name: f.name,
    slug: f.slug,
    path: folderPathById.get(f.id) ?? f.path_cache,
    status: f.status,
    description: f.description,
  }));

  const manifestChildFiles: ManifestFile[] = childFiles.map((f) =>
    toManifestChildFile(f, `children/${filePathForChildFile(f, "", folderPathById)}`.replace("children//", "children/"))
  );

  // object_links that are fully contained in the package
  const known = new Set<string>([
    `skill:${skill.id}`,
    ...childFolders.map((f) => `folder:${f.id}`),
    ...childFiles.map((f) => `file:${f.id}`),
  ]);
  const objectLinks = await collectObjectLinksForExport(
    supabase,
    workspaceId,
    { type: "skill", id: skill.id },
    known
  );

  const allFilePaths = [canonicalPath, ...manifestChildFiles.map((f) => f.file_path)];

  const manifest: ExportManifest = {
    schema_version: "1.1",
    export_type: "skill",
    exported_at: new Date().toISOString(),
    workspace: { id: workspaceId, name: "" },
    box: null,
    root: null,
    folders: manifestChildFolders,
    notes: [],
    links: [],
    bundle: null,
    files: allFilePaths,
    counts: {
      folders: manifestChildFolders.length,
      notes: 0,
      links: 0,
      files: allFilePaths.length,
      skills: 1,
      agents: 0,
    },
    ...emptyV11Fields(),
    skills: [ms],
    object_files: manifestChildFiles,
    object_links: objectLinks,
  };

  const exportFiles: Record<string, string> = {
    "manifest.json": buildManifestJson(manifest),
    [canonicalPath]: skill.source_content,
  };
  for (const f of childFiles) {
    const rel = filePathForChildFile(f, "", folderPathById);
    exportFiles[`children/${rel}`.replace("children//", "children/")] =
      f.source_content;
  }

  return {
    filename: `${safeName}-skill.zip`,
    files: exportFiles,
    manifest,
  } satisfies ExportPackage;
}

// ─── Export: agent ────────────────────────────────────────────────────────────

/**
 * Export a single agent.
 *
 * mode = "canonical_source": returns a RawExportContent (single source file, no zip)
 * mode = "packaged": returns an ExportPackage (zip with manifest.json + source file)
 */
export async function exportAgent(
  supabase: SupabaseClient,
  workspaceId: string,
  agentId: string,
  mode: ExportMode = "packaged"
): Promise<ExportPackage | RawExportContent> {
  const agent = await getAgentById(supabase, agentId);
  if (!agent) throw new Error("Agent not found");

  if (agent.box_id) {
    const box = await getBoxById(supabase, agent.box_id);
    if (!box || box.workspace_id !== workspaceId) throw new Error("Not found");
  } else if (agent.workspace_id !== workspaceId) {
    throw new Error("Not found");
  }

  const ext = sourceFormatExtension(agent.canonical_format);
  const safeName = slugify(agent.name);
  const filename = `${safeName}${ext}`;

  if (mode === "canonical_source") {
    return {
      filename,
      content: agent.source_content,
      contentType: sourceFormatMime(agent.canonical_format),
    } satisfies RawExportContent;
  }

  // Packaged agent export: canonical source + child files + nested folders
  // + metadata about referenced Skills (but not the skills themselves — they
  // remain separately exportable since agents reference, not own, skills).
  const canonicalPath = `source${ext}`;
  const ma: ManifestAgent = { ...toManifestAgent(agent), file_path: canonicalPath };

  const { folders: childFolders, files: childFiles } =
    await collectAgentPackageContents(supabase, workspaceId, agentId);

  const folderById = new Map(childFolders.map((f) => [f.id, f]));
  const folderPathById = new Map<string, string>();
  function relPathForFolder(folder: Folder): string {
    const segments: string[] = [];
    let current: Folder | undefined = folder;
    const guard = new Set<string>();
    while (current) {
      if (guard.has(current.id)) break;
      guard.add(current.id);
      segments.unshift(slugify(current.name));
      if (current.parent_folder_id && folderById.has(current.parent_folder_id)) {
        current = folderById.get(current.parent_folder_id);
      } else {
        break;
      }
    }
    return segments.join("/");
  }
  for (const f of childFolders) folderPathById.set(f.id, relPathForFolder(f));

  const manifestChildFolders: ManifestFolder[] = childFolders.map((f) => ({
    id: f.id,
    parent_id: f.parent_folder_id,
    name: f.name,
    slug: f.slug,
    path: folderPathById.get(f.id) ?? f.path_cache,
    status: f.status,
    description: f.description,
  }));

  const manifestChildFiles: ManifestFile[] = childFiles.map((f) =>
    toManifestChildFile(
      f,
      `children/${filePathForChildFile(f, "", folderPathById)}`.replace(
        "children//",
        "children/"
      )
    )
  );

  // Collect references to skills and other objects via object_links
  const agentLinksAll = await getAllObjectLinksForObject(
    supabase,
    workspaceId,
    "agent",
    agent.id
  );

  // Known set inside package
  const known = new Set<string>([
    `agent:${agent.id}`,
    ...childFolders.map((f) => `folder:${f.id}`),
    ...childFiles.map((f) => `file:${f.id}`),
  ]);

  // Skill references: we include them as manifest entries (metadata only —
  // canonical source and children belong to the Skill itself, not the agent)
  const referencedSkillIds = new Set<string>();
  for (const link of agentLinksAll) {
    if (
      link.source_object_type === "agent" &&
      link.source_object_id === agent.id &&
      link.target_object_type === "skill"
    ) {
      referencedSkillIds.add(link.target_object_id);
    }
  }

  // Fetch referenced skills (metadata only — no source content packaged)
  const referencedSkills: ManifestSkill[] = [];
  if (referencedSkillIds.size > 0) {
    for (const sid of referencedSkillIds) {
      const s = await getSkillById(supabase, sid);
      if (s && s.workspace_id === workspaceId && s.status !== "trashed") {
        referencedSkills.push(toManifestSkill(s));
        known.add(`skill:${s.id}`);
      }
    }
  }

  // Filter object_links to those whose endpoints are all in the known set
  const objectLinks: ManifestObjectLink[] = [];
  for (const l of agentLinksAll) {
    const sourceKey = `${l.source_object_type}:${l.source_object_id}`;
    const targetKey = `${l.target_object_type}:${l.target_object_id}`;
    if (!known.has(sourceKey) || !known.has(targetKey)) continue;
    objectLinks.push({
      id: l.id,
      source_type: l.source_object_type,
      source_id: l.source_object_id,
      target_type: l.target_object_type,
      target_id: l.target_object_id,
      relationship_type: l.relationship_type,
      relationship_note: l.relationship_note,
    });
  }

  const allFilePaths = [
    canonicalPath,
    ...manifestChildFiles.map((f) => f.file_path),
  ];

  const manifest: ExportManifest = {
    schema_version: "1.1",
    export_type: "agent",
    exported_at: new Date().toISOString(),
    workspace: { id: workspaceId, name: "" },
    box: null,
    root: null,
    folders: manifestChildFolders,
    notes: [],
    links: [],
    bundle: null,
    files: allFilePaths,
    counts: {
      folders: manifestChildFolders.length,
      notes: 0,
      links: 0,
      files: allFilePaths.length,
      skills: referencedSkills.length,
      agents: 1,
    },
    ...emptyV11Fields(),
    agents: [ma],
    skills: referencedSkills,
    object_files: manifestChildFiles,
    object_links: objectLinks,
  };

  const exportFiles: Record<string, string> = {
    "manifest.json": buildManifestJson(manifest),
    [canonicalPath]: agent.source_content,
  };
  for (const f of childFiles) {
    const rel = filePathForChildFile(f, "", folderPathById);
    exportFiles[`children/${rel}`.replace("children//", "children/")] =
      f.source_content;
  }

  return {
    filename: `${safeName}-agent.zip`,
    files: exportFiles,
    manifest,
  } satisfies ExportPackage;
}
