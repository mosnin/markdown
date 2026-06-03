import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the workspace invitation service.
 *
 * Invariants:
 *
 *   1. createInvitation generates a unique 64-char hex token.
 *   2. acceptInvitation creates a workspace_membership with the correct role.
 *   3. Expired tokens are rejected on accept.
 *   4. Duplicate email+workspace invitations are rejected.
 *   5. revokeInvitation marks the invitation as expired.
 *
 * Mocking strategy: we install a minimal Supabase builder backed by
 * in-memory arrays so the service logic is testable without a database.
 */

import {
  createInvitation,
  acceptInvitation,
  declineInvitation,
  listPendingInvitations,
  revokeInvitation,
  generateToken,
  type WorkspaceInvitation,
} from "@/server/services/workspace_invitation_service";

// ─── Helpers ────────────────────────────────────────────────────────────────

interface InvRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  token: string;
  invited_by: string;
  status: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

interface MemberRow extends Record<string, unknown> {
  workspace_id: string;
  user_id: string;
  role: string;
  invited_by: string;
  accepted_at: string;
}

interface MockState {
  invitations: InvRow[];
  memberships: MemberRow[];
}

function makeFakeSupabase(state: MockState) {
  let autoId = state.invitations.length;

  function fromInvitations() {
    let filters: Record<string, unknown> = {};
    let pendingUpdate: Record<string, unknown> | null = null;

    const chain: Record<string, unknown> = {};

    chain.select = (_cols?: string) => {
      const s: Record<string, unknown> = {};
      s.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return s;
      };
      s.order = (_col: string, _opts?: unknown) => s;
      s.maybeSingle = async () => {
        const row = state.invitations.find((r) =>
          Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
        );
        return { data: row ?? null, error: null };
      };
      s.single = async () => {
        const row = state.invitations.find((r) =>
          Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
        );
        if (!row) return { data: null, error: { message: "Not found" } };
        return { data: row, error: null };
      };
      // For returning all matching rows
      s.then = (resolve: (val: { data: InvRow[]; error: null }) => void) => {
        const rows = state.invitations.filter((r) =>
          Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
        );
        resolve({ data: rows, error: null });
        return s;
      };
      return s;
    };

    chain.insert = (payload: Record<string, unknown>) => {
      // Check for duplicate
      const hasDupe = state.invitations.some(
        (r) =>
          r.workspace_id === payload.workspace_id &&
          r.email === payload.email &&
          r.status === "pending"
      );
      if (hasDupe) {
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { message: "duplicate key value (23505)" },
            }),
          }),
        };
      }

      autoId++;
      const row: InvRow = {
        id: `inv-${autoId}`,
        workspace_id: payload.workspace_id as string,
        email: payload.email as string,
        role: payload.role as string,
        token: payload.token as string,
        invited_by: payload.invited_by as string,
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        accepted_at: null,
        created_at: new Date().toISOString(),
      };
      state.invitations.push(row);
      return {
        select: () => ({
          single: async () => ({ data: row, error: null }),
        }),
      };
    };

    chain.update = (patch: Record<string, unknown>) => {
      pendingUpdate = patch;
      const u: Record<string, unknown> = {};
      u.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return u;
      };
      u.select = () => {
        // Apply the update to matching rows
        const idx = state.invitations.findIndex((r) =>
          Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
        );
        if (idx >= 0 && pendingUpdate) {
          Object.assign(state.invitations[idx], pendingUpdate);
        }
        const row = idx >= 0 ? state.invitations[idx] : null;
        return {
          single: async () => {
            if (!row) return { data: null, error: { message: "Not found" } };
            return { data: row, error: null };
          },
        };
      };
      // For updates without .select() (like revokeInvitation)
      u.then = (resolve: (val: { error: null }) => void) => {
        const idx = state.invitations.findIndex((r) =>
          Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
        );
        if (idx >= 0 && pendingUpdate) {
          Object.assign(state.invitations[idx], pendingUpdate);
        }
        resolve({ error: null });
        return u;
      };
      return u;
    };

    return chain;
  }

  function fromMemberships() {
    let filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    chain.select = (_cols?: string) => {
      const s: Record<string, unknown> = {};
      s.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return s;
      };
      s.maybeSingle = async () => {
        const row = state.memberships.find((r) =>
          Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v)
        );
        return { data: row ?? null, error: null };
      };
      return s;
    };
    chain.upsert = (payload: Record<string, unknown>, _opts?: unknown) => {
      const existing = state.memberships.find(
        (m) => m.workspace_id === payload.workspace_id && m.user_id === payload.user_id
      );
      if (existing) {
        Object.assign(existing, payload);
      } else {
        state.memberships.push(payload as MemberRow);
      }
      return { error: null };
    };
    return chain;
  }

  // Mirrors the accept_workspace_invitation SECURITY DEFINER function
  // (migration 20260430000003): validate the invitation, insert the
  // membership at its role, mark it accepted, return the workspace id.
  // The real RPC runs in Postgres; this in-memory stand-in lets the
  // service's RPC call resolve against the same arrays the rest of the
  // mock mutates.
  function rpc(
    name: string,
    args: { p_token: string; p_user_id: string; p_user_email: string }
  ) {
    if (name !== "accept_workspace_invitation") {
      return Promise.resolve({
        data: null,
        error: { message: `Unexpected rpc: ${name}` },
      });
    }
    const inv = state.invitations.find(
      (r) => r.token === args.p_token && r.status === "pending"
    );
    if (!inv) {
      return Promise.resolve({
        data: null,
        error: { message: "Invitation not found or already used." },
      });
    }
    if (new Date(inv.expires_at) < new Date()) {
      inv.status = "expired";
      return Promise.resolve({
        data: null,
        error: { message: "This invitation has expired." },
      });
    }
    if (inv.email.toLowerCase() !== args.p_user_email.toLowerCase()) {
      return Promise.resolve({
        data: null,
        error: {
          message:
            "This invitation was issued to a different email address.",
        },
      });
    }
    const existing = state.memberships.find(
      (m) => m.workspace_id === inv.workspace_id && m.user_id === args.p_user_id
    );
    if (!existing) {
      state.memberships.push({
        workspace_id: inv.workspace_id,
        user_id: args.p_user_id,
        role: inv.role,
        invited_by: inv.invited_by,
        accepted_at: new Date().toISOString(),
      });
    }
    inv.status = "accepted";
    inv.accepted_at = new Date().toISOString();
    return Promise.resolve({ data: inv.workspace_id, error: null });
  }

  return {
    from: (table: string) => {
      if (table === "workspace_invitations") return fromInvitations();
      if (table === "workspace_memberships") return fromMemberships();
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("workspace_invitation_service", () => {
  let state: MockState;

  beforeEach(() => {
    state = { invitations: [], memberships: [] };
  });

  // 1. Token generation
  describe("generateToken", () => {
    it("generates a 64-character hex string", () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it("generates unique tokens on successive calls", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  // 2. Create invitation
  describe("createInvitation", () => {
    it("creates an invitation with a unique token", async () => {
      const sb = makeFakeSupabase(state);
      const inv = await createInvitation(sb as never, {
        workspaceId: "ws-1",
        email: "alice@example.com",
        role: "member",
        invitedBy: "user-admin",
      });
      expect(inv.token).toHaveLength(64);
      expect(inv.email).toBe("alice@example.com");
      expect(inv.role).toBe("member");
      expect(inv.status).toBe("pending");
      expect(state.invitations).toHaveLength(1);
    });

    it("normalizes email to lowercase", async () => {
      const sb = makeFakeSupabase(state);
      const inv = await createInvitation(sb as never, {
        workspaceId: "ws-1",
        email: "  Alice@Example.COM  ",
        role: "admin",
        invitedBy: "user-admin",
      });
      expect(inv.email).toBe("alice@example.com");
    });
  });

  // 2b. Invitation email delivery
  describe("createInvitation — email delivery", () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.RESEND_API_KEY;
    const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const originalFromDomain = process.env.RESEND_FROM_DOMAIN;

    beforeEach(() => {
      process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.com";
      process.env.RESEND_FROM_DOMAIN = "mail.example.com";
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalKey;
      if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
      if (originalFromDomain === undefined) delete process.env.RESEND_FROM_DOMAIN;
      else process.env.RESEND_FROM_DOMAIN = originalFromDomain;
    });

    it("posts to the Resend API when RESEND_API_KEY is set", async () => {
      process.env.RESEND_API_KEY = "re_test_key_123";

      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ id: "email_1" }), { status: 200 })
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const sb = makeFakeSupabase(state);
      const inv = await createInvitation(sb as never, {
        workspaceId: "ws-1",
        email: "alice@example.com",
        role: "member",
        invitedBy: "user-admin",
        workspaceName: "Acme Engineering",
        inviterName: "Bob Admin",
      });

      // Invitation itself committed normally.
      expect(inv.email).toBe("alice@example.com");
      expect(state.invitations).toHaveLength(1);

      // Fetch called exactly once against Resend.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      const [url, init] = call;
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer re_test_key_123");
      expect(headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(init.body as string) as {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
      };
      expect(body.from).toBe("Context Store <invites@mail.example.com>");
      expect(body.to).toEqual(["alice@example.com"]);
      expect(body.subject).toBe(
        "You're invited to Acme Engineering on Context Store"
      );
      expect(body.html).toContain(`https://app.example.com/invite/${inv.token}`);
      expect(body.html).toContain("Acme Engineering");
      expect(body.html).toContain("Bob Admin");
      expect(body.text).toContain(`https://app.example.com/invite/${inv.token}`);
    });

    it("does NOT fail createInvitation when RESEND_API_KEY is unset", async () => {
      delete process.env.RESEND_API_KEY;

      const fetchSpy = vi.fn(async () => new Response("should not be called"));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const sb = makeFakeSupabase(state);
      const inv = await createInvitation(sb as never, {
        workspaceId: "ws-1",
        email: "carol@example.com",
        role: "viewer",
        invitedBy: "user-admin",
        workspaceName: "Acme",
        inviterName: "Bob",
      });

      // Invitation still persisted and returned.
      expect(inv.email).toBe("carol@example.com");
      expect(state.invitations).toHaveLength(1);

      // fetch MUST NOT be called when the key is missing.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("swallows Resend HTTP failures so DB insert is not rolled back", async () => {
      process.env.RESEND_API_KEY = "re_test_key_123";

      // Simulate a Resend 5xx: createInvitation must still resolve.
      globalThis.fetch = vi.fn(
        async () => new Response("boom", { status: 500 })
      ) as unknown as typeof fetch;

      const sb = makeFakeSupabase(state);
      const inv = await createInvitation(sb as never, {
        workspaceId: "ws-1",
        email: "dana@example.com",
        role: "member",
        invitedBy: "user-admin",
      });

      expect(inv.email).toBe("dana@example.com");
      expect(state.invitations).toHaveLength(1);
    });
  });

  // 3. Duplicate rejection
  describe("duplicate email+workspace", () => {
    it("rejects a second pending invitation for the same email+workspace", async () => {
      const sb = makeFakeSupabase(state);
      await createInvitation(sb as never, {
        workspaceId: "ws-1",
        email: "alice@example.com",
        role: "member",
        invitedBy: "user-admin",
      });

      await expect(
        createInvitation(sb as never, {
          workspaceId: "ws-1",
          email: "alice@example.com",
          role: "admin",
          invitedBy: "user-admin",
        })
      ).rejects.toThrow("already pending");
    });
  });

  // 4. Accept creates membership with correct role
  describe("acceptInvitation", () => {
    it("creates a membership with the invitation's role", async () => {
      const sb = makeFakeSupabase(state);

      // Seed a pending invitation
      state.invitations.push({
        id: "inv-accept-1",
        workspace_id: "ws-1",
        email: "bob@example.com",
        role: "admin",
        token: "valid-token-123",
        invited_by: "user-admin",
        status: "pending",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        accepted_at: null,
        created_at: new Date().toISOString(),
      });

      const result = await acceptInvitation(
        sb as never,
        "valid-token-123",
        "user-bob",
        "bob@example.com"
      );

      expect(result.status).toBe("accepted");
      expect(result.accepted_at).toBeTruthy();

      // Check that a membership was created
      expect(state.memberships).toHaveLength(1);
      expect(state.memberships[0].user_id).toBe("user-bob");
      expect(state.memberships[0].role).toBe("admin");
      expect(state.memberships[0].workspace_id).toBe("ws-1");
    });
  });

  // 4b. Accept rejects already-member
  describe("acceptInvitation — already member", () => {
    it("rejects if user is already a member of the workspace", async () => {
      // Seed an existing membership
      state.memberships.push({
        workspace_id: "ws-1",
        user_id: "user-existing",
        role: "member",
        invited_by: "user-admin",
        accepted_at: new Date().toISOString(),
      });

      // Seed a pending invitation for the same user
      state.invitations.push({
        id: "inv-already-member",
        workspace_id: "ws-1",
        email: "existing@example.com",
        role: "admin",
        token: "already-member-token",
        invited_by: "user-admin",
        status: "pending",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        accepted_at: null,
        created_at: new Date().toISOString(),
      });

      const sb = makeFakeSupabase(state);
      await expect(
        acceptInvitation(
          sb as never,
          "already-member-token",
          "user-existing",
          "existing@example.com"
        )
      ).rejects.toThrow(/already a member/i);

      // No new membership should be created
      expect(state.memberships).toHaveLength(1);
    });
  });

  // 4c. Accept rejects an email that doesn't match the invitation
  describe("acceptInvitation — email mismatch", () => {
    it("rejects when the caller's email differs from the invitation", async () => {
      state.invitations.push({
        id: "inv-mismatch-1",
        workspace_id: "ws-1",
        email: "intended@example.com",
        role: "member",
        token: "mismatch-token",
        invited_by: "user-admin",
        status: "pending",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        accepted_at: null,
        created_at: new Date().toISOString(),
      });

      const sb = makeFakeSupabase(state);
      await expect(
        acceptInvitation(
          sb as never,
          "mismatch-token",
          "user-attacker",
          "attacker@example.com"
        )
      ).rejects.toThrow(/different email/i);

      // No membership created and the invitation stays pending.
      expect(state.memberships).toHaveLength(0);
      expect(state.invitations[0].status).toBe("pending");
    });
  });

  // 5. Expired token rejected
  describe("expired token", () => {
    it("rejects an expired invitation", async () => {
      const sb = makeFakeSupabase(state);

      // Seed an expired invitation (still pending status, but past expiry)
      state.invitations.push({
        id: "inv-expired-1",
        workspace_id: "ws-1",
        email: "charlie@example.com",
        role: "member",
        token: "expired-token-456",
        invited_by: "user-admin",
        status: "pending",
        expires_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        accepted_at: null,
        created_at: new Date().toISOString(),
      });

      await expect(
        acceptInvitation(
          sb as never,
          "expired-token-456",
          "user-charlie",
          "charlie@example.com"
        )
      ).rejects.toThrow("expired");

      // Should not have created a membership
      expect(state.memberships).toHaveLength(0);

      // Invitation should be marked as expired
      expect(state.invitations[0].status).toBe("expired");
    });
  });

  // 6. Revoke marks invitation
  describe("revokeInvitation", () => {
    it("marks a pending invitation as expired", async () => {
      const sb = makeFakeSupabase(state);

      state.invitations.push({
        id: "inv-revoke-1",
        workspace_id: "ws-1",
        email: "dave@example.com",
        role: "viewer",
        token: "revoke-token-789",
        invited_by: "user-admin",
        status: "pending",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        accepted_at: null,
        created_at: new Date().toISOString(),
      });

      await revokeInvitation(sb as never, "inv-revoke-1", "user-admin");

      expect(state.invitations[0].status).toBe("expired");
    });
  });

  // 7. Decline
  describe("declineInvitation", () => {
    it("marks a pending invitation as declined", async () => {
      const sb = makeFakeSupabase(state);

      state.invitations.push({
        id: "inv-decline-1",
        workspace_id: "ws-1",
        email: "eve@example.com",
        role: "member",
        token: "decline-token-abc",
        invited_by: "user-admin",
        status: "pending",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        accepted_at: null,
        created_at: new Date().toISOString(),
      });

      const result = await declineInvitation(sb as never, "decline-token-abc");
      expect(result.status).toBe("declined");
    });
  });

  // 8. List pending
  describe("listPendingInvitations", () => {
    it("returns only pending invitations for the workspace", async () => {
      const sb = makeFakeSupabase(state);

      state.invitations.push(
        {
          id: "inv-list-1",
          workspace_id: "ws-1",
          email: "a@example.com",
          role: "member",
          token: "tok-1",
          invited_by: "user-admin",
          status: "pending",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          accepted_at: null,
          created_at: new Date().toISOString(),
        },
        {
          id: "inv-list-2",
          workspace_id: "ws-1",
          email: "b@example.com",
          role: "admin",
          token: "tok-2",
          invited_by: "user-admin",
          status: "accepted",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          accepted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        {
          id: "inv-list-3",
          workspace_id: "ws-2",
          email: "c@example.com",
          role: "viewer",
          token: "tok-3",
          invited_by: "user-admin",
          status: "pending",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          accepted_at: null,
          created_at: new Date().toISOString(),
        }
      );

      // The mock's `from().select().eq().eq().order()` returns a thenable.
      // listPendingInvitations awaits the query result.
      const pending = await listPendingInvitations(sb as never, "ws-1");

      // Our mock returns all matching rows; service filters by status=pending + workspace_id=ws-1
      expect(pending).toHaveLength(1);
      expect(pending[0].email).toBe("a@example.com");
    });
  });

  // 9. Non-existent token
  describe("non-existent token", () => {
    it("throws when accepting a non-existent token", async () => {
      const sb = makeFakeSupabase(state);

      await expect(
        acceptInvitation(
          sb as never,
          "nonexistent-token",
          "user-x",
          "x@example.com"
        )
      ).rejects.toThrow("not found");
    });
  });
});
