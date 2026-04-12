/**
 * Tree ordering primitives shared by the client tree and the server move
 * action.
 *
 * The drag-and-drop system depends on both sides agreeing on a single
 * ordering contract. If the server sorts siblings one way and the client
 * renders them another, a drop at visible index N will land at a different
 * logical position after the refetch, which is exactly the failure mode
 * earlier versions exhibited.
 *
 * Contract:
 *   1. Folders sort before everything else (leaves).
 *   2. Within each bucket, ascending sort_order.
 *   3. Ties broken deterministically by object id.
 *
 * Keep this file dependency-free so it can be imported by both server code
 * and the "use client" tree sidebar without pulling server-only modules.
 */

export type TreeObjectType = "folder" | "note" | "file" | "skill" | "agent";

export interface OrderableSibling {
  objectType: TreeObjectType;
  objectId: string;
  sortOrder: number;
}

/**
 * Comparator implementing the canonical tree ordering.
 */
export function compareSiblings(a: OrderableSibling, b: OrderableSibling): number {
  const aIsFolder = a.objectType === "folder" ? 0 : 1;
  const bIsFolder = b.objectType === "folder" ? 0 : 1;
  if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.objectId.localeCompare(b.objectId);
}

/**
 * Clamp a react-arborist-style drop index against the canonical ordering
 * so a folder cannot land after the last folder and a leaf cannot land
 * before the first leaf. Returns the adjusted index.
 *
 * `siblings` must already be sorted by compareSiblings and must NOT
 * contain the dragged node.
 */
export function clampDropIndex(
  siblings: OrderableSibling[],
  draggedType: TreeObjectType,
  requestedIndex: number
): number {
  const firstLeaf = siblings.findIndex((s) => s.objectType !== "folder");
  const lastFolderIndex = firstLeaf === -1 ? siblings.length : firstLeaf;

  let idx = requestedIndex;
  if (idx < 0) idx = 0;
  if (idx > siblings.length) idx = siblings.length;

  if (draggedType === "folder" && idx > lastFolderIndex) return lastFolderIndex;
  if (draggedType !== "folder" && idx < lastFolderIndex) return lastFolderIndex;
  return idx;
}

/**
 * Re-spread sort_order across an ordered sibling list with 1000-unit gaps.
 * Returns a parallel array of the target sort_order for each entry. The
 * caller writes these values back to the registry / attachment tables.
 *
 * Gapping matters: it lets future single-item reorders insert between
 * neighbours without rewriting every sibling row. The structural fix
 * migration (20260412000002) backfills legacy data using the same gapped
 * scheme.
 */
export function assignGappedOrder(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((i + 1) * 1000);
  return out;
}

/**
 * Determine whether moving `sourceFolderPath` into `targetFolderPath`
 * would place a folder inside itself or one of its descendants. Used by
 * moveTreeNodeAction to enforce the folder-cannot-contain-itself
 * invariant before touching the database.
 */
export function isFolderCycle(
  sourceFolderPath: string,
  targetFolderPath: string
): boolean {
  if (sourceFolderPath === targetFolderPath) return true;
  return targetFolderPath.startsWith(`${sourceFolderPath}/`);
}
