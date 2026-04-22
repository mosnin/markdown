"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

interface CrdtPresenceBarProps {
  noteId: string;
  currentUserId: string;
}

interface AwarenessUser {
  user_id: string;
  display_name: string;
  cursor: { anchor: number; head: number } | null;
}

// Palette: blue, violet, amber, emerald, rose, indigo
const COLOR_PALETTE = [
  "text-blue-500",
  "text-violet-500",
  "text-amber-500",
  "text-emerald-500",
  "text-rose-500",
  "text-indigo-500",
] as const;

function userColor(userId: string): string {
  return COLOR_PALETTE[userId.charCodeAt(0) % 6];
}

export function CrdtPresenceBar({
  noteId,
  currentUserId,
}: CrdtPresenceBarProps) {
  const [others, setOthers] = useState<AwarenessUser[]>([]);

  useEffect(() => {
    if (!noteId) return;

    const supabase = createClient();
    const channel = supabase.channel(`note_crdt_awareness:${noteId}`);

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<AwarenessUser>();
      const flat: AwarenessUser[] = [];
      for (const key of Object.keys(state)) {
        const metas = state[key];
        if (metas && metas.length > 0) {
          // Take the last meta entry per presence key
          const newest = metas[metas.length - 1];
          if (newest.user_id && newest.user_id !== currentUserId) {
            flat.push({
              user_id: newest.user_id,
              display_name: newest.display_name ?? newest.user_id,
              cursor: newest.cursor ?? null,
            });
          }
        }
      }
      setOthers(flat);
    });

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [noteId, currentUserId]);

  if (others.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-1 py-0.5 text-[10px] text-muted-foreground select-none">
      {others.map((user, i) => (
        <span key={user.user_id} className="flex items-center gap-0.5">
          {i > 0 && <span className="mx-1">·</span>}
          <span className={userColor(user.user_id)}>●</span>
          <span className="ml-0.5">{user.display_name}</span>
        </span>
      ))}
      <span className="ml-1 opacity-60">(editing together)</span>
    </div>
  );
}
