import { describe, it, expect } from "vitest";
import {
  compareSiblings,
  clampDropIndex,
  assignGappedOrder,
  isFolderCycle,
  type OrderableSibling,
} from "@/server/domain/tree_ordering";

/**
 * Unit tests for the tree ordering contract shared between the client tree
 * sidebar and the server moveTreeNodeAction. If server and client disagree
 * on sibling order or drop index clamping, drag-drops visibly persist but
 * land in the wrong spot after a refetch — the failure mode the fix
 * migration and action rewrite exist to prevent.
 */

function sib(
  type: OrderableSibling["objectType"],
  id: string,
  sort: number
): OrderableSibling {
  return { objectType: type, objectId: id, sortOrder: sort };
}

describe("compareSiblings", () => {
  it("places folders before leaves regardless of sort_order", () => {
    const items = [
      sib("note", "a", 1_000),
      sib("folder", "b", 9_999_999),
    ];
    items.sort(compareSiblings);
    expect(items[0].objectType).toBe("folder");
    expect(items[1].objectType).toBe("note");
  });

  it("orders within a bucket by sort_order ascending", () => {
    const items = [
      sib("note", "a", 3_000),
      sib("note", "b", 1_000),
      sib("note", "c", 2_000),
    ];
    items.sort(compareSiblings);
    expect(items.map((i) => i.objectId)).toEqual(["b", "c", "a"]);
  });

  it("breaks sort_order ties by object id deterministically", () => {
    // This is the invariant that lets server and client agree when the
    // backfill migration hasn't yet touched a pair of legacy rows.
    const items = [
      sib("note", "zzzz", 0),
      sib("note", "aaaa", 0),
      sib("note", "mmmm", 0),
    ];
    items.sort(compareSiblings);
    expect(items.map((i) => i.objectId)).toEqual(["aaaa", "mmmm", "zzzz"]);
  });
});

describe("clampDropIndex", () => {
  // Two folders then three leaves, in display order.
  const siblings: OrderableSibling[] = [
    sib("folder", "f1", 1_000),
    sib("folder", "f2", 2_000),
    sib("note", "n1", 3_000),
    sib("file", "x1", 4_000),
    sib("agent", "a1", 5_000),
  ];

  it("clamps leaves so they cannot land in the folder region", () => {
    // Dropping a note at index 0 visually sits before the first folder.
    // Leaves must be pushed to the start of the leaf region (index 2).
    expect(clampDropIndex(siblings, "note", 0)).toBe(2);
    expect(clampDropIndex(siblings, "note", 1)).toBe(2);
    expect(clampDropIndex(siblings, "note", 2)).toBe(2);
  });

  it("keeps leaves in range when they target the leaf region", () => {
    expect(clampDropIndex(siblings, "file", 3)).toBe(3);
    expect(clampDropIndex(siblings, "file", 5)).toBe(5);
  });

  it("clamps folders so they cannot land past the last folder", () => {
    expect(clampDropIndex(siblings, "folder", 4)).toBe(2);
    expect(clampDropIndex(siblings, "folder", 5)).toBe(2);
  });

  it("handles an all-leaves parent", () => {
    const leaves: OrderableSibling[] = [
      sib("note", "a", 1_000),
      sib("note", "b", 2_000),
    ];
    // Any index is valid for leaves since there are no folders above.
    expect(clampDropIndex(leaves, "note", 0)).toBe(0);
    // A folder dropped here would legally land at index 0 (no folders yet).
    expect(clampDropIndex(leaves, "folder", 99)).toBe(0);
  });

  it("handles an empty parent", () => {
    expect(clampDropIndex([], "folder", 7)).toBe(0);
    expect(clampDropIndex([], "note", 7)).toBe(0);
  });

  it("rejects negative indexes", () => {
    expect(clampDropIndex(siblings, "note", -3)).toBe(2);
  });
});

describe("assignGappedOrder", () => {
  it("returns 1000-unit gapped ordinals", () => {
    expect(assignGappedOrder(3)).toEqual([1_000, 2_000, 3_000]);
    expect(assignGappedOrder(0)).toEqual([]);
  });

  it("is large enough to allow many midpoint inserts between neighbours", () => {
    // Between 1000 and 2000 there are 999 legal integer slots. That's
    // enough cushion for typical reorder sequences without re-spreading.
    const [a, b] = assignGappedOrder(2);
    expect(b - a).toBe(1_000);
  });
});

describe("isFolderCycle", () => {
  it("rejects moving a folder into itself", () => {
    expect(isFolderCycle("docs/a", "docs/a")).toBe(true);
  });

  it("rejects moving a folder into a descendant", () => {
    expect(isFolderCycle("docs/a", "docs/a/b")).toBe(true);
    expect(isFolderCycle("docs/a", "docs/a/b/c")).toBe(true);
  });

  it("allows moving a folder into an unrelated parent", () => {
    expect(isFolderCycle("docs/a", "docs/b")).toBe(false);
    expect(isFolderCycle("docs/a", "other")).toBe(false);
  });

  it("does not mistake a name prefix for an ancestor path", () => {
    // "docs/a" is NOT an ancestor of "docs/ab" — the / is load-bearing.
    expect(isFolderCycle("docs/a", "docs/ab")).toBe(false);
  });
});
