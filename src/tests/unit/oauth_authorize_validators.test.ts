import { describe, it, expect } from "vitest";
import {
  buildCodeRedirect,
  buildErrorRedirect,
  consentCoversScopes,
  isClientAndRedirectOk,
  validateProtocolParams,
} from "@/app/oauth/authorize/validators";
import type { OAuthClient } from "@/server/services/oauth_client_service";

function makeClient(overrides: Partial<OAuthClient> = {}): OAuthClient {
  return {
    id: "client-uuid",
    client_id: "acme-abcd1234",
    name: "Acme",
    description: null,
    homepage_url: null,
    logo_url: null,
    redirect_uris: ["https://acme.example/cb"],
    allowed_scopes: ["context:read"],
    is_confidential: false,
    is_first_party: false,
    status: "active",
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("authorize validators — isClientAndRedirectOk", () => {
  it("rejects missing client_id inline", () => {
    const r = isClientAndRedirectOk({}, null);
    expect(r?.kind).toBe("inline");
    expect(r?.kind === "inline" && r.title).toMatch(/client_id/i);
  });

  it("rejects unknown client inline", () => {
    const r = isClientAndRedirectOk(
      { client_id: "nope", redirect_uri: "https://a.example/cb" },
      null
    );
    expect(r?.kind).toBe("inline");
    expect(r?.kind === "inline" && r.title).toMatch(/unknown/i);
  });

  it("rejects missing redirect_uri inline", () => {
    const client = makeClient();
    const r = isClientAndRedirectOk({ client_id: client.client_id }, client);
    expect(r?.kind).toBe("inline");
    expect(r?.kind === "inline" && r.title).toMatch(/redirect_uri/i);
  });

  it("rejects non-matching redirect_uri inline", () => {
    const client = makeClient();
    const r = isClientAndRedirectOk(
      { client_id: client.client_id, redirect_uri: "https://attacker.example/cb" },
      client
    );
    expect(r?.kind).toBe("inline");
    expect(r?.kind === "inline" && r.title).toMatch(/not allowed/i);
  });

  it("allows exact-match redirect_uri", () => {
    const client = makeClient();
    const r = isClientAndRedirectOk(
      { client_id: client.client_id, redirect_uri: "https://acme.example/cb" },
      client
    );
    expect(r).toBeNull();
  });

  it("does NOT allow prefix or substring matches", () => {
    const client = makeClient({
      redirect_uris: ["https://acme.example/cb"],
    });
    // Slight difference — attacker tries extending the path.
    const r = isClientAndRedirectOk(
      { client_id: client.client_id, redirect_uri: "https://acme.example/cb/evil" },
      client
    );
    expect(r?.kind).toBe("inline");
  });
});

describe("authorize validators — validateProtocolParams", () => {
  const baseParams = {
    response_type: "code" as const,
    state: "xyz",
    code_challenge: "abc",
    code_challenge_method: "S256" as const,
    scope: "context:read",
  };

  it("accepts a well-formed request", () => {
    expect(validateProtocolParams(baseParams)).toBeNull();
  });

  it("rejects non-code response_type", () => {
    const r = validateProtocolParams({ ...baseParams, response_type: "token" });
    expect(r?.error).toBe("unsupported_response_type");
  });

  it("rejects missing state", () => {
    const r = validateProtocolParams({ ...baseParams, state: "" });
    expect(r?.error).toBe("invalid_request");
    expect(r?.description.toLowerCase()).toContain("state");
  });

  it("rejects missing code_challenge", () => {
    const r = validateProtocolParams({ ...baseParams, code_challenge: "" });
    expect(r?.error).toBe("invalid_request");
  });

  it("rejects non-S256 code_challenge_method", () => {
    const r = validateProtocolParams({
      ...baseParams,
      code_challenge_method: "plain",
    });
    expect(r?.error).toBe("invalid_request");
    expect(r?.description).toMatch(/S256/);
  });

  it("rejects missing scope", () => {
    const r = validateProtocolParams({ ...baseParams, scope: "" });
    expect(r?.error).toBe("invalid_scope");
  });
});

describe("authorize validators — redirect builders", () => {
  it("builds a spec-compliant error redirect", () => {
    const url = buildErrorRedirect(
      "https://acme.example/cb",
      "xyz",
      "access_denied",
      "User denied."
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("error")).toBe("access_denied");
    expect(parsed.searchParams.get("error_description")).toBe("User denied.");
    expect(parsed.searchParams.get("state")).toBe("xyz");
  });

  it("routes OOB errors to the inline authorize page", () => {
    const url = buildErrorRedirect(
      "urn:ietf:wg:oauth:2.0:oob",
      "xyz",
      "invalid_scope",
      "bad scope"
    );
    expect(url.startsWith("/oauth/authorize?")).toBe(true);
    expect(url).toContain("error=invalid_scope");
  });

  it("builds a code redirect with state preserved", () => {
    const url = buildCodeRedirect(
      "https://acme.example/cb",
      "xyz",
      "cso_c_test"
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("code")).toBe("cso_c_test");
    expect(parsed.searchParams.get("state")).toBe("xyz");
  });

  it("routes OOB code to the code display route", () => {
    const url = buildCodeRedirect(
      "urn:ietf:wg:oauth:2.0:oob",
      "xyz",
      "cso_c_test"
    );
    expect(url.startsWith("/oauth/authorize/code?")).toBe(true);
  });
});

describe("authorize validators — consentCoversScopes", () => {
  it("returns true when granted is a superset", () => {
    expect(
      consentCoversScopes(
        ["context:read", "context:search", "context:bundles"],
        ["context:read", "context:search"]
      )
    ).toBe(true);
  });

  it("returns false when requested has a missing scope", () => {
    expect(
      consentCoversScopes(["context:read"], ["context:read", "context:propose"])
    ).toBe(false);
  });

  it("returns false for an empty request set (nothing to grant)", () => {
    expect(consentCoversScopes(["context:read"], [])).toBe(false);
  });

  it("is strict on box-narrowing: must match exactly", () => {
    const BOX_A = "11111111-1111-1111-1111-111111111111";
    const BOX_B = "22222222-2222-2222-2222-222222222222";
    expect(
      consentCoversScopes(
        [`context:read`, `context:box:${BOX_A}`],
        [`context:read`, `context:box:${BOX_B}`]
      )
    ).toBe(false);
    expect(
      consentCoversScopes(
        [`context:read`, `context:box:${BOX_A}`, `context:box:${BOX_B}`],
        [`context:read`, `context:box:${BOX_A}`]
      )
    ).toBe(true);
  });
});
