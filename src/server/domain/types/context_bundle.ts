/**
 * Context Bundle — typed shared output for deterministic note context retrieval.
 *
 * A context bundle is not:
 *   - A guide note (that is boxes.guide_note_id)
 *   - A box guide (the structured interpretation surface on the box page)
 *   - A box overview (the full hierarchy + link graph for a box)
 *   - An export package (no file output, no serialization format)
 *
 * A context bundle IS:
 *   A bounded, deterministic, explainable package of context centered on one
 *   target note — suitable for handing to AI tools, API consumers, or MCP
 *   clients that need structured context without a full box dump.
 *
 * Assembly is deterministic: given the same inputs, the same bundle is produced.
 * Ranking is explicit and documented. Truncation is flagged and reasoned.
 *
 * This type is the canonical shared output shape. The API and MCP layers will
 * consume it directly. Do not add hidden computed fields.
 */

// ─── Note reference ───────────────────────────────────────────────────────────

/**
 * Compact note reference used throughout a bundle.
 * Contains the fields needed for context — not the full markdown body.
 */
export interface BundleNoteRef {
  /** Stable DB id. Canonical identity. */
  id: string;
  box_id: string;
  folder_id: string | null;
  title: string;
  /** 'note' | 'guide' | 'bundle' */
  kind: string;
  status: string;
  summary: string | null;
  /**
   * Free-form retrieval hint.
   * Special values used by bundle assembly:
   *   'core_reference' — eligible as ancestor summary, highest read-hint priority
   *   'read_first'     — eligible as ancestor summary, second read-hint priority
   */
  read_hint: string | null;
  retrieval_priority: number;
  tags: string[];
  /** Full derived path within the box. Convenience — not identity. */
  path_cache: string;
  /**
   * Path of the note's parent folder (everything before the last '/' of
   * path_cache). Null for root-level notes. Used for display only.
   */
  folder_path_cache: string | null;
  updated_at: string;
}

// ─── Linked note ──────────────────────────────────────────────────────────────

/**
 * A note included in the bundle because it shares an explicit link with the
 * target note. Extends BundleNoteRef with relationship metadata.
 */
export interface BundleLinkedNote extends BundleNoteRef {
  /** The link's relationship_type value. */
  relationship_type: string;
  /**
   * Direction relative to the target note.
   *   'outgoing' — target note → this note
   *   'incoming' — this note → target note
   */
  direction: "outgoing" | "incoming";
  /** The note_links.id this entry was resolved from. */
  link_id: string;
}

// ─── Relationship edge ────────────────────────────────────────────────────────

/**
 * A directed note_link edge included in the bundle.
 * Only edges that connect notes actually present in linked_notes are included.
 */
export interface BundleRelationshipEdge {
  link_id: string;
  source_note_id: string;
  target_note_id: string;
  relationship_type: string;
}

// ─── Parent path ──────────────────────────────────────────────────────────────

/**
 * Ordered ancestor folder chain from the workspace root down to the note's
 * immediate parent folder. Empty when the target note is at box root level.
 */
export interface BundleParentPath {
  /** Folder ids from root (index 0) to immediate parent (last index). */
  folder_ids: string[];
  /** Folder names in the same order as folder_ids. */
  folder_names: string[];
  /**
   * The path_cache of the innermost ancestor folder.
   * Null when the note is at box root level.
   */
  path_cache: string | null;
}

// ─── Version info ─────────────────────────────────────────────────────────────

/**
 * Lightweight version metadata for the target note.
 * Does not include full version history — that is out of scope for this prompt.
 */
export interface BundleVersionInfo {
  /** notes.current_version_id. Null only before first save (shouldn't happen in practice). */
  current_version_id: string | null;
  /** notes.updated_at */
  updated_at: string;
  /** note_versions.created_at for the current version. Null if version not found. */
  version_created_at: string | null;
  /**
   * note_versions.change_origin for the current version.
   * E.g. 'human_edit' | 'import' | 'generated' | 'proposal_approved'
   */
  change_origin: string | null;
}

