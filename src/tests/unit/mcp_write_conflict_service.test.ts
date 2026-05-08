import { describe, it, expect } from "vitest";
import {
  assertExpectedVersion,
  buildVersionConflict,
  VersionConflictError,
  type VersionConflictResponse,
} from "@/server/services/mcp_write_conflict_service";

/**
 * Unit tests for the shared MCP write-tool conflict helper.
 *
 * Invariants:
 *   1. assertExpectedVersion is a no-op when expected matches current.
 *   2. assertExpectedVersion throws a VersionConflictError when they differ.
 *   3. The thrown error carries `expected` and `current` for diagnostics.
 *   4. The error class is exportable and supports `instanceof` checks.
 *   5. buildVersionConflict produces the documented shape exactly.
 *   6. Every supported `change_origin` round-trips through the helper.
 */

describe("assertExpectedVersion", () => {
  it("does not throw when expected matches current", () => {
    expect(() => assertExpectedVersion("v-1", "v-1")).not.toThrow();
  });

  it("throws VersionConflictError when expected differs from current", () => {
    expect(() => assertExpectedVersion("v-1", "v-2")).toThrow(
      VersionConflictError
    );
  });

  it("populates expected and current on the thrown error", () => {
    try {
      assertExpectedVersion("v-old", "v-new");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VersionConflictError);
      const conflict = err as VersionConflictError;
      expect(conflict.expected).toBe("v-old");
      expect(conflict.current).toBe("v-new");
      expect(conflict.code).toBe("version_conflict");
      expect(conflict.name).toBe("VersionConflictError");
      expect(conflict.message).toContain("v-old");
      expect(conflict.message).toContain("v-new");
    }
  });

  it("supports instanceof on caught errors (class is exportable)", () => {
    let caught: unknown = null;
    try {
      assertExpectedVersion("a", "b");
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof VersionConflictError).toBe(true);
    expect(caught instanceof Error).toBe(true);
  });
});

describe("buildVersionConflict", () => {
  it("produces the documented VersionConflictResponse shape", () => {
    const result = buildVersionConflict({
      id: "v-2",
      updated_at: "2026-05-07T12:00:00.000Z",
      content: "hello world",
      change_origin: "human",
    });

    // Type-level assertion: the return type is exactly VersionConflictResponse.
    const typed: VersionConflictResponse = result;

    expect(typed.ok).toBe(false);
    expect(typed.code).toBe("version_conflict");
    expect(typeof typed.message).toBe("string");
    expect(typed.message.length).toBeGreaterThan(0);
    expect(typed.current).toEqual({
      version_id: "v-2",
      updated_at: "2026-05-07T12:00:00.000Z",
      content: "hello world",
      change_origin: "human",
    });
  });

  it("preserves every supported change_origin value", () => {
    const origins = [
      "human",
      "machine_proposed",
      "machine_generated",
      "agent",
      null,
    ] as const;

    for (const origin of origins) {
      const out = buildVersionConflict({
        id: "v-x",
        updated_at: "2026-05-07T00:00:00.000Z",
        content: "",
        change_origin: origin,
      });
      expect(out.current.change_origin).toBe(origin);
    }
  });

  it("returned object has only the documented top-level keys", () => {
    const result = buildVersionConflict({
      id: "v-2",
      updated_at: "2026-05-07T12:00:00.000Z",
      content: "x",
      change_origin: null,
    });
    expect(Object.keys(result).sort()).toEqual([
      "code",
      "current",
      "message",
      "ok",
    ]);
    expect(Object.keys(result.current).sort()).toEqual([
      "change_origin",
      "content",
      "updated_at",
      "version_id",
    ]);
  });
});
