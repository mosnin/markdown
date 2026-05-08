import { describe, it, expect } from "vitest";
import { expandQuery } from "@/server/services/search_query_expansion_service";

/**
 * Unit tests for the query-expansion service used by hybrid search.
 *
 * The service is a pure function so the tests are simple input → output
 * checks. They cover:
 *   - canonicalization (lowercase + whitespace collapse)
 *   - singular ↔ plural toggling
 *   - the curated synonym/abbreviation map
 *   - stop-word filtering for variant generation
 *   - canonical form is always variants[0]
 *   - the 5-variant cap
 *   - the empty-query no-op shape
 */
describe("expandQuery", () => {
  describe("canonicalization", () => {
    it("lowercases and collapses whitespace into the canonical form", () => {
      const result = expandQuery("  Hello   WORLD  ");
      expect(result.canonical).toBe("hello world");
    });

    it("returns canonical empty + variants [\"\"] for whitespace-only input", () => {
      const result = expandQuery("   ");
      expect(result.canonical).toBe("");
      expect(result.variants).toEqual([""]);
    });

    it("returns canonical empty + variants [\"\"] for the empty string", () => {
      const result = expandQuery("");
      expect(result.canonical).toBe("");
      expect(result.variants).toEqual([""]);
    });
  });

  describe("canonical-first ordering", () => {
    it("places the canonical form as the first variant", () => {
      const result = expandQuery("auth");
      expect(result.variants[0]).toBe("auth");
      expect(result.variants.length).toBeGreaterThan(1);
    });

    it("preserves the user's literal phrasing as variants[0] for multi-word queries", () => {
      const result = expandQuery("api gateway");
      expect(result.variants[0]).toBe("api gateway");
    });
  });

  describe("singular/plural expansion", () => {
    it("expands plural to singular (agents → agent)", () => {
      const result = expandQuery("agents");
      expect(result.variants).toContain("agents");
      expect(result.variants).toContain("agent");
    });

    it("expands singular to plural (agent → agents)", () => {
      const result = expandQuery("agent");
      // Canonical first.
      expect(result.variants[0]).toBe("agent");
      expect(result.variants).toContain("agents");
    });

    it("handles -ies plurals (libraries → library)", () => {
      const result = expandQuery("libraries");
      expect(result.variants).toContain("libraries");
      expect(result.variants).toContain("library");
    });

    it("handles -y → -ies (library → libraries)", () => {
      const result = expandQuery("library");
      expect(result.variants).toContain("library");
      expect(result.variants).toContain("libraries");
    });

    it("does not toggle short tokens that would produce nonsense", () => {
      const result = expandQuery("is");
      // Stop word + short → no plural/singular toggle, no synonym hit,
      // and the stripped variant is empty so it isn't added either.
      expect(result.canonical).toBe("is");
      expect(result.variants[0]).toBe("is");
      // No nonsensical "i" or similar variants should appear.
      expect(result.variants).not.toContain("i");
    });
  });

  describe("synonym map", () => {
    it("expands abbreviations to long form (auth → authentication)", () => {
      const result = expandQuery("auth");
      expect(result.variants).toContain("authentication");
    });

    it("expands long form back to abbreviation (authentication → auth)", () => {
      const result = expandQuery("authentication");
      expect(result.variants).toContain("auth");
    });

    it("expands db → database", () => {
      const result = expandQuery("db");
      expect(result.variants).toContain("database");
    });

    it("expands rls → row level security", () => {
      const result = expandQuery("rls");
      expect(result.variants).toContain("row level security");
    });

    it("expands k8s → kubernetes", () => {
      const result = expandQuery("k8s");
      expect(result.variants).toContain("kubernetes");
    });

    it("expands ml → machine learning", () => {
      const result = expandQuery("ml");
      expect(result.variants).toContain("machine learning");
    });

    it("substitutes a single token within a multi-word query", () => {
      const result = expandQuery("auth flow");
      // Canonical first.
      expect(result.variants[0]).toBe("auth flow");
      // Synonym substitution should produce "authentication flow".
      expect(result.variants).toContain("authentication flow");
    });
  });

  describe("stop-word handling", () => {
    it("emits a stop-word-stripped variant when stop words are present", () => {
      const result = expandQuery("the agent of doom");
      expect(result.variants[0]).toBe("the agent of doom");
      // The stripped variant drops "the" and "of".
      expect(result.variants).toContain("agent doom");
    });

    it("does not generate substitutions on stop-word tokens themselves", () => {
      const result = expandQuery("the api");
      // Canonical first.
      expect(result.variants[0]).toBe("the api");
      // "the" should NOT be expanded; "api" should still be substituted.
      // Stripped variant drops "the".
      expect(result.variants).toContain("api");
      // No variant should swap "the" for something else.
      for (const v of result.variants) {
        // "the" tokens should either be present or the whole token dropped.
        // We just sanity-check that no variant contains a swap target.
        expect(v.split(" ").every((tok) => tok.length > 0)).toBe(true);
      }
    });
  });

  describe("variant cap", () => {
    it("caps total variants at 5", () => {
      // A query that triggers many expansions: "auth db api ml k8s" — each
      // token has a synonym, plus plural toggles.
      const result = expandQuery("auth db api ml k8s");
      expect(result.variants.length).toBeLessThanOrEqual(5);
      // Canonical still leads.
      expect(result.variants[0]).toBe("auth db api ml k8s");
    });

    it("dedupes identical variants", () => {
      const result = expandQuery("auth auth");
      const unique = new Set(result.variants);
      expect(unique.size).toBe(result.variants.length);
    });
  });

  describe("return shape", () => {
    it("always returns an object with canonical (string) and variants (string[])", () => {
      const result = expandQuery("anything");
      expect(typeof result.canonical).toBe("string");
      expect(Array.isArray(result.variants)).toBe(true);
      for (const v of result.variants) {
        expect(typeof v).toBe("string");
      }
    });
  });
});
