/**
 * Import/Export domain types.
 *
 * These types describe the manifest schema, package structure, and import
 * summary report for Context Store's portability layer.
 *
 * The manifest is the canonical description of an exported package. It is
 * written as manifest.json at the root of every exported zip package.
 *
 * Design principles:
 *   - snake_case keys throughout (stable, machine-friendly)
 *   - stable ids throughout (no ephemeral display-only identifiers)
 *   - explicit, boring shape — no hidden computed behavior
 *   - shared by human UI, future API, and future MCP export surfaces
 *
 * Schema versions:
 *   1.0 — notes, folders, links, context bundles
 *   1.1 — adds files, skills, agents, cross-type object_links
 */

// ─── Manifest entry types ─────────────────────────────────────────────────────

/** A folder included in the export package. */
export interface ManifestFolder {
  id: string;
  /** Parent folder id, or null for root-level folders. */
  parent_id: string | null;
  name: string;
  slug: string;
  /** Derived path within the box (e.g. "research/papers"). */
  path: string;
  status: string;
  description: string | null;
}

/** A note included in the export package. */
export interface ManifestNote {
  id: string;
  /** Folder id this note belongs to, or null for root-level notes. */
  folder_id: string | null;
  title: string;
  slug: string;
  /** Derived path within the box. Convenience — not identity. */
  path: string;
  status: string;
  summary: string | null;
  tags: string[];
  origin_type: string;
  read_hint: string | null;
  is_generated: boolean;
  /** notes.current_version_id — points to the version snapshot in the package. */
  current_version_id: string | null;
  /** True when this note is assigned as the box's guide note (boxes.guide_note_id). */
  is_guide_note: boolean;
  /** SHA-256 hex digest of the note's markdown_content. */
  content_sha256: string;
  /** Relative path to the markdown file within the zip (e.g. "notes/research-note.md"). */
  file_path: string;
}

/** A note link included in the export package. */
export interface ManifestLink {
  id: string;
  source_note_id: string;
  target_note_id: string;
  /** The exact relationship_type string as stored — never normalized or renamed. */
  relationship_type: string;
  relationship_note: string | null;
}

/**
 * A file included in the export package (v1.1+).
 * Files are non-note source objects (code, config, data, etc.).
 */
export interface ManifestFile {
  id: string;
  /** Folder id, or null for root-level files. */
  folder_id: string | null;
  name: string;
  slug: string;
  path: string;
  status: string;
  description: string | null;
  summary: string | null;
  tags: string[];
  origin_type: string;
  /** e.g. "typescript", "python", "json", "markdown" */
  canonical_format: string;
  /** e.g. ".ts", ".py" — may be null */
  file_extension: string | null;
  source_language: string | null;
  /** SHA-256 hex digest of the source_content. */
  content_sha256: string;
  /** Relative path to the source file within the zip (e.g. "files/my-script.ts"). */
  file_path: string;
}

/**
 * A skill included in the export package (v1.1+).
 * Skills are reusable capability objects with canonical source content.
 */
export interface ManifestSkill {
  id: string;
  /** Folder id, or null for root-level skills. */
  folder_id: string | null;
  name: string;
  slug: string;
  path: string;
  status: string;
  description: string | null;
  summary: string | null;
  tags: string[];
  origin_type: string;
  canonical_format: string;
  /**
   * Whether this skill was workspace-level reusable at export time.
   * Importers MUST preserve this flag — never silently convert.
   */
  is_reusable: boolean;
  /** SHA-256 hex digest of the source_content. */
  content_sha256: string;
  /** Relative path to the source file within the zip (e.g. "skills/my-skill.md"). */
  file_path: string;
}

/**
 * An agent included in the export package (v1.1+).
 * Agents are reusable orchestration objects with canonical source content.
 */
export interface ManifestAgent {
  id: string;
  /** Folder id, or null for root-level agents. */
  folder_id: string | null;
  name: string;
  slug: string;
  path: string;
  status: string;
  description: string | null;
  summary: string | null;
  tags: string[];
  origin_type: string;
  agent_type: string | null;
  canonical_format: string;
  /**
   * Whether this agent was workspace-level reusable at export time.
   * Importers MUST preserve this flag — never silently convert.
   */
  is_reusable: boolean;
  /** SHA-256 hex digest of the source_content. */
  content_sha256: string;
  /** Relative path to the source file within the zip (e.g. "agents/my-agent.md"). */
  file_path: string;
}

/**
 * A cross-type semantic link included in the export package (v1.1+).
 * These are object_links rows — distinct from note_links which are note-to-note only.
 */
