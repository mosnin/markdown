import { describe, it, expect } from "vitest";
import {
  RELATIONSHIP_TYPE,
  NOTE_READ_HINT,
} from "@/server/domain/constants/note_constants";

/**
 * Tests for import vocabulary validation logic.
 *
 * These test the canonical sets that the import service uses to validate
 * relationship_type and read_hint values from incoming manifests.
 *
 * We test the canonical sets directly rather than the private functions inside
 * import_service.ts to keep tests stable when internals change.
 */

const CANONICAL_RELATIONSHIP_TYPES = new Set(Object.values(RELATIONSHIP_TYPE));
const CANONICAL_READ_HINTS = new Set(Object.values(NOTE_READ_HINT));

function validateRelationshipType(value: string): string | null {
  return CANONICAL_RELATIONSHIP_TYPES.has(value as never) ? value : null;
}

function sanitizeReadHint(value: string | null | undefined): string | null {
  if (!value) return null;
  return CANONICAL_READ_HINTS.has(value as never) ? value : null;
}

describe("Import vocabulary validation", () => {
  describe("relationship_type validation", () => {
    it("accepts all canonical relationship types", () => {
      const canonical = [
        "related",
        "depends_on",
        "parent_of",
        "child_of",
        "reference_for",
        "extends",
        "example_of",
        "sibling_of",
        "supersedes",
        "derived_from",
      ];
      for (const type of canonical) {
        expect(validateRelationshipType(type)).toBe(type);
      }
    });

    it("rejects non-canonical relationship types", () => {
      const nonCanonical = [
        "links_to",       // common but non-canonical
        "RELATED",        // uppercase variant
        "relates_to",     // wrong spelling
        "references",     // wrong spelling
        "",               // empty string
        "unknown",
      ];
      for (const type of nonCanonical) {
        expect(validateRelationshipType(type)).toBeNull();
      }
    });

    it("has exactly 10 canonical relationship types", () => {
      expect(CANONICAL_RELATIONSHIP_TYPES.size).toBe(10);
    });
  });

  describe("read_hint sanitization", () => {
    it("accepts all canonical read_hint values", () => {
      const canonical = [
        "read_first",
        "core_reference",
        "supporting_context",
        "related",
        "archive_only",
        "generated",
      ];
      for (const hint of canonical) {
        expect(sanitizeReadHint(hint)).toBe(hint);
      }
    });

    it("returns null for non-canonical read_hint values", () => {
      const nonCanonical = [
        "READ_FIRST",      // uppercase
        "priority",        // different vocabulary
        "important",       // different vocabulary
        "low",
      ];
      for (const hint of nonCanonical) {
        expect(sanitizeReadHint(hint)).toBeNull();
      }
    });

    it("returns null for null input", () => {
      expect(sanitizeReadHint(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
      expect(sanitizeReadHint(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(sanitizeReadHint("")).toBeNull();
    });

    it("has exactly 6 canonical read_hint values", () => {
      expect(CANONICAL_READ_HINTS.size).toBe(6);
    });
  });
});
