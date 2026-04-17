"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

/**
 * Presence payload for a single user on a branch. Matches the shape
 * clients `track()` into the Supabase Realtime presence channel. Kept
 * flat so a future heartbeat debug overlay can inspect it without
 * shape-trickery.
 */
export interface PresentUser {
  user_id: string;
  display_name: string;
  joined_at: string;
}

/** Payload variant carried on the workspace-wide list channel so the
 * hook can cluster users by which branch row they're currently on. */
interface PresentUserWithBranch extends PresentUser {
  branch_id: string;
}

/**
 * Live presence for a single branch detail page. Subscribes to the
 * `branch_presence:${branchId}` channel, tracks `self` on SUBSCRIBED,
 * and flattens the channel's presence state on every `sync` event
 * into a stable list of PresentUser rows.
 *
 * Returns an empty list (and skips the subscribe) when `self.user_id`
 * is falsy (unauthenticated or transient). Cleanly untracks + removes
 * the channel on unmount — the browser's SSE connection is closed
 * via `removeChannel`, which is what Supabase docs recommend so that
 * the server-side presence state is updated immediately rather than
 * waiting for the heartbeat timeout.
 */
export function useBranchPresence(
  branchId: string,
  self: { user_id: string; display_name: string }
): PresentUser[] {
  const [users, setUsers] = useState<PresentUser[]>([]);
  // Hold onto `self` via a ref so the effect dependency array can key
  // on the scalar `user_id` / `display_name` without re-subscribing
  // each render if the caller passes a freshly-allocated object.
  const selfRef = useRef(self);
  selfRef.current = self;

  useEffect(() => {
    if (!self.user_id) {
      setUsers([]);
      return;
    }
    const supabase = createClient();
    const channel = supabase.channel(`branch_presence:${branchId}`, {
      config: { presence: { key: self.user_id } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresentUser>();
      const flat: PresentUser[] = [];
      for (const key of Object.keys(state)) {
        const metas = state[key];
        // The key is the user_id we configured; we take the newest
        // meta entry per user so if a user has two tabs open they
        // still render as one avatar with the most recent joined_at.
        if (metas && metas.length > 0) {
          const newest = metas.reduce((a, b) =>
            (a.joined_at ?? "") > (b.joined_at ?? "") ? a : b
          );
          flat.push({
            user_id: newest.user_id ?? key,
            display_name: newest.display_name ?? key,
            joined_at: newest.joined_at ?? new Date(0).toISOString(),
          });
        }
      }
      // Sort oldest-first so the avatar row has a stable order — newly
      // arriving users slot at the end rather than reshuffling.
      flat.sort((a, b) => a.joined_at.localeCompare(b.joined_at));
      setUsers(flat);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track({
          user_id: selfRef.current.user_id,
          display_name: selfRef.current.display_name,
          joined_at: new Date().toISOString(),
        });
      }
    });

    return () => {
      // Untrack explicitly so other clients see the leave event
      // immediately. removeChannel also closes the underlying socket
      // subscription, which is what flushes the presence state on the
      // server side.
      void channel.untrack().finally(() => {
        void supabase.removeChannel(channel);
      });
    };
  }, [branchId, self.user_id, self.display_name]);

  return users;
}

/**
 * Workspace-wide variant used by the branch list page. A single
 * channel (`branch_presence_list:${workspaceId}`) carries payloads of
 * shape `{ user_id, display_name, joined_at, branch_id }`. The list
 * page doesn't advertise any branch affiliation itself (no one is
 * "viewing" a specific branch on the list view), so it only
 * subscribes — it does not `track` anything. Detail pages elsewhere
 * write into the same channel when desired, but the current design
 * keeps per-branch presence on the per-branch channel and uses this
 * hook as a read-only aggregator for surfaces that don't have the
 * branch-specific channel open. In practice, the list page returns
 * an empty map until a future enhancement wires detail pages to
 * mirror into the workspace channel.
 *
 * Tracks the caller under presence key `self.user_id` with an empty
 * `branch_id = ""` so the caller shows up in the workspace channel
 * for debug tools; consumers filter by `branch_id !== ""`.
 */
export function useWorkspacePresenceForBranches(
  workspaceId: string,
  self: { user_id: string; display_name: string }
): Record<string, PresentUser[]> {
  const [byBranch, setByBranch] = useState<Record<string, PresentUser[]>>({});
  const selfRef = useRef(self);
  selfRef.current = self;

  useEffect(() => {
    if (!self.user_id || !workspaceId) {
      setByBranch({});
      return;
    }
    const supabase = createClient();
    const channel = supabase.channel(`branch_presence_list:${workspaceId}`, {
      config: { presence: { key: self.user_id } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresentUserWithBranch>();
      const grouped: Record<string, PresentUser[]> = {};
      for (const key of Object.keys(state)) {
        const metas = state[key];
        if (!metas) continue;
        // A single user can be present on multiple branches from
        // different tabs; we keep one entry per (user, branch).
        const seen = new Set<string>();
        for (const m of metas) {
          const branchId = m.branch_id ?? "";
          if (!branchId) continue;
          const dedupeKey = `${m.user_id ?? key}:${branchId}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          const arr = grouped[branchId] ?? [];
          arr.push({
            user_id: m.user_id ?? key,
            display_name: m.display_name ?? key,
            joined_at: m.joined_at ?? new Date(0).toISOString(),
          });
          grouped[branchId] = arr;
        }
      }
      for (const bid of Object.keys(grouped)) {
        grouped[bid].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
      }
      setByBranch(grouped);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Track with a sentinel empty branch_id so the list viewer
        // appears in the channel roster without being attributed to
        // any single branch row.
        void channel.track({
          user_id: selfRef.current.user_id,
          display_name: selfRef.current.display_name,
          joined_at: new Date().toISOString(),
          branch_id: "",
        });
      }
    });

    return () => {
      void channel.untrack().finally(() => {
        void supabase.removeChannel(channel);
      });
    };
  }, [workspaceId, self.user_id, self.display_name]);

  return byBranch;
}