export interface ManifestObjectLink {
  id: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relationship_type: string;
  relationship_note: string | null;
}

/**
 * Bundle-specific manifest section — only present in context bundle exports.
 * Describes which notes were selected and how the bundle was assembled.
 */
export interface ManifestBundle {
  /** The note the bundle is centered on. */
  entry_note_id: string;
  /** The box's guide note id, if it was included. */
  guide_note_id: string | null;
  /** The ancestor summary note id, if it was included. */
  ancestor_summary_note_id: string | null;
  /** All note ids included in the bundle (entry + guide + ancestor + linked). */
  included_note_ids: string[];
  linked_limit: number;
  truncated: boolean;
  truncation_reasons: string[];
}

/** Counts of objects included in the package. */
export interface ManifestCounts {
  folders: number;
  notes: number;
  links: number;
  files: number;
  /** Number of file paths (note markdowns + source files) in the zip. */
  // (kept for backward compat — files above counts zip file entries)
  skills: number;
  agents: number;
}

/** Workspace metadata embedded in the manifest. */
export interface ManifestWorkspace {
  id: string;
  name: string;
}

/** Box metadata embedded in the manifest (omitted for note-only exports). */
export interface ManifestBox {
  id: string;
  name: string;
  slug: string;
}

/**
 * The root of a Context Store export manifest.
 *
 * Schema version is bumped when the manifest shape changes in a breaking way.
 * Consumers should check schema_version before parsing.
 *
 * export_type determines which sections are populated:
 *   'note'    — one note, no box section, no folders
 *   'folder'  — one folder subtree, box section included
 *   'box'     — full box, box section included
 *   'bundle'  — context bundle, box section included, bundle section included
 *   'file'    — single file export (v1.1)
 *   'skill'   — single skill export (v1.1)
 *   'agent'   — single agent export (v1.1)
 */
export interface ExportManifest {
  schema_version: "1.0" | "1.1";
  export_type: "note" | "folder" | "box" | "bundle" | "file" | "skill" | "agent";
  exported_at: string;
  workspace: ManifestWorkspace;
  /** Present for folder, box, and bundle exports. */
  box: ManifestBox | null;
  /** Root folder id for folder exports; null for box/note exports. */
  root: string | null;
  folders: ManifestFolder[];
  notes: ManifestNote[];
  links: ManifestLink[];
  /** Present only for bundle exports. */
  bundle: ManifestBundle | null;
  /** Paths of all content files in the zip (markdown and source files). */
  files: string[];
  counts: ManifestCounts;
  /** v1.1 — Files included in this export. Absent in v1.0 manifests. */
  object_files?: ManifestFile[];
  /** v1.1 — Skills included in this export. Absent in v1.0 manifests. */
  skills?: ManifestSkill[];
  /** v1.1 — Agents included in this export. Absent in v1.0 manifests. */
  agents?: ManifestAgent[];
  /** v1.1 — Cross-type object links between exported objects. Absent in v1.0 manifests. */
  object_links?: ManifestObjectLink[];
}

// ─── Collision modes ──────────────────────────────────────────────────────────

/**
 * Determines how the import service handles id or path collisions.
 *
 * create_copy:
 *   Objects with colliding ids or paths receive new ids and suffix-disambiguated
 *   slugs. Existing content is never overwritten. Guide assignment not replaced.
 *
 * replace_by_id:
 *   Objects whose ids match existing objects of the same type are updated in
 *   place. Notes get new versions. Folders update metadata only. Type mismatches
 *   are skipped with a warning.
 *
 * merge_metadata_only:
 *   Never replaces markdown body. May merge summary, tags, read_hint, and status
 *   for colliding notes. Creates a new version only if metadata actually changed.
 *
 * remap_ids_and_import:
 *   All colliding ids receive new generated ids. Internal parent and link
 *   references are rewritten to use the new ids. Original ids are recorded in
 *   the import summary for traceability.
 */
export type CollisionMode =
  | "create_copy"
  | "replace_by_id"
  | "merge_metadata_only"
  | "remap_ids_and_import";

// ─── Export mode (v1.1) ───────────────────────────────────────────────────────

/**
 * Export mode for skills and agents.
 *
 * canonical_source:
 *   A single raw source file (e.g. skill.md, agent.ts) — no manifest, no zip.
 *   Suitable for copying the source into another editor or version control.
 *
 * packaged:
 *   A zip with manifest.json + the source file. Includes all metadata needed
 *   to re-import the object with full fidelity (id, tags, description, etc).
 */
