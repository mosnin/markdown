/**
 * Note-specific vocabularies: kind, origin, link relationships.
 */

/**
 * The note's intended type/template.
 *
 * IMPORTANT: 'guide' here is a note kind (template), NOT the assignment
 * of a note as a box's guide. That is stored exclusively in boxes.guide_note_id.
 * Do not infer guide assignment from note.kind.
 */
export const NOTE_KIND = {
  NOTE: "note",
  GUIDE: "guide",
  BUNDLE: "bundle",
} as const;

export type NoteKind = (typeof NOTE_KIND)[keyof typeof NOTE_KIND];

/**
 * How the note came to exist.
 */
export const NOTE_ORIGIN_TYPE = {
  HUMAN: "human",
  GENERATED: "generated",
  IMPORTED: "imported",
} as const;

export type NoteOriginType =
  (typeof NOTE_ORIGIN_TYPE)[keyof typeof NOTE_ORIGIN_TYPE];

/**
 * Canonical relationship vocabulary for note_links.
 * Same-box only in V1 — enforced at the service layer.
 *
 * These 10 values are the only valid relationship_type values.
 * The database CHECK constraint mirrors this list exactly.
 *
 * Directionality: links are directed (source → target).
 * The meaning of each type describes the relationship from source to target:
 *   related        — general association (symmetric in spirit)
 *   depends_on     — source note's meaning depends on target
 *   parent_of      — source is a conceptual parent of target
 *   child_of       — source is a conceptual child of target
 *   reference_for  — source is cited as a reference for target
 *   extends        — source builds upon or continues target
 *   example_of     — source is a concrete example of target
 *   sibling_of     — source and target are peer-level siblings
 *   supersedes     — source replaces or supersedes target
 *   derived_from   — source was derived or extracted from target
 */
export const RELATIONSHIP_TYPE = {
  RELATED: "related",
  DEPENDS_ON: "depends_on",
  PARENT_OF: "parent_of",
  CHILD_OF: "child_of",
  REFERENCE_FOR: "reference_for",
  EXTENDS: "extends",
  EXAMPLE_OF: "example_of",
  SIBLING_OF: "sibling_of",
  SUPERSEDES: "supersedes",
  DERIVED_FROM: "derived_from",
} as const;

export type RelationshipType =
  (typeof RELATIONSHIP_TYPE)[keyof typeof RELATIONSHIP_TYPE];
