"use client";

import { useEffect, useRef, useState } from "react";
import { getEmbeddingClient } from "@/lib/embedding/embedding_client";
import { queryTopK } from "@/lib/embedding/note_vector_store";

export type LocalSearchStatus = "idle" | "loading" | "ready" | "error";

export interface LocalSearchHit {
  noteId: string;
  score: number;
}

export function useLocalSearch(
  query: string,
  workspaceNoteIds?: string[],
): {
  hits: LocalSearchHit[];
  status: LocalSearchStatus;
} {
  const [hits, setHits] = useState<LocalSearchHit[]>([]);
  const [status, setStatus] = useState<LocalSearchStatus>("idle");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!query) {
      setHits([]);
      setStatus("idle");
      return;
    }

    timeoutRef.current = setTimeout(async () => {
      if (typeof window === "undefined") return;

      setStatus("loading");

      try {
        const client = getEmbeddingClient();
        if (!client) {
          setStatus("error");
          return;
        }

        const vectors = await client.embed([query]);
        const queryVector = vectors[0];
        const results = await queryTopK(queryVector, 12, workspaceNoteIds);
        setHits(results);
        setStatus("ready");
      } catch {
        setStatus("error");
        setHits([]);
      }
    }, 300);

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [query, workspaceNoteIds]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { hits, status };
}
