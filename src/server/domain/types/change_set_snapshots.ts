/**
 * Typed shapes for change_set_item.before_snapshot / after_snapshot.
 *
 * The underlying column is loose jsonb so service writers can record
 * whatever they need without a migration, but every *reader* of a
 * snapshot should narrow through these types so the contract is
 * explicit. Adopting them incrementally is safe: old rows simply fail
 * the type guard and the restore service falls back to the "missing
 * before_snapshot → blocker" branch already in planItem.
 *
 * Each type here documents the minimum shape the restore service
 * relies on. Writers are free to add more keys; readers must not rely
 * on anything not declared here.
 */

export interface NoteUpdateSnapshot {
  /** note_versions.id that represents this point in history. */
  version_id: string;
  /** Optional display hints the history UI can use. */
  title?: string;
}

export interface ObjectUpdateSnapshot {
  version_id: string;
  name?: string;
}

export interface LifecycleSnapshot {
  status: "draft" | "active" | "archived" | "trashed";
}

export interface FolderCreateSnapshot {
  name: string;
  slug: string;
  path_cache: string;
  parent_folder_id: string | null;
  box_id: string;
  status: "draft" | "active" | "archived" | "trashed";
}

export interface LinkSnapshot {
  source_note_id: string;
  target_note_id: string;
  relationship_type: string;
  relationship_note: string | null;
}

export interface MoveStructuralSnapshot {
  folder_id: string | null;
  sort_order: number;
  box_id: string;
  /** Present only for folder moves. */
  parent_folder_id?: string | null;
  path_cache?: string;
  object_type?: string;
}

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isNoteUpdateSnapshot(v: unknown): v is NoteUpdateSnapshot {
  return typeof v === "object" && v !== null
    && typeof (v as { version_id?: unknown }).version_id === "string";
}

export function isLifecycleSnapshot(v: unknown): v is LifecycleSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const s = (v as { status?: unknown }).status;
  return s === "draft" || s === "active" || s === "archived" || s === "trashed";
}

export function isFolderCreateSnapshot(v: unknown): v is FolderCreateSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string"
    && typeof o.slug === "string"
    && typeof o.path_cache === "string"
    && (o.parent_folder_id === null || typeof o.parent_folder_id === "string");
}

export function isLinkSnapshot(v: unknown): v is LinkSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.source_note_id === "string"
    && typeof o.target_note_id === "string"
    && typeof o.relationship_type === "string";
}
