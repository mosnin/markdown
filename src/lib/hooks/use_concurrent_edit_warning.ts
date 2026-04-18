"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/browser";

interface ConcurrentEditWarning {
  /** True when another user has saved changes since we started editing. */
  showWarning: boolean;
  /** Display name of the user who last saved, if available. */
  savedBy?: string;
  /** Broadcast a save event so other editors know we saved. */
  broadcastSave: (userId: string, displayName: string, versionId: string) => void;
  /** Dismiss the warning (e.g. after user reloads). */
  dismiss: () => void;
}

/**
 * Subscribes to the `note_edits:${noteId}` Supabase Realtime broadcast
 * channel. When another user saves (broadcasts `{ type: 'saved', ... }`),
 * the hook sets `showWarning = true` with the saver's display name.
 *
 * Also exposes `broadcastSave` so the local editor can notify other
 * editors after a successful save.
 *
 * The channel is cleaned up on unmount.
 */
export function useConcurrentEditWarning(
  noteId: string,
  currentUserId: string
): ConcurrentEditWarning {
  const [showWarning, setShowWarning] = useState(false);
  const [savedBy, setSavedBy] = useState<string | undefined>(undefined);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => {
    if (!noteId || !currentUserId) return;

    const supabase = createClient();
    supabaseRef.current = supabase;
    const channel = supabase.channel(`note_edits:${noteId}`);
    channelRef.current = channel;

    channel.on(
      "broadcast",
      { event: "saved" },
      (payload) => {
        const data = payload.payload as {
          type: string;
          userId: string;
          displayName?: string;
          versionId?: string;
        };
        // Ignore our own save events.
        if (data.userId === currentUserId) return;
        setSavedBy(data.displayName ?? "Someone");
        setShowWarning(true);
      }
    );

    channel.subscribe();

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [noteId, currentUserId]);

  const broadcastSave = useCallback(
    (userId: string, displayName: string, versionId: string) => {
      const ch = channelRef.current;
      if (!ch) return;
      void ch.send({
        type: "broadcast",
        event: "saved",
        payload: {
          type: "saved",
          userId,
          displayName,
          versionId,
        },
      });
    },
    []
  );

  const dismiss = useCallback(() => {
    setShowWarning(false);
    setSavedBy(undefined);
  }, []);

  return { showWarning, savedBy, broadcastSave, dismiss };
}
