/**
 * Status vocabularies for content tables.
 *
 * These values mirror the CHECK constraints in the database.
 * Status is represented as text in Postgres to avoid enum migration pain.
 *
 * Lifecycle notes:
 *   - 'draft'    → only on boxes and notes; not yet published
 *   - 'active'   → normal usable state
 *   - 'archived' → hidden from default views but retained
 *   - 'trashed'  → soft-deleted; excluded from uniqueness indexes
 *
 * Hard delete is not the normal path for boxes, folders, or notes in V1.
 */

export const WORKSPACE_STATUS = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  TRASHED: "trashed",
} as const;

export type WorkspaceStatus =
  (typeof WORKSPACE_STATUS)[keyof typeof WORKSPACE_STATUS];

export const BOX_STATUS = {
  DRAFT: "draft",
  ACTIVE: "active",
  ARCHIVED: "archived",
  TRASHED: "trashed",
} as const;

export type BoxStatus = (typeof BOX_STATUS)[keyof typeof BOX_STATUS];

export const FOLDER_STATUS = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  TRASHED: "trashed",
} as const;

export type FolderStatus = (typeof FOLDER_STATUS)[keyof typeof FOLDER_STATUS];

export const NOTE_STATUS = {
  DRAFT: "draft",
  ACTIVE: "active",
  ARCHIVED: "archived",
  TRASHED: "trashed",
} as const;

export type NoteStatus = (typeof NOTE_STATUS)[keyof typeof NOTE_STATUS];
