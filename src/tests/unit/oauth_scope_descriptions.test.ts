import { describe, it, expect } from "vitest";
import {
  SCOPE_DESCRIPTIONS,
  SCOPE_GROUP_LABELS,
  anyWriteCapable,
  assertEveryScopeDescribed,
  describeBoxScope,
  describeScope,
  groupScopes,
} from "@/lib/oauth_scope_descriptions";
import {
  ALL_SCOPES,
  parseScopeString,
} from "@/server/services/oauth_scope_service";

const BOX_A = "11111111-1111-1111-1111-111111111111";
const BOX_B = "22222222-2222-2222-2222-222222222222";

/**
 * Scope-description coverage test. Every capability scope declared in
 * `oauth_scope_service` MUST have a plain-English description here;
 * this is the same drift-detection idea used by the existing
 * `oauth_scope_service — registry invariants` suite.
 */
describe("oauth_scope_descriptions — coverage", () => {
  it("every capability scope has a description", () => {
    for (const s of ALL_SCOPES) {
      expect(SCOPE_DESCRIPTIONS[s]).toBeDefined();
      expect(SCOPE_DESCRIPTIONS[s].title.length).toBeGreaterThan(0);
      expect(SCOPE_DESCRIPTIONS[s].description.length).toBeGreaterThan(0);
    }
    // Sanity: also callable as a runtime assertion.
    expect(() => assertEveryScopeDescribed()).not.toThrow();
  });

  it("write-capable scopes are marked as such", () => {
    // Proposes and generates write; the rest are read-only.
    expect(SCOPE_DESCRIPTIONS["context:propose"].writeCapable).toBe(true);
    expect(SCOPE_DESCRIPTIONS["context:generate"].writeCapable).toBe(true);
    expect(SCOPE_DESCRIPTIONS["context:read"].writeCapable).toBe(false);
    expect(SCOPE_DESCRIPTIONS["context:search"].writeCapable).toBe(false);
    expect(SCOPE_DESCRIPTIONS["context:bundles"].writeCapable).toBe(false);
  });

  it("every group has a label", () => {
    expect(SCOPE_GROUP_LABELS.read).toBeTruthy();
    expect(SCOPE_GROUP_LABELS.propose).toBeTruthy();
    expect(SCOPE_GROUP_LABELS.generate).toBeTruthy();
  });
});

describe("oauth_scope_descriptions — groupScopes", () => {
  it("splits capabilities into read/propose/generate groups", () => {
    const grouped = groupScopes(
      parseScopeString(
        "context:read context:search context:propose context:generate"
      )
    );
    expect(grouped.read).toEqual(["context:read", "context:search"]);
    expect(grouped.propose).toEqual(["context:propose"]);
    expect(grouped.generate).toEqual(["context:generate"]);
  });

  it("collects box ids into the narrow bucket", () => {
    const grouped = groupScopes(
      parseScopeString(
        `context:read context:box:${BOX_A} context:box:${BOX_B}`
      )
    );
    expect(grouped.narrow).toEqual(
      expect.arrayContaining([BOX_A, BOX_B])
    );
    expect(grouped.narrow).toHaveLength(2);
  });
});

describe("oauth_scope_descriptions — describeScope", () => {
  it("returns the capability description for a capability scope", () => {
    const d = describeScope("context:read");
    expect(d.title).toBe(SCOPE_DESCRIPTIONS["context:read"].title);
    expect(d.writeCapable).toBe(false);
  });

  it("returns a generic box description when no lookup is provided", () => {
    const d = describeScope(`context:box:${BOX_A}`);
    expect(d.writeCapable).toBe(false);
    expect(d.title.toLowerCase()).toContain("box");
  });

  it("uses the box name from the lookup callback", () => {
    const d = describeScope(`context:box:${BOX_A}`, (id) =>
      id === BOX_A ? "Engineering notes" : null
    );
    expect(d.title).toContain("Engineering notes");
  });

  it("describeBoxScope formats a short fallback when name is missing", () => {
    const d = describeBoxScope(BOX_A, null);
    expect(d.title).toContain("Box");
  });
});

describe("oauth_scope_descriptions — anyWriteCapable", () => {
  it("is false for read-only scope sets", () => {
    expect(anyWriteCapable(parseScopeString("context:read context:search"))).toBe(false);
  });
  it("is true when the set contains context:propose", () => {
    expect(anyWriteCapable(parseScopeString("context:read context:propose"))).toBe(true);
  });
  it("is true when the set contains context:generate", () => {
    expect(anyWriteCapable(parseScopeString("context:generate"))).toBe(true);
  });
  it("box scopes alone are not write-capable", () => {
    expect(anyWriteCapable(parseScopeString(`context:box:${BOX_A}`))).toBe(false);
  });
});
