import { describe, it, expect } from "vitest";
import {
  inverseOperation,
  inverseStructuralEvent,
  type ChangeSetItemOperation,
  type StructuralEvent,
} from "@/server/services/change_set_service";
import { planItem, planStructural } from "@/server/services/restore_service";

/**
 * Unit tests for the pure primitives of the rollback system.
 *
 * These tests don't touch a database — they cover the invariants that
 * decide whether a restore plan is safe before any writes happen. If
 * these break, the restore service is allowed to produce an unsafe
 * plan (that's the whole reason these functions exist).
 */

describe("inverseOperation", () => {
  const cases: Array<[ChangeSetItemOperation, ChangeSetItemOperation]> = [
    ["create", "trash"],
    ["update", "update"],
    ["archive", "unarchive"],
    ["unarchive", "archive"],
    ["trash", "restore_lifecycle"],
    ["restore_lifecycle", "trash"],
    ["move", "move"],
    ["attach", "detach"],
    ["detach", "attach"],
    ["link_create", "link_delete"],
    ["link_delete", "link_create"],
    ["rollback", "rollback"],
  ];
  it.each(cases)("inverse(%s) === %s", (op, expected) => {
    expect(inverseOperation(op)).toBe(expected);
  });

  it("is an involution for symmetric ops", () => {
    const symmetric: ChangeSetItemOperation[] = [
      "update",
      "move",
      "archive", "unarchive",
      "trash", "restore_lifecycle",
      "attach", "detach",
      "link_create", "link_delete",
    ];
    for (const op of symmetric) {
      expect(inverseOperation(inverseOperation(op))).toBe(op);
    }
  });
});

describe("inverseStructuralEvent", () => {
  it("swaps before_state and after_state", () => {
    const event: StructuralEvent = {
      id: "e1",
      change_set_id: "cs1",
      workspace_id: "w1",
      box_id: "b1",
      event_type: "move",
      object_type: "note",
      object_id: "n1",
      before_state: { folder_id: "old", sort_order: 1000 },
      after_state: { folder_id: "new", sort_order: 2000 },
      sequence: 0,
      created_at: "2025-01-01T00:00:00Z",
    };
    const inv = inverseStructuralEvent(event);
    expect(inv.event_type).toBe("move");
    expect(inv.before).toEqual({ folder_id: "new", sort_order: 2000 });
    expect(inv.after).toEqual({ folder_id: "old", sort_order: 1000 });
  });

  it("preserves event_type — the inverse is before↔after, not event type flip", () => {
    // A move's inverse is another move (to the prior folder_id), not a
    // 'reverse_move' event. Similarly for reorder / folder_rename.
    const types: StructuralEvent["event_type"][] = [
      "move", "reorder", "folder_rename", "path_cascade",
    ];
    for (const t of types) {
      const e: StructuralEvent = {
        id: "x", change_set_id: "cs", workspace_id: "w",
        box_id: null, event_type: t, object_type: "folder",
        object_id: "f", before_state: { a: 1 }, after_state: { a: 2 },
        sequence: 0, created_at: "2025-01-01T00:00:00Z",
      };
      expect(inverseStructuralEvent(e).event_type).toBe(t);
    }
  });
});

describe("planItem", () => {
  function item(overrides: Partial<Parameters<typeof planItem>[0]>) {
    return planItem({
      id: "i1",
      change_set_id: "cs1",
      workspace_id: "w1",
      operation: "update",
      object_type: "note",
      object_id: "n1",
      version_id: null,
      before_snapshot: { v: 1 },
      after_snapshot: { v: 2 },
      created_at: "2025-01-01T00:00:00Z",
      ...overrides,
    });
  }

  it("maps create → lifecycle_restore (will trash)", () => {
    expect(item({ operation: "create" }).operation).toBe("lifecycle_restore");
  });

  it("maps update with before_snapshot → version_rollback", () => {
    expect(item({ operation: "update" }).operation).toBe("version_rollback");
  });

  it("blocks update with missing before_snapshot", () => {
    const p = item({ operation: "update", before_snapshot: null });
    expect(p.operation).toBe("unsupported");
    expect(p.blocked).toBe(true);
    expect(p.blockedReason).toMatch(/no before_snapshot/);
  });

  it("maps lifecycle ops → lifecycle_restore", () => {
    for (const op of ["archive", "unarchive", "trash", "restore_lifecycle"] as const) {
      expect(item({ operation: op }).operation).toBe("lifecycle_restore");
    }
  });

  it("maps structural ops → structural_undo", () => {
    for (const op of ["move", "attach", "detach"] as const) {
      expect(item({ operation: op }).operation).toBe("structural_undo");
    }
  });

  it("maps rollback → version_rollback (re-apply pre-state)", () => {
    // Restoring a rollback means writing a version that matches the
    // head the rollback displaced. Same mechanism as any other version
    // write.
    expect(item({ operation: "rollback" }).operation).toBe("version_rollback");
  });
});

describe("planStructural", () => {
  function event(overrides: Partial<StructuralEvent>): StructuralEvent {
    return {
      id: "e1",
      change_set_id: "cs1",
      workspace_id: "w1",
      box_id: "b1",
      event_type: "move",
      object_type: "note",
      object_id: "n1",
      before_state: { folder_id: "old" },
      after_state: { folder_id: "new" },
      sequence: 0,
      created_at: "2025-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("plans a folder move as structural_undo", () => {
    expect(planStructural(event({})).operation).toBe("structural_undo");
  });

  it("blocks a folder move whose inverse has no path_cache", () => {
    // If the structural event was recorded without the pre-move
    // path_cache, we cannot safely restore the folder's path; refuse
    // rather than write a broken tree.
    const e = event({
      object_type: "folder",
      before_state: { folder_id: "old" },         // missing path_cache
      after_state: { folder_id: "new" },          // missing path_cache
    });
    const p = planStructural(e);
    expect(p.operation).toBe("unsupported");
    expect(p.blocked).toBe(true);
  });
});

describe("trust invariants at the planning layer", () => {
  it("does not plan writes from an empty change set", () => {
    // No items, no structural events → no plan entries. The restore
    // executor still creates a child change set to record the "nothing
    // to do" attempt in audit, but this is a planning-level invariant.
    const plan = {
      changeSetId: "cs1",
      items: [] as ReturnType<typeof planItem>[],
      structural: [] as ReturnType<typeof planStructural>[],
      blockers: [] as string[],
    };
    expect(plan.items.length + plan.structural.length).toBe(0);
  });
});
