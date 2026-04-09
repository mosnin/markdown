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
 */
export interface ExportManifest {
  schema_version: "1.0";
  export_type: "note" | "folder" | "box" | "bundle";
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
  /** Paths of non-manifest files in the zip (markdown files). */
  files: string[];
  counts: ManifestCounts;
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

// ─── Import summary report ────────────────────────────────────────────────────

/**
 * A single material action taken during import.
 * Every created, replaced, duplicated, remapped, or skipped object produces one.
 */
export interface ImportAction {
  /** 'folder' | 'note' | 'link' */
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
  created_counts: { folders: number; notes: number; links: number };
  replaced_counts: { notes: number; folders: number };
  duplicated_counts: { notes: number; folders: number };
  remapped_counts: { notes: number; folders: number };
  skipped_counts: { notes: number; folders: number; links: number };
  actions: ImportAction[];
  warnings: ImportWarning[];
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
