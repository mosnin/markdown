"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

/**
 * Presence payload for a single user editing a note. Kept flat and
 * intentionally parallel to the branch presence shape so consumers
 * can share avatar rendering components.
 */
export interface NotePresentUser {
  user_id: string;
  display_name: string;
  cursor_line?: number;
  joined_at: string;
}

/**
 * Live presence for a note editor. Subscribes to the
 * `note_presence:${noteId}` Supabase Realtime presence channel,
 * tracks `self` on SUBSCRIBED, and flattens the channel's presence
 * state on every `sync` event into a stable list of
 * NotePresentUser rows.
 *
 * Returns an empty list (and skips the subscribe) when `self.userId`
 * is falsy (unauthenticated or transient). Cleanly untracks + removes
 * the channel on unmount so other editors see the leave event
 * immediately rather than waiting for the heartbeat timeout.
 */
export function useNotePresence(
  noteId: string,
  self: { userId: string; displayName: string }
): NotePresentUser[] {
  const [users, setUsers] = useState<NotePresentUser[]>([]);
  // Hold onto `self` via a ref so the effect dependency array can key
  // on the scalar userId / displayName without re-subscribing each
  // render if the caller passes a freshly-allocated object.
  const selfRef = useRef(self);
  selfRef.current = self;

  useEffect(() => {
    if (!self.userId) {
      setUsers([]);
      return;
    }
    const supabase = createClient();
    const channel = supabase.channel(`note_presence:${noteId}`, {
      config: { presence: { key: self.userId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<NotePresentUser>();
      const flat: NotePresentUser[] = [];
      for (const key of Object.keys(state)) {
        const metas = state[key];
        // Take the newest meta entry per user so multiple tabs
        // collapse into one avatar with the most recent joined_at.
        if (metas && metas.length > 0) {
          const newest = metas.reduce((a, b) =>
            (a.joined_at ?? "") > (b.joined_at ?? "") ? a : b
          );
          flat.push({
            user_id: newest.user_id ?? key,
            display_name: newest.display_name ?? key,
            cursor_line: newest.cursor_line,
            joined_at: newest.joined_at ?? new Date(0).toISOString(),
          });
        }
      }
      // Sort oldest-first so the avatar row has a stable order.
      flat.sort((a, b) => a.joined_at.localeCompare(b.joined_at));
      setUsers(flat);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track({
          user_id: selfRef.current.userId,
          display_name: selfRef.current.displayName,
          joined_at: new Date().toISOString(),
        });
      }
    });

    return () => {
      // Untrack explicitly so other clients see the leave event
      // immediately. removeChannel closes the underlying socket
      // subscription, flushing the presence state on the server side.
      void channel.untrack().finally(() => {
        void supabase.removeChannel(channel);
      });
    };
  }, [noteId, self.userId, self.displayName]);

  return users;
}
