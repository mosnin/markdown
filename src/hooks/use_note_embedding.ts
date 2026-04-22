"use client";

import { useCallback, useEffect, useRef } from "react";
import { getEmbeddingClient } from "@/lib/embedding/embedding_client";
import { storeVector } from "@/lib/embedding/note_vector_store";

export function useNoteEmbedding(noteId: string): {
  scheduleEmbed: (title: string, content: string) => void;
} {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const scheduleEmbed = useCallback((title: string, content: string) => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(async () => {
      if (typeof window === "undefined") return;
      try {
        const client = getEmbeddingClient();
        if (!client) return;
        const text = `${title}\n\n${content.slice(0, 1000)}`;
        const vectors = await client.embed([text]);
        await storeVector(noteIdRef.current, vectors[0]);
      } catch {
        // best-effort; swallow errors silently
      }
    }, 5000);
  }, []);

  return { scheduleEmbed };
}