// ─── Assembly metadata ────────────────────────────────────────────────────────

/**
 * Records the options used during assembly and the scope of available content.
 * Useful for consumers that need to know why certain content is or isn't present.
 */
export interface BundleAssemblyMetadata {
  /** ISO timestamp of when this bundle was assembled. */
  assembled_at: string;
  /** Whether guide note inclusion was requested. */
  include_guide: boolean;
  /** Whether archived content was eligible. */
  include_archived: boolean;
  /** Whether ancestor summary resolution was requested. */
  include_ancestor_summary: boolean;
  /** The linked_limit that was applied (after clamping to max 10). */
  linked_limit: number;
  /**
   * Total number of qualifying linked notes found before the limit was applied.
   * Use this to show "showing N of M" in the UI.
   */
  total_linked_available: number;
}

// ─── Context bundle ───────────────────────────────────────────────────────────

/**
 * A fully assembled context bundle centered on one target note.
 *
 * Consumers (human UI, API, MCP) should treat this as a read model.
 * All fields are populated at assembly time — there are no lazy-loaded parts.
 *
 * Ownership: the assembler verifies that target_note, box, guide_note,
 * ancestor_summary_note, and all linked_notes belong to the authenticated
 * user's workspace before inclusion. Consumers can trust this.
 */
export interface ContextBundle {
  /**
   * The note this bundle is centered on.
   * Always present. Never appears in linked_notes, guide_note, or
   * ancestor_summary_note.
   */
  target_note: BundleNoteRef;

  /**
   * The box the target note belongs to.
   * Used by consumers for routing, display, and guide note context.
   */
  box: {
    id: string;
    name: string;
    slug: string;
    workspace_id: string;
    guide_note_id: string | null;
  };

  /**
   * Ordered ancestor folder chain from root to the target note's folder.
   * Empty when target_note is at box root level.
   */
  parent_path: BundleParentPath;

  /**
   * The box's guide note, if include_guide was true and one is assigned.
   * Never the same note as target_note.
   * Null when no guide is assigned, or include_guide was false.
   */
  guide_note: BundleNoteRef | null;

  /**
   * Notes explicitly linked to the target note, ranked by relationship
   * importance and secondary criteria. Bounded by linked_limit (max 10).
   *
   * Deduplication rules:
   *   - target_note is never present here
   *   - guide_note is never duplicated here
   *   - each note_id appears at most once
   *   - if a note is linked in both directions, the more important direction wins
   */
  linked_notes: BundleLinkedNote[];

  /**
   * A single ancestor note resolved by walking up the folder chain from the
   * target note's folder toward root, selecting the first qualifying candidate.
   *
   * Candidates must have read_hint IN ('core_reference', 'read_first').
   * Never duplicates target_note, guide_note, or linked_notes entries.
   * Null when include_ancestor_summary was false, or no candidate was found.
   */
  ancestor_summary_note: BundleNoteRef | null;

  /**
   * Directed note_link edges for the notes in linked_notes.
   * Does not include edges from/to guide_note or ancestor_summary_note.
   */
  relationship_edges: BundleRelationshipEdge[];

  /**
   * Version metadata for the target note's current version.
   */
  version_info: BundleVersionInfo;

  /**
   * True if any retrieval bound was reached or any content was excluded.
   * Check truncation_reasons for the specific causes.
   */
  truncated: boolean;

  /**
   * Machine-readable reasons for truncation or content exclusion.
   * Values:
   *   'linked_limit_reached'        — more linked notes exist than linked_limit
   *   'guide_excluded_by_option'    — include_guide was false; guide exists but skipped
   *   'ancestor_summary_not_found'  — include_ancestor_summary true; no candidate found
   *   'archived_excluded'           — one or more linked notes were archived and skipped
   */
  truncation_reasons: string[];

  /**
   * Assembly options and scope statistics.
   */
  assembly_metadata: BundleAssemblyMetadata;
}
