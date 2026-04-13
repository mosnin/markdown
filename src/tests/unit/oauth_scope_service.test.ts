import { describe, it, expect } from "vitest";
import {
  parseScopeString,
  serializeScopes,
  splitScopes,
  hasScope,
  canAccessBox,
  isCapabilityScope,
  isBoxScope,
  buildBoxScope,
  parseBoxScope,
  resolveGrantedScopes,
  ALL_SCOPES,
  OAUTH_SCOPES,
} from "@/server/services/oauth_scope_service";

const BOX_A = "11111111-1111-1111-1111-111111111111";
const BOX_B = "22222222-2222-2222-2222-222222222222";
const BOX_C = "33333333-3333-3333-3333-333333333333";

describe("oauth_scope_service — capability / box scope parsing", () => {
  it("parses a space-separated capability list", () => {
    const scopes = parseScopeString("context:read context:search");
    expect(scopes).toEqual(["context:read", "context:search"]);
  });

  it("drops unknown scopes silently", () => {
    const scopes = parseScopeString("context:read context:full");
    expect(scopes).toEqual(["context:read"]);
  });

  it("recognises well-formed box scopes", () => {
    expect(isBoxScope(`context:box:${BOX_A}`)).toBe(true);
    expect(parseBoxScope(`context:box:${BOX_A}`)).toBe(BOX_A);
  });

  it("rejects malformed box scopes", () => {
    expect(isBoxScope("context:box:not-a-uuid")).toBe(false);
    expect(parseBoxScope("context:box:not-a-uuid")).toBeNull();
  });

  it("splitScopes separates capabilities from box narrowings", () => {
    const { capabilities, boxIds } = splitScopes(
      parseScopeString(`context:read context:box:${BOX_A} context:box:${BOX_B}`)
    );
    expect(capabilities).toEqual(["context:read"]);
    expect(boxIds).not.toBeNull();
    expect(boxIds!.has(BOX_A)).toBe(true);
    expect(boxIds!.has(BOX_B)).toBe(true);
    expect(boxIds!.size).toBe(2);
  });

  it("splitScopes returns null boxIds when no box scope is present", () => {
    const { boxIds } = splitScopes(parseScopeString("context:read"));
    expect(boxIds).toBeNull();
  });

  it("serializeScopes round-trips through parseScopeString", () => {
    const scopes = parseScopeString(`context:read context:box:${BOX_A}`);
    const str = serializeScopes(scopes);
    const round = parseScopeString(str);
    expect(new Set(round)).toEqual(new Set(scopes));
  });

  it("buildBoxScope produces a parseable box scope", () => {
    expect(buildBoxScope(BOX_A)).toBe(`context:box:${BOX_A}`);
  });
});

describe("oauth_scope_service — access checks", () => {
  it("hasScope is true for an exact match", () => {
    expect(hasScope(["context:read"], "context:read")).toBe(true);
  });

  it("hasScope is false for a non-granted capability", () => {
    expect(hasScope(["context:read"], "context:generate")).toBe(false);
  });

  it("canAccessBox is true for workspace-wide tokens", () => {
    expect(canAccessBox(["context:read"], BOX_A)).toBe(true);
  });

  it("canAccessBox honours box narrowing", () => {
    const scopes = parseScopeString(
      `context:read context:box:${BOX_A}`
    );
    expect(canAccessBox(scopes, BOX_A)).toBe(true);
    expect(canAccessBox(scopes, BOX_B)).toBe(false);
  });
});

describe("oauth_scope_service — resolveGrantedScopes", () => {
  const clientAllowed: Array<
    "context:read" | "context:search" | "context:bundles" | "context:propose" | "context:generate"
  > = ["context:read", "context:search", "context:propose"];

  it("grants the intersection of requested and client-allowed", () => {
    const result = resolveGrantedScopes({
      requested: parseScopeString("context:read context:propose"),
      clientAllowed,
      role: "member",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Set(result.scopes)).toEqual(
        new Set(["context:read", "context:propose"])
      );
    }
  });

  it("rejects scopes the client is not registered for", () => {
    const result = resolveGrantedScopes({
      requested: parseScopeString("context:generate"),
      clientAllowed,
      role: "member",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects write scopes when role is viewer", () => {
    const result = resolveGrantedScopes({
      requested: parseScopeString("context:propose"),
      clientAllowed,
      role: "viewer",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects box scopes the user cannot reach", () => {
    const result = resolveGrantedScopes({
      requested: parseScopeString(
        `context:read context:box:${BOX_A} context:box:${BOX_C}`
      ),
      clientAllowed,
      role: "member",
      accessibleBoxIds: new Set([BOX_A, BOX_B]),
    });
    expect(result.ok).toBe(false);
  });

  it("accepts box scopes the user can reach", () => {
    const result = resolveGrantedScopes({
      requested: parseScopeString(`context:read context:box:${BOX_A}`),
      clientAllowed,
      role: "member",
      accessibleBoxIds: new Set([BOX_A, BOX_B]),
    });
    expect(result.ok).toBe(true);
  });
});

describe("oauth_scope_service — registry invariants", () => {
  it("has no wildcard or full-access scope", () => {
    for (const s of ALL_SCOPES) {
      expect(s).not.toContain("*");
      expect(s).not.toContain(":full");
    }
  });

  it("every capability declares a minRole", () => {
    for (const s of ALL_SCOPES) {
      expect(OAUTH_SCOPES[s].minRole).toBeDefined();
    }
  });

  it("only recognises the documented capability set", () => {
    expect(new Set(ALL_SCOPES)).toEqual(
      new Set([
        "context:read",
        "context:search",
        "context:bundles",
        "context:propose",
        "context:generate",
      ])
    );
  });

  it("isCapabilityScope is false for an unknown scope", () => {
    expect(isCapabilityScope("context:admin")).toBe(false);
  });
});
