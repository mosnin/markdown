import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration-level unit tests for require_authenticated_user.ts and
 * the underlying get_request_context.ts.
 *
 * requireAuthenticatedUser delegates entirely to getRequestContext and then
 * either calls redirect('/sign_in') or returns the context. We therefore:
 *   1. Mock createClient (Supabase) so auth.getUser() is controllable.
 *   2. Mock next/navigation redirect so it throws (matching Next.js behaviour
 *      in non-request contexts) and can be asserted.
 *   3. Mock next/headers cookies so the workspace cookie read doesn't fail.
 *   4. Mock getOrCreateDefaultWorkspace so we skip the real DB bootstrap.
 *
 * Covers:
 *   - Returns full context (user + workspace) when Supabase session is valid
 *   - Calls redirect('/sign_in') when session is missing (unauthenticated)
 *   - Calls redirect('/sign_in') when Supabase returns an error (null user)
 */

// ─── Mock declarations (must be before any imports that reference them) ───────

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    // Mimic Next.js: redirect() throws a special NEXT_REDIRECT error at runtime.
    const err = new Error(`NEXT_REDIRECT:${path}`);
    (err as NodeJS.ErrnoException).code = "NEXT_REDIRECT";
    throw err;
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/server/services/workspace_bootstrap/get_or_create_default_workspace", () => ({
  getOrCreateDefaultWorkspace: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { getRequestContext } from "@/server/auth/get_request_context";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/server/services/workspace_bootstrap/get_or_create_default_workspace";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// ─── Constants ────────────────────────────────────────────────────────────────

const FAKE_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "alice@example.com",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
};

const FAKE_WORKSPACE = {
  id: "ws-111",
  name: "Alice WS",
  slug: "alice-ws",
  owner_id: FAKE_USER.id,
  role: "admin" as const,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSupabaseWithUser(user: unknown) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("requireAuthenticatedUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: cookies() returns empty store (no active_workspace / branch cookies)
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as never);
  });

  it("returns user and workspace context when Supabase session is valid", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseWithUser(FAKE_USER) as never);
    vi.mocked(getOrCreateDefaultWorkspace).mockResolvedValue({
      id: FAKE_WORKSPACE.id,
      name: FAKE_WORKSPACE.name,
      slug: FAKE_WORKSPACE.slug,
      owner_id: FAKE_WORKSPACE.owner_id,
      role: FAKE_WORKSPACE.role,
    } as never);

    const ctx = await requireAuthenticatedUser();

    expect(ctx.user).toMatchObject({ id: FAKE_USER.id, email: FAKE_USER.email });
    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.workspace).toMatchObject({
      id: FAKE_WORKSPACE.id,
      name: FAKE_WORKSPACE.name,
      slug: FAKE_WORKSPACE.slug,
    });
  });

  it("redirects to /sign_in when session is missing (no user)", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseWithUser(null) as never);

    await expect(requireAuthenticatedUser()).rejects.toThrow("NEXT_REDIRECT:/sign_in");
    expect(redirect).toHaveBeenCalledWith("/sign_in");
  });

  it("redirects to /sign_in when Supabase getUser returns null (error path)", async () => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "JWT expired" } }),
      },
    };
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    await expect(requireAuthenticatedUser()).rejects.toThrow("NEXT_REDIRECT:/sign_in");
    expect(redirect).toHaveBeenCalledWith("/sign_in");
  });

  it("does not call getOrCreateDefaultWorkspace when unauthenticated", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseWithUser(null) as never);

    await expect(requireAuthenticatedUser()).rejects.toThrow("NEXT_REDIRECT:/sign_in");
    expect(getOrCreateDefaultWorkspace).not.toHaveBeenCalled();
  });

  it("passes the preferred workspace cookie value to getOrCreateDefaultWorkspace", async () => {
    const PREFERRED_WS_ID = "ws-preferred-99";
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn((key: string) =>
        key === "active_workspace_id" ? { value: PREFERRED_WS_ID } : undefined
      ),
    } as never);

    vi.mocked(createClient).mockResolvedValue(makeSupabaseWithUser(FAKE_USER) as never);
    vi.mocked(getOrCreateDefaultWorkspace).mockResolvedValue({
      id: PREFERRED_WS_ID,
      name: "Preferred WS",
      slug: "preferred-ws",
      owner_id: FAKE_USER.id,
      role: "admin" as const,
    } as never);

    const ctx = await requireAuthenticatedUser();
    expect(getOrCreateDefaultWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      FAKE_USER.id,
      PREFERRED_WS_ID
    );
    expect(ctx.workspace?.id).toBe(PREFERRED_WS_ID);
  });
});

// ─── getRequestContext (lower-level, no redirect) ────────────────────────────

describe("getRequestContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as never);
  });

  it("returns isAuthenticated=false and nulls when user is absent", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseWithUser(null) as never);

    const ctx = await getRequestContext();

    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.user).toBeNull();
    expect(ctx.workspace).toBeNull();
    expect(ctx.activeBranchId).toBeNull();
  });

  it("returns isAuthenticated=true with workspace when user is present", async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseWithUser(FAKE_USER) as never);
    vi.mocked(getOrCreateDefaultWorkspace).mockResolvedValue({
      ...FAKE_WORKSPACE,
    } as never);

    const ctx = await getRequestContext();

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.user?.id).toBe(FAKE_USER.id);
    expect(ctx.workspace?.id).toBe(FAKE_WORKSPACE.id);
  });

  it("resolves active branch when cookie points to an open branch in the right workspace", async () => {
    const BRANCH_ID = "branch-abc";
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn((key: string) =>
        key === "active_branch_id" ? { value: BRANCH_ID } : undefined
      ),
    } as never);

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: FAKE_USER }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === "draft_branches") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: BRANCH_ID, workspace_id: FAKE_WORKSPACE.id, status: "open" },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    vi.mocked(getOrCreateDefaultWorkspace).mockResolvedValue({
      ...FAKE_WORKSPACE,
    } as never);

    const ctx = await getRequestContext();

    expect(ctx.activeBranchId).toBe(BRANCH_ID);
  });

  it("clears activeBranchId when branch belongs to a different workspace", async () => {
    const BRANCH_ID = "branch-stale";
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn((key: string) =>
        key === "active_branch_id" ? { value: BRANCH_ID } : undefined
      ),
    } as never);

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: FAKE_USER }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === "draft_branches") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: BRANCH_ID, workspace_id: "OTHER-WS", status: "open" },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    vi.mocked(getOrCreateDefaultWorkspace).mockResolvedValue({
      ...FAKE_WORKSPACE,
    } as never);

    const ctx = await getRequestContext();
    expect(ctx.activeBranchId).toBeNull();
  });
});