export type ExportMode = "canonical_source" | "packaged";

// ─── Import summary report ────────────────────────────────────────────────────

/**
 * A single material action taken during import.
 * Every created, replaced, duplicated, remapped, or skipped object produces one.
 */
export interface ImportAction {
  /** 'folder' | 'note' | 'link' | 'file' | 'skill' | 'agent' | 'object_link' */
  object_type: string;
  /** The id from the incoming package (may differ from final_id after remap). */
  incoming_id: string | null;
  /** The id of the object as it was written to the database. */
  final_id: string | null;
  incoming_path: string | null;
  final_path: string | null;
  /** What happened to this object. */
  action: "created" | "replaced" | "duplicated" | "remapped" | "skipped";
  /** Human-readable reason — especially useful for skipped items. */
  reason: string | null;
}

/** Non-fatal warnings from the import process. */
export interface ImportWarning {
  /** A short machine-readable code. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** The path or id that caused the warning. */
  subject: string | null;
}

/**
 * The full import summary report.
 *
 * Returned by the import service and surfaced in the UI after import completes.
 * Designed to be both human-readable and machine-parseable.
 */
export interface ImportSummaryReport {
  collision_mode: CollisionMode;
  created_counts: { folders: number; notes: number; links: number; files: number; skills: number; agents: number };
  replaced_counts: { notes: number; folders: number; files: number; skills: number; agents: number };
  duplicated_counts: { notes: number; folders: number; files: number; skills: number; agents: number };
  remapped_counts: { notes: number; folders: number; files: number; skills: number; agents: number };
  skipped_counts: { notes: number; folders: number; links: number; files: number; skills: number; agents: number };
  actions: ImportAction[];
  warnings: ImportWarning[];
  /**
   * The change_set_id that wraps this import. Populated when the import
   * is run through a caller that opened a change set around the
   * importPackage invocation (the standard path). Restores use this id
   * to undo the entire import as one operation.
   */
  change_set_id?: string;
}

// ─── Export artifact (signed delivery) ───────────────────────────────────────

/**
 * A compact summary of a manifest — returned alongside the signed URL so
 * callers do not have to download and parse the zip just to know what it contains.
 */
export interface ManifestSummary {
  export_type: ExportManifest["export_type"];
  note_count: number;
  folder_count: number;
  link_count: number;
  file_count: number;
  skill_count: number;
  agent_count: number;
}

/**
 * The stable response shape returned by all export endpoints after the
 * portability contract correction.
 *
 * Delivery is via a short-lived signed URL (Supabase Storage, private bucket).
 * The URL expires at `expires_at` — callers must initiate the download before
 * then. The signed URL is not logged or included in audit events.
 *
 * Human app: trigger window download via anchor click on signed_url.
 * API clients: GET the signed_url to stream the zip bytes.
 */
export interface ExportArtifact {
  /** Short-lived Supabase Storage signed URL. GET this URL to download the zip. */
  signed_url: string;
  /** ISO timestamp when the signed URL expires (1 hour from generation). */
  expires_at: string;
  /** Suggested filename for saving the zip. */
  filename: string;
  /** Size of the zip in bytes. */
  size_bytes: number;
  /** Compact summary of what the manifest contains. */
  manifest_summary: ManifestSummary;
}

// ─── Export input options ─────────────────────────────────────────────────────

export interface ExportOptions {
  /** Include archived content. Default: false. Trashed is always excluded. */
  includeArchived?: boolean;
}

export interface BundleExportOptions extends ExportOptions {
  includeGuide?: boolean;
  includeAncestorSummary?: boolean;
  linkedLimit?: number;
}

// ─── Export package (in-memory) ───────────────────────────────────────────────

/**
 * An assembled export package ready to be zipped and delivered.
 * The files map holds relative path → utf-8 content pairs.
 */
export interface ExportPackage {
  /** Suggested filename for the downloaded zip or markdown file. */
  filename: string;
  /** All files to include in the zip. Key = relative path, value = file content. */
  files: Record<string, string>;
  /** The assembled manifest for this package. */
  manifest: ExportManifest;
}

/**
 * A raw single-file export (canonical_source mode for skills/agents/files).
 * Delivered as raw content, not zipped.
 */
export interface RawExportContent {
  /** Suggested filename for saving (e.g. "my-skill.md"). */
  filename: string;
  /** UTF-8 source content. */
  content: string;
  /** MIME type for the download (e.g. "text/markdown", "text/x-python"). */
  contentType: string;
}
