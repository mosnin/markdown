import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/auth/require_authenticated_user", () => ({ requireAuthenticatedUser: vi.fn() }));
vi.mock("@/server/services/oauth_client_service", () => ({
  getOAuthClientByClientId: vi.fn(),
  isRedirectUriAllowed: vi.fn(),
  _internalGetClientWithSecret: vi.fn(),
  verifyClientSecret: vi.fn(),
}));
vi.mock("@/server/services/oauth_scope_service", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/oauth_scope_service")>(
    "@/server/services/oauth_scope_service"
  );
  return { ...actual, resolveGrantedScopes: vi.fn() };
});
vi.mock("@/server/services/oauth_token_service", () => ({
  issueAuthorizationCode: vi.fn(),
  redeemAuthorizationCode: vi.fn(),
  issueTokenPair: vi.fn(),
  refreshTokenPair: vi.fn(),
  ACCESS_TOKEN_TTL_SECONDS: 3600,
}));
vi.mock("@/server/repositories/workspace_membership_repository", () => ({ listAccessibleWorkspaces: vi.fn() }));
vi.mock("@/server/repositories/box_repository", () => ({ listBoxesByWorkspace: vi.fn() }));
vi.mock("@/server/repositories/audit_event_repository", () => ({ createAuditEvent: vi.fn() }));

import { approveAuthorizeAction, denyAuthorizeAction } from "@/app/oauth/authorize/actions";
import { POST as tokenPost } from "@/app/api/oauth/token/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  getOAuthClientByClientId,
  isRedirectUriAllowed,
  _internalGetClientWithSecret,
} from "@/server/services/oauth_client_service";
import { resolveGrantedScopes } from "@/server/services/oauth_scope_service";
import {
  issueAuthorizationCode,
  redeemAuthorizationCode,
  issueTokenPair,
  refreshTokenPair,
} from "@/server/services/oauth_token_service";
import { listAccessibleWorkspaces } from "@/server/repositories/workspace_membership_repository";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";

const adminMockBase = {
  from: vi.fn((table: string) => {
    if (table === "oauth_refresh_tokens") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: "u1", workspace_id: "w1" } }),
      };
    }
    if (table === "oauth_consents") {
      return { upsert: vi.fn().mockResolvedValue({}) };
    }
    if (table === "oauth_clients") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "cid-1" } }),
      };
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue(adminMockBase as never);
  vi.mocked(createClient).mockResolvedValue({} as never);
  vi.mocked(requireAuthenticatedUser).mockResolvedValue({
    user: { id: "u1", email: "u@example.com" },
    workspace: { id: "w1", role: "member" },
  } as never);
  vi.mocked(getOAuthClientByClientId).mockResolvedValue({
    id: "cid-1",
    client_id: "client-1",
    allowed_scopes: ["context:read"],
  } as never);
  vi.mocked(isRedirectUriAllowed).mockReturnValue(true);
  vi.mocked(listAccessibleWorkspaces).mockResolvedValue([{ id: "w1", role: "member" }] as never);
  vi.mocked(listBoxesByWorkspace).mockResolvedValue([] as never);
  vi.mocked(resolveGrantedScopes).mockReturnValue({ ok: true, scopes: ["context:read"] } as never);
  vi.mocked(issueAuthorizationCode).mockResolvedValue({ code: "cso_c_test" } as never);
  vi.mocked(_internalGetClientWithSecret).mockResolvedValue({
    id: "cid-1",
    client_id: "client-1",
    is_confidential: false,
  } as never);
});

describe("OAuth authorize + token route flow", () => {
  it("approve authorize redirects with code", async () => {
    const fd = new FormData();
    fd.set("client_id", "client-1");
    fd.set("redirect_uri", "https://app.example/cb");
    fd.set("state", "s1");
    fd.set("code_challenge", "challenge");
    fd.set("scope", "context:read");
    fd.set("workspace_id", "w1");

    await expect(approveAuthorizeAction(fd)).rejects.toThrow(/REDIRECT:https:\/\/app.example\/cb\?code=/);
  });

  it("deny authorize redirects with access_denied", async () => {
    const fd = new FormData();
    fd.set("redirect_uri", "https://app.example/cb");
    fd.set("state", "s1");
    fd.set("client_id", "client-1");
    fd.set("workspace_id", "w1");

    await expect(denyAuthorizeAction(fd)).rejects.toThrow(/access_denied/);
  });

  it("token exchange succeeds with valid code and verifier", async () => {
    vi.mocked(redeemAuthorizationCode).mockResolvedValue({ ok: true, userId: "u1", workspaceId: "w1", scope: ["context:read"] } as never);
    vi.mocked(issueTokenPair).mockResolvedValue({ accessToken: "cso_a_x", refreshToken: "cso_r_y", scope: ["context:read"] } as never);

    const req = new NextRequest("https://x.test/api/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "cso_c_test",
        redirect_uri: "https://app.example/cb",
        code_verifier: "verifier",
        client_id: "client-1",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    const res = await tokenPost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe("cso_a_x");
  });

  it("token exchange fails for bad verifier", async () => {
    vi.mocked(redeemAuthorizationCode).mockResolvedValue({ ok: false, error: "invalid_grant" } as never);

    const req = new NextRequest("https://x.test/api/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "cso_c_test",
        redirect_uri: "https://app.example/cb",
        code_verifier: "wrong",
        client_id: "client-1",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    const res = await tokenPost(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_grant");
  });

  it("token exchange fails for bad redirect URI", async () => {
    vi.mocked(isRedirectUriAllowed).mockReturnValue(false);

    const req = new NextRequest("https://x.test/api/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "cso_c_test",
        redirect_uri: "https://bad.example/cb",
        code_verifier: "verifier",
        client_id: "client-1",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    const res = await tokenPost(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_grant");
  });

  it("refresh succeeds and revoked/expired refresh fails", async () => {
    vi.mocked(refreshTokenPair)
      .mockResolvedValueOnce({ accessToken: "cso_a_new", refreshToken: "cso_r_new", scope: ["context:read"] } as never)
      .mockResolvedValueOnce({ ok: false, error: "invalid_grant" } as never);

    const okReq = new NextRequest("https://x.test/api/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "cso_r_old", client_id: "client-1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const okRes = await tokenPost(okReq);
    expect(okRes.status).toBe(200);

    const badReq = new NextRequest("https://x.test/api/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "cso_r_old", client_id: "client-1" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const badRes = await tokenPost(badReq);
    expect(badRes.status).toBe(400);
  });
});
