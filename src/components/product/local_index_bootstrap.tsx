"use client";

import { useEffect, useRef } from "react";
import { getWorkspaceNotesForIndexingAction } from "@/app/app/search/actions";
import { getIndexedNoteIds, storeVector } from "@/lib/embedding/note_vector_store";
import { getEmbeddingClient } from "@/lib/embedding/embedding_client";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 150;

/**
 * Mounts invisibly on the search page and runs a one-shot background
 * pass to embed any workspace notes that aren't yet in the local IndexedDB
 * vector store. Silently no-ops when the embedding worker is unavailable.
 *
 * Load with ssr: false — this component uses IndexedDB and WebWorkers.
 */
export function LocalIndexBootstrap() {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    void (async () => {
      try {
        const client = getEmbeddingClient();
        if (!client) return;

        const [notesResult, indexedIds] = await Promise.all([
          getWorkspaceNotesForIndexingAction(),
          getIndexedNoteIds().catch(() => [] as string[]),
        ]);

        if (!notesResult.ok) return;

        const indexed = new Set(indexedIds);
        const todo = notesResult.data.filter((n) => !indexed.has(n.id));
        if (todo.length === 0) return;

        for (let i = 0; i < todo.length; i += BATCH_SIZE) {
          const batch = todo.slice(i, i + BATCH_SIZE);
          const texts = batch.map((n) => `${n.title}\n\n${n.content}`);

          try {
            const vectors = await client.embed(texts);
            await Promise.all(
              batch.map((n, j) => storeVector(n.id, vectors[j]).catch(() => {}))
            );
          } catch {
            // embedding worker unavailable or crashed; stop indexing
            break;
          }

          if (i + BATCH_SIZE < todo.length) {
            await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
          }
        }
      } catch {
        // best-effort; never throws to the surface
      }
    })();
  }, []);

  return null;
}
