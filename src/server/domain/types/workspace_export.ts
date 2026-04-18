/**
 * Workspace export/import types.
 *
 * A WorkspaceExport captures the entire workspace's content as a
 * flat JSON document — boxes, folders, notes, files, skills, agents,
 * object_links, and note_links. Designed for bulk backup and
 * cross-workspace migration.
 *
 * Version field allows forward-compatible schema evolution.
 */

export interface WorkspaceExportBox {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  guide_note_id: string | null;
}

export interface WorkspaceExportFolder {
  id: string;
  box_id: string | null;
  parent_folder_id: string | null;
  name: string;
  slug: string;
  path_cache: string;
  description: string | null;
  status: string;
}

export interface WorkspaceExportNote {
  id: string;
  box_id: string;
  folder_id: string | null;
  title: string;
  slug: string;
  path_cache: string;
  markdown_content: string;
  tags: string[];
  status: string;
  summary: string | null;
  origin_type: string;
  is_generated: boolean;
}

export interface WorkspaceExportFile {
  id: string;
  box_id: string | null;
  folder_id: string | null;
  name: string;
  slug: string;
  path_cache: string;
  source_content: string;
  canonical_format: string;
  source_language: string | null;
  file_extension: string | null;
  description: string | null;
  tags: string[];
  status: string;
  summary: string | null;
  origin_type: string;
}

export interface WorkspaceExportSkill {
  id: string;
  box_id: string | null;
  folder_id: string | null;
  name: string;
  slug: string;
  path_cache: string;
  source_content: string;
  canonical_format: string;
  description: string | null;
  tags: string[];
  status: string;
  summary: string | null;
  origin_type: string;
  is_reusable: boolean;
}

export interface WorkspaceExportAgent {
  id: string;
  box_id: string | null;
  folder_id: string | null;
  name: string;
  slug: string;
  path_cache: string;
  source_content: string;
  canonical_format: string;
  agent_type: string | null;
  description: string | null;
  tags: string[];
  status: string;
  summary: string | null;
  origin_type: string;
  is_reusable: boolean;
}

export interface WorkspaceExportObjectLink {
  id: string;
  source_object_type: string;
  source_object_id: string;
  target_object_type: string;
  target_object_id: string;
  relationship_type: string;
  relationship_note: string | null;
}

export interface WorkspaceExportNoteLink {
  id: string;
  source_note_id: string;
  target_note_id: string;
  relationship_type: string;
  relationship_note: string | null;
}

/**
 * The root workspace export document.
 */
export interface WorkspaceExport {
  version: "1.0";
  exported_at: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  boxes: WorkspaceExportBox[];
  folders: WorkspaceExportFolder[];
  notes: WorkspaceExportNote[];
  files: WorkspaceExportFile[];
  skills: WorkspaceExportSkill[];
  agents: WorkspaceExportAgent[];
  object_links: WorkspaceExportObjectLink[];
  note_links: WorkspaceExportNoteLink[];
}

/** Result summary returned after a workspace import. */
export interface WorkspaceImportResult {
  boxes: { created: number; skipped: number; overwritten: number };
  folders: { created: number; skipped: number; overwritten: number };
  notes: { created: number; skipped: number; overwritten: number };
  files: { created: number; skipped: number; overwritten: number };
  skills: { created: number; skipped: number; overwritten: number };
  agents: { created: number; skipped: number; overwritten: number };
  object_links: { created: number; skipped: number };
  note_links: { created: number; skipped: number };
  warnings: string[];
}
