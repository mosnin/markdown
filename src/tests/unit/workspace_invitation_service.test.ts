import { describe, it, expect, vi, beforeEach } from "vitest";

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

  return {
    from: (table: string) => {
      if (table === "workspace_invitations") return fromInvitations();
      if (table === "workspace_memberships") return fromMemberships();
      throw new Error(`Unexpected table: ${table}`);
    },
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

      const result = await acceptInvitation(sb as never, "valid-token-123", "user-bob");

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
        acceptInvitation(sb as never, "already-member-token", "user-existing")
      ).rejects.toThrow(/already a member/i);

      // No new membership should be created
      expect(state.memberships).toHaveLength(1);
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
        acceptInvitation(sb as never, "expired-token-456", "user-charlie")
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
        acceptInvitation(sb as never, "nonexistent-token", "user-x")
      ).rejects.toThrow("not found");
    });
  });
});
