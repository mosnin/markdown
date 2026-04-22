"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/browser";

// Cursor position in the Yjs document (character offsets)
export interface YjsCursor {
  anchor: number;
  head: number;
}

// Broadcast the local user's cursor position into the presence channel.
// Call this from the editor's selection-change handler.
export function useYjsCursorBroadcast(
  noteId: string,
  userId: string,
  displayName: string
): {
  broadcastCursor: (cursor: YjsCursor | null) => void;
} {
  // Keep a stable ref to the channel so broadcastCursor can always access
  // the current channel without re-creating closures on every render.
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);

  // Hold latest identity values in a ref so the subscribe callback
  // always sees the current values without re-running the effect.
  const identityRef = useRef({ userId, displayName });
  identityRef.current = { userId, displayName };

  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    const channel = supabase.channel(`note_crdt_awareness:${noteId}`, {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track({
          user_id: identityRef.current.userId,
          display_name: identityRef.current.displayName,
          cursor: null,
        });
      }
    });

    return () => {
      void channel.untrack().finally(() => {
        void supabase.removeChannel(channel);
      });
      channelRef.current = null;
    };
  }, [noteId, userId, displayName]);

  const broadcastCursor = (cursor: YjsCursor | null) => {
    const channel = channelRef.current;
    if (!channel) return;
    void channel.track({
      user_id: identityRef.current.userId,
      display_name: identityRef.current.displayName,
      cursor,
    });
  };

  return { broadcastCursor };
}
