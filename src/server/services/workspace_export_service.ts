import { type SupabaseClient } from "@supabase/supabase-js";
import { type Box } from "@/server/domain/types/box";
import { type Note } from "@/server/domain/types/note";
import { type Folder } from "@/server/domain/types/folder";
import { type File } from "@/server/domain/types/file";
import { type Skill } from "@/server/domain/types/skill";
import { type Agent } from "@/server/domain/types/agent";
import { type NoteLink } from "@/server/domain/types/note_link";
import { type ObjectLink } from "@/server/domain/types/object_link";
import {
  type WorkspaceExport,
  type WorkspaceImportResult,
  type WorkspaceExportBox,
  type WorkspaceExportFolder,
  type WorkspaceExportNote,
  type WorkspaceExportFile,
  type WorkspaceExportSkill,
  type WorkspaceExportAgent,
  type WorkspaceExportObjectLink,
  type WorkspaceExportNoteLink,
} from "@/server/domain/types/workspace_export";

/**
 * Workspace-level export/import service.
 *
 * exportWorkspace: queries all workspace content and returns a WorkspaceExport JSON object.
 * importWorkspace: inserts content from a WorkspaceExport into a target workspace,
 *   with collision handling via 'skip' or 'overwrite' mode.
 *
 * Trashed content is always excluded from export.
 * Branch-local content is excluded from export.
 */

// ─── Export ─────────────────────────────────────────────────────────────────

