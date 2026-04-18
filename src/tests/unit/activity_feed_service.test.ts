import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getActivityFeed,
  getUnreadCount,
  markAsRead,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/server/services/activity_feed_service";

/**
 * Unit tests for the activity feed service.
 *
 * Uses an in-memory stub for the Supabase client to verify:
 *  - Feed excludes the current user's own actions
 *  - Feed respects notification preference filters
 *  - Unread count resets after markAsRead
 *  - Cursor-based pagination via `before`
 */

// ─── Test helpers ───────────────────────────────────────────────────────────

interface FakeRow {
  [key: string]: unknown;
}

function makeAuditEvent(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: crypto.randomUUID(),
    workspace_id: "ws-1",
    actor_type: "user",
    actor_id: "other-user",
    object_type: "note",
    object_id: "note-1",
    event_type: "note.created",
    metadata: { title: "Test Note" },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Builds a fake Supabase client backed by in-memory tables.
 * Supports the subset of the query-builder API used by the service.
 */
function makeFakeSupabase(initialData: {
  audit_events?: FakeRow[];
  user_notification_preferences?: FakeRow[];
  user_feed_read_cursors?: FakeRow[];
} = {}) {
  const tables: Record<string, FakeRow[]> = {
    audit_events: initialData.audit_events ?? [],
    user_notification_preferences: initialData.user_notification_preferences ?? [],
    user_feed_read_cursors: initialData.user_feed_read_cursors ?? [],
  };

  function buildQuery(tableName: string) {
    let rows = [...(tables[tableName] ?? [])];
    const filters: Array<(r: FakeRow) => boolean> = [];
    let ordering: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let selectMode: "normal" | "count" = "normal";
    let headOnly = false;

    const chain: Record<string, unknown> = {
      select: (cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === "exact") selectMode = "count";
        if (opts?.head) headOnly = true;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return chain;
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val);
        return chain;
      },
      gt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) > (val as string));
        return chain;
      },
      lt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string) < (val as string));
        return chain;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => (vals as string[]).includes(r[col] as string));
        return chain;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        ordering = { col, asc: opts?.ascending ?? true };
        return chain;
      },
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      range: (_from: number, _to: number) => chain,
      insert: (row: FakeRow | FakeRow[]) => {
        const arr = Array.isArray(row) ? row : [row];
        tables[tableName]!.push(...arr);
        rows = arr;
        return chain;
      },
      update: (patch: FakeRow) => {
        // Apply filters, then patch matching rows
        let filtered = [...(tables[tableName] ?? [])];
        for (const f of filters) filtered = filtered.filter(f);
        for (const r of filtered) {
          Object.assign(r, patch);
        }
        rows = filtered;
        return chain;
      },
      single: async () => {
        let result = [...(tables[tableName] ?? [])];
        for (const f of filters) result = result.filter(f);
        return { data: result[0] ?? null, error: null };
      },
      maybeSingle: async () => {
        let result = [...(tables[tableName] ?? [])];
        for (const f of filters) result = result.filter(f);
        return { data: result[0] ?? null, error: null };
      },
      then: async (resolve: (val: unknown) => void) => {
        let result = rows;
        for (const f of filters) result = result.filter(f);
        if (ordering) {
          const { col, asc } = ordering;
          result.sort((a, b) => {
            if ((a[col] as string) < (b[col] as string)) return asc ? -1 : 1;
            if ((a[col] as string) > (b[col] as string)) return asc ? 1 : -1;
            return 0;
          });
        }
        if (limitN !== null) result = result.slice(0, limitN);
        if (selectMode === "count") {
          resolve({ count: result.length, error: null });
        } else if (headOnly) {
          resolve({ count: result.length, data: null, error: null });
        } else {
          resolve({ data: result, error: null });
        }
      },
    };

    return chain;
  }

  return {
    from: (tableName: string) => buildQuery(tableName),
    _tables: tables,
  } as unknown as Parameters<typeof getActivityFeed>[0];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("activity_feed_service", () => {
  const userId = "current-user";
  const otherUser = "other-user";
  const workspaceId = "ws-1";

  describe("getActivityFeed", () => {
    it("excludes the current user's own actions", async () => {
      const events = [
        makeAuditEvent({ actor_id: userId, event_type: "note.created", created_at: "2026-04-15T01:00:00Z" }),
        makeAuditEvent({ actor_id: otherUser, event_type: "note.created", created_at: "2026-04-15T02:00:00Z" }),
      ];

      const supabase = makeFakeSupabase({
        audit_events: events,
        user_notification_preferences: [{
          user_id: userId,
          workspace_id: workspaceId,
          note_created: true,
          note_updated: false,
          link_created: true,
          branch_promoted: true,
          member_joined: true,
          proposal_submitted: true,
          email_digest: "none",
          updated_at: "2026-04-15T00:00:00Z",
        }],
      });

      const result = await getActivityFeed(supabase, workspaceId, userId);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.actor_id).toBe(otherUser);
    });

    it("respects notification preference filters", async () => {
      const events = [
        makeAuditEvent({ actor_id: otherUser, event_type: "note.created", created_at: "2026-04-15T01:00:00Z" }),
        makeAuditEvent({ actor_id: otherUser, event_type: "note.updated", created_at: "2026-04-15T02:00:00Z" }),
        makeAuditEvent({ actor_id: otherUser, event_type: "note_link.created", created_at: "2026-04-15T03:00:00Z" }),
      ];

      const supabase = makeFakeSupabase({
        audit_events: events,
        user_notification_preferences: [{
          user_id: userId,
          workspace_id: workspaceId,
          note_created: true,
          note_updated: false, // disabled
          link_created: false, // disabled
          branch_promoted: true,
          member_joined: true,
          proposal_submitted: true,
          email_digest: "none",
          updated_at: "2026-04-15T00:00:00Z",
        }],
      });

      const result = await getActivityFeed(supabase, workspaceId, userId);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.event_type).toBe("note.created");
    });

    it("supports cursor-based pagination via before", async () => {
      const events = [
        makeAuditEvent({
          actor_id: otherUser,
          event_type: "note.created",
          created_at: "2026-04-15T01:00:00Z",
          id: "ev-1",
        }),
        makeAuditEvent({
          actor_id: otherUser,
          event_type: "note.created",
          created_at: "2026-04-15T02:00:00Z",
          id: "ev-2",
        }),
        makeAuditEvent({
          actor_id: otherUser,
          event_type: "note.created",
          created_at: "2026-04-15T03:00:00Z",
          id: "ev-3",
        }),
      ];

      const supabase = makeFakeSupabase({
        audit_events: events,
        user_notification_preferences: [{
          user_id: userId,
          workspace_id: workspaceId,
          note_created: true,
          note_updated: false,
          link_created: true,
          branch_promoted: true,
          member_joined: true,
          proposal_submitted: true,
          email_digest: "none",
          updated_at: "2026-04-15T00:00:00Z",
        }],
      });

      // Ask for events before the most recent one
      const result = await getActivityFeed(supabase, workspaceId, userId, {
        before: "2026-04-15T03:00:00Z",
      });

      // Should not include the event at 03:00
      for (const item of result.items) {
        expect(item.created_at < "2026-04-15T03:00:00Z").toBe(true);
      }
    });
  });

  describe("getUnreadCount / markAsRead", () => {
    it("returns unread count based on cursor", async () => {
      const events = [
        makeAuditEvent({
          actor_id: otherUser,
          event_type: "note.created",
          created_at: "2026-04-15T01:00:00Z",
        }),
        makeAuditEvent({
          actor_id: otherUser,
          event_type: "note.created",
          created_at: "2026-04-15T02:00:00Z",
        }),
        makeAuditEvent({
          actor_id: otherUser,
          event_type: "note.created",
          created_at: "2026-04-15T03:00:00Z",
        }),
      ];

      const supabase = makeFakeSupabase({
        audit_events: events,
        user_notification_preferences: [{
          user_id: userId,
          workspace_id: workspaceId,
          note_created: true,
          note_updated: false,
          link_created: true,
          branch_promoted: true,
          member_joined: true,
          proposal_submitted: true,
          email_digest: "none",
          updated_at: "2026-04-15T00:00:00Z",
        }],
        user_feed_read_cursors: [{
          user_id: userId,
          workspace_id: workspaceId,
          last_read_at: "2026-04-15T01:30:00Z",
        }],
      });

      const count = await getUnreadCount(supabase, workspaceId, userId);
      // Events at 02:00 and 03:00 are after the cursor
      expect(count).toBe(2);
    });

    it("resets unread count after markAsRead", async () => {
      const events = [
        makeAuditEvent({
          actor_id: otherUser,
          event_type: "note.created",
          created_at: "2026-04-15T01:00:00Z",
        }),
        makeAuditEvent({
          actor_id: otherUser,
          event_type: "note.created",
          created_at: "2026-04-15T02:00:00Z",
        }),
      ];

      const supabase = makeFakeSupabase({
        audit_events: events,
        user_notification_preferences: [{
          user_id: userId,
          workspace_id: workspaceId,
          note_created: true,
          note_updated: false,
          link_created: true,
          branch_promoted: true,
          member_joined: true,
          proposal_submitted: true,
          email_digest: "none",
          updated_at: "2026-04-15T00:00:00Z",
        }],
      });

      // Initially no cursor -> all events since epoch are unread
      const countBefore = await getUnreadCount(supabase, workspaceId, userId);
      expect(countBefore).toBe(2);

      // Mark as read
      await markAsRead(supabase, workspaceId, userId);

      // Now unread count should be 0 (cursor is advanced past all events)
      const countAfter = await getUnreadCount(supabase, workspaceId, userId);
      expect(countAfter).toBe(0);
    });
  });

  describe("getNotificationPreferences", () => {
    it("returns defaults when no row exists", async () => {
      const supabase = makeFakeSupabase();
      const prefs = await getNotificationPreferences(supabase, userId, workspaceId);

      expect(prefs.note_created).toBe(true);
      expect(prefs.note_updated).toBe(false);
      expect(prefs.link_created).toBe(true);
      expect(prefs.email_digest).toBe("none");
    });

    it("returns stored preferences when row exists", async () => {
      const supabase = makeFakeSupabase({
        user_notification_preferences: [{
          user_id: userId,
          workspace_id: workspaceId,
          note_created: false,
          note_updated: true,
          link_created: false,
          branch_promoted: false,
          member_joined: true,
          proposal_submitted: false,
          email_digest: "daily",
          updated_at: "2026-04-15T00:00:00Z",
        }],
      });

      const prefs = await getNotificationPreferences(supabase, userId, workspaceId);
      expect(prefs.note_created).toBe(false);
      expect(prefs.note_updated).toBe(true);
      expect(prefs.email_digest).toBe("daily");
    });
  });
});
