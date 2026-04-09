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
 * Relationship types for note_links.
 * Same-box only in V1 — enforced at the service layer.
 */
export const RELATIONSHIP_TYPE = {
  RELATED: "related",
  REFERENCES: "references",
  EXTENDS: "extends",
  CONTRADICTS: "contradicts",
  SUPERSEDES: "supersedes",
} as const;

export type RelationshipType =
  (typeof RELATIONSHIP_TYPE)[keyof typeof RELATIONSHIP_TYPE];