export async function exportWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceExport> {
  // Fetch workspace metadata
  const { data: ws, error: wsErr } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("id", workspaceId)
    .single();
  if (wsErr || !ws) throw new Error("Workspace not found");

  // Fetch boxes
  const { data: rawBoxes } = await supabase
    .from("boxes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("status", "trashed")
    .is("branch_id", null)
    .order("name");
  const boxes: Box[] = (rawBoxes ?? []) as Box[];

  const boxIds = boxes.map((b) => b.id);

  // Fetch folders
  const { data: rawFolders } = await supabase
    .from("folders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("status", "trashed")
    .is("branch_id", null)
    .order("name");
  const folders: Folder[] = (rawFolders ?? []) as Folder[];

  // Fetch notes (must be in a box)
  let notes: Note[] = [];
  if (boxIds.length > 0) {
    const { data: rawNotes } = await supabase
      .from("notes")
      .select("*")
      .in("box_id", boxIds)
      .neq("status", "trashed")
      .is("branch_id", null)
      .order("title");
    notes = (rawNotes ?? []) as Note[];
  }

  // Fetch files
  const { data: rawFiles } = await supabase
    .from("files")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("status", "trashed")
    .is("branch_id", null)
    .order("name");
  const files: File[] = (rawFiles ?? []) as File[];

  // Fetch skills
  const { data: rawSkills } = await supabase
    .from("skills")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("status", "trashed")
    .order("name");
  const skills: Skill[] = (rawSkills ?? []) as Skill[];

  // Fetch agents
  const { data: rawAgents } = await supabase
    .from("agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("status", "trashed")
    .order("name");
  const agents: Agent[] = (rawAgents ?? []) as Agent[];

  // Fetch note_links (between exported notes)
  const noteIds = notes.map((n) => n.id);
  let noteLinks: NoteLink[] = [];
  if (noteIds.length > 0) {
    const { data: rawLinks } = await supabase
      .from("note_links")
      .select("*")
      .or(
        `source_note_id.in.(${noteIds.join(",")}),target_note_id.in.(${noteIds.join(",")})`,
      )
      .is("branch_id", null);
    noteLinks = (rawLinks ?? []) as NoteLink[];
    // Keep only links where both ends are in the export set
    const noteIdSet = new Set(noteIds);
    noteLinks = noteLinks.filter(
      (l) => noteIdSet.has(l.source_note_id) && noteIdSet.has(l.target_note_id),
    );
  }

  // Fetch object_links
  const { data: rawObjLinks } = await supabase
    .from("object_links")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("branch_id", null);
  const objectLinks: ObjectLink[] = (rawObjLinks ?? []) as ObjectLink[];

  return {
    version: "1.0",
    exported_at: new Date().toISOString(),
    workspace: { id: ws.id, name: ws.name, slug: ws.slug },
    boxes: boxes.map(toExportBox),
    folders: folders.map(toExportFolder),
    notes: notes.map(toExportNote),
    files: files.map(toExportFile),
    skills: skills.map(toExportSkill),
    agents: agents.map(toExportAgent),
    object_links: objectLinks.map(toExportObjectLink),
    note_links: noteLinks.map(toExportNoteLink),
  };
}

// ─── Import validation ─────────────────────────────────────────────────────

/** Max total objects allowed in a single import payload. */
const MAX_IMPORT_OBJECTS = 10_000;

/**
 * Validate the shape and size of an import payload before processing.
 * Throws on invalid data.
 */
export function validateExportSchema(data: unknown): asserts data is WorkspaceExport {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid export: payload must be a JSON object");
  }

  const d = data as Record<string, unknown>;

  if (d.version !== "1.0") {
    throw new Error(`Invalid export: unsupported version "${String(d.version)}"`);
  }

  const arrayFields = ["boxes", "folders", "notes", "files", "skills", "agents", "object_links", "note_links"] as const;
  let totalObjects = 0;
  for (const field of arrayFields) {
    if (!Array.isArray(d[field])) {
      throw new Error(`Invalid export: "${field}" must be an array`);
    }
    totalObjects += (d[field] as unknown[]).length;
  }

  if (totalObjects > MAX_IMPORT_OBJECTS) {
    throw new Error(`Import too large: ${totalObjects} objects exceeds the ${MAX_IMPORT_OBJECTS} object limit`);
  }

  if (!d.workspace || typeof d.workspace !== "object") {
    throw new Error("Invalid export: missing workspace metadata");
  }

  if (!d.exported_at || typeof d.exported_at !== "string") {
    throw new Error("Invalid export: missing exported_at timestamp");
  }
}

// ─── Import ─────────────────────────────────────────────────────────────────

export async function importWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  data: WorkspaceExport,
  collisionMode: "skip" | "overwrite",
): Promise<WorkspaceImportResult> {
  validateExportSchema(data);
  const result: WorkspaceImportResult = {
    boxes: { created: 0, skipped: 0, overwritten: 0 },
    folders: { created: 0, skipped: 0, overwritten: 0 },
    notes: { created: 0, skipped: 0, overwritten: 0 },
    files: { created: 0, skipped: 0, overwritten: 0 },
    skills: { created: 0, skipped: 0, overwritten: 0 },
    agents: { created: 0, skipped: 0, overwritten: 0 },
    object_links: { created: 0, skipped: 0 },
    note_links: { created: 0, skipped: 0 },
    warnings: [],
  };

  // Import boxes
  for (const box of data.boxes) {
    const outcome = await upsertRow(supabase, "boxes", box.id, {
      id: box.id,
      workspace_id: workspaceId,
      name: box.name,
      slug: box.slug,
      description: box.description,
      status: box.status,
      guide_note_id: box.guide_note_id,
    }, collisionMode);
    bumpCount(result.boxes, outcome);
  }

  // Import folders
  for (const folder of data.folders) {
    const outcome = await upsertRow(supabase, "folders", folder.id, {
      id: folder.id,
      workspace_id: workspaceId,
      box_id: folder.box_id,
      parent_folder_id: folder.parent_folder_id,
      name: folder.name,
      slug: folder.slug,
      path_cache: folder.path_cache,
      description: folder.description,
      status: folder.status,
    }, collisionMode);
    bumpCount(result.folders, outcome);
  }

  // Import notes
  for (const note of data.notes) {
    const outcome = await upsertRow(supabase, "notes", note.id, {
      id: note.id,
      box_id: note.box_id,
      folder_id: note.folder_id,
      title: note.title,
      slug: note.slug,
      path_cache: note.path_cache,
      markdown_content: note.markdown_content,
      content_bytes: Buffer.byteLength(note.markdown_content, "utf8"),
      tags: note.tags,
      status: note.status,
      summary: note.summary,
      origin_type: note.origin_type,
      is_generated: note.is_generated,
    }, collisionMode);
    bumpCount(result.notes, outcome);
  }

  // Import files
  for (const file of data.files) {
    const outcome = await upsertRow(supabase, "files", file.id, {
      id: file.id,
      workspace_id: workspaceId,
      box_id: file.box_id,
      folder_id: file.folder_id,
      name: file.name,
      slug: file.slug,
      path_cache: file.path_cache,
      source_content: file.source_content,
      content_bytes: Buffer.byteLength(file.source_content, "utf8"),
      canonical_format: file.canonical_format,
      source_language: file.source_language,
      file_extension: file.file_extension,
      description: file.description,
      tags: file.tags,
      status: file.status,
      summary: file.summary,
      origin_type: file.origin_type,
    }, collisionMode);
    bumpCount(result.files, outcome);
  }

  // Import skills
  for (const skill of data.skills) {
    const outcome = await upsertRow(supabase, "skills", skill.id, {
      id: skill.id,
      workspace_id: workspaceId,
      box_id: skill.box_id,
      folder_id: skill.folder_id,
      name: skill.name,
      slug: skill.slug,
      path_cache: skill.path_cache,
      source_content: skill.source_content,
      content_bytes: Buffer.byteLength(skill.source_content, "utf8"),
      canonical_format: skill.canonical_format,
      description: skill.description,
      tags: skill.tags,
      status: skill.status,
      summary: skill.summary,
      origin_type: skill.origin_type,
      is_reusable: skill.is_reusable,
    }, collisionMode);
    bumpCount(result.skills, outcome);
  }

  // Import agents
  for (const agent of data.agents) {
    const outcome = await upsertRow(supabase, "agents", agent.id, {
      id: agent.id,
      workspace_id: workspaceId,
      box_id: agent.box_id,
      folder_id: agent.folder_id,
      name: agent.name,
      slug: agent.slug,
      path_cache: agent.path_cache,
      source_content: agent.source_content,
      content_bytes: Buffer.byteLength(agent.source_content, "utf8"),
      canonical_format: agent.canonical_format,
      agent_type: agent.agent_type,
      description: agent.description,
      tags: agent.tags,
      status: agent.status,
      summary: agent.summary,
      origin_type: agent.origin_type,
      is_reusable: agent.is_reusable,
    }, collisionMode);
    bumpCount(result.agents, outcome);
  }

  // Import note_links
  for (const link of data.note_links) {
    const outcome = await upsertRow(supabase, "note_links", link.id, {
      id: link.id,
      source_note_id: link.source_note_id,
      target_note_id: link.target_note_id,
      relationship_type: link.relationship_type,
      relationship_note: link.relationship_note,
    }, collisionMode === "overwrite" ? "overwrite" : "skip");
    bumpLinkCount(result.note_links, outcome);
  }

  // Import object_links
  for (const link of data.object_links) {
    const outcome = await upsertRow(supabase, "object_links", link.id, {
      id: link.id,
      workspace_id: workspaceId,
      source_object_type: link.source_object_type,
      source_object_id: link.source_object_id,
      target_object_type: link.target_object_type,
      target_object_id: link.target_object_id,
      relationship_type: link.relationship_type,
      relationship_note: link.relationship_note,
    }, collisionMode === "overwrite" ? "overwrite" : "skip");
    bumpLinkCount(result.object_links, outcome);
  }

  return result;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

type UpsertOutcome = "created" | "skipped" | "overwritten";

async function upsertRow(
  supabase: SupabaseClient,
  table: string,
  id: string,
  row: Record<string, unknown>,
  collisionMode: "skip" | "overwrite",
): Promise<UpsertOutcome> {
  // Check if row exists
  const { data: existing } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (existing) {
    if (collisionMode === "skip") return "skipped";
    // overwrite
    const { id: _id, ...updateFields } = row;
    await supabase.from(table).update(updateFields).eq("id", id);
    return "overwritten";
  }

  const { error } = await supabase.from(table).insert(row);
  if (error) {
    // If unique constraint, treat as skip
    if (error.code === "23505") return "skipped";
    throw new Error(`Failed to insert into ${table}: ${error.message}`);
  }
  return "created";
}

function bumpCount(
  counter: { created: number; skipped: number; overwritten: number },
  outcome: UpsertOutcome,
) {
  if (outcome === "created") counter.created++;
  else if (outcome === "skipped") counter.skipped++;
  else counter.overwritten++;
}

function bumpLinkCount(
  counter: { created: number; skipped: number },
  outcome: UpsertOutcome,
) {
  if (outcome === "created") counter.created++;
  else counter.skipped++;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

function toExportBox(b: Box): WorkspaceExportBox {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    description: b.description,
    status: b.status,
    guide_note_id: b.guide_note_id,
  };
}

function toExportFolder(f: Folder): WorkspaceExportFolder {
  return {
    id: f.id,
    box_id: f.box_id,
    parent_folder_id: f.parent_folder_id,
    name: f.name,
    slug: f.slug,
    path_cache: f.path_cache,
    description: f.description,
    status: f.status,
  };
}

function toExportNote(n: Note): WorkspaceExportNote {
  return {
    id: n.id,
    box_id: n.box_id,
    folder_id: n.folder_id,
    title: n.title,
    slug: n.slug,
    path_cache: n.path_cache,
    markdown_content: n.markdown_content,
    tags: n.tags,
    status: n.status,
    summary: n.summary,
    origin_type: n.origin_type,
    is_generated: n.is_generated,
  };
}

function toExportFile(f: File): WorkspaceExportFile {
  return {
    id: f.id,
    box_id: f.box_id,
    folder_id: f.folder_id,
    name: f.name,
    slug: f.slug,
    path_cache: f.path_cache,
    source_content: f.source_content,
    canonical_format: f.canonical_format,
    source_language: f.source_language,
    file_extension: f.file_extension,
    description: f.description,
    tags: f.tags,
    status: f.status,
    summary: f.summary,
    origin_type: f.origin_type,
  };
}

function toExportSkill(s: Skill): WorkspaceExportSkill {
  return {
    id: s.id,
    box_id: s.box_id,
    folder_id: s.folder_id,
    name: s.name,
    slug: s.slug,
    path_cache: s.path_cache,
    source_content: s.source_content,
    canonical_format: s.canonical_format,
    description: s.description,
    tags: s.tags,
    status: s.status,
    summary: s.summary,
    origin_type: s.origin_type,
    is_reusable: s.is_reusable,
  };
}

function toExportAgent(a: Agent): WorkspaceExportAgent {
  return {
    id: a.id,
    box_id: a.box_id,
    folder_id: a.folder_id,
    name: a.name,
    slug: a.slug,
    path_cache: a.path_cache,
    source_content: a.source_content,
    canonical_format: a.canonical_format,
    agent_type: a.agent_type,
    description: a.description,
    tags: a.tags,
    status: a.status,
    summary: a.summary,
    origin_type: a.origin_type,
    is_reusable: a.is_reusable,
  };
}

function toExportObjectLink(l: ObjectLink): WorkspaceExportObjectLink {
  return {
    id: l.id,
    source_object_type: l.source_object_type,
    source_object_id: l.source_object_id,
    target_object_type: l.target_object_type,
    target_object_id: l.target_object_id,
    relationship_type: l.relationship_type,
    relationship_note: l.relationship_note,
  };
}

function toExportNoteLink(l: NoteLink): WorkspaceExportNoteLink {
  return {
    id: l.id,
    source_note_id: l.source_note_id,
    target_note_id: l.target_note_id,
    relationship_type: l.relationship_type,
    relationship_note: l.relationship_note,
  };
}
