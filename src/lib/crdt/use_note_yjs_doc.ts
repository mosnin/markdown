"use client";

import { useEffect, useRef } from "react";
import * as Y from "yjs";
import { SupabaseYjsProvider } from "./supabase_yjs_provider";
import { createClient } from "@/lib/supabase/browser";

export interface NoteYjsDoc {
  yDoc: Y.Doc;
  yText: Y.Text;
  provider: SupabaseYjsProvider;
}

function createDoc(noteId: string, initialContent: string): NoteYjsDoc {
  const yDoc = new Y.Doc();
  const yText = yDoc.getText("content");

  if (yText.toString() === "" && initialContent !== "") {
    yDoc.transact(() => {
      yText.insert(0, initialContent);
    });
  }

  const supabase = createClient();
  const provider = new SupabaseYjsProvider(
    supabase,
    `note_crdt:${noteId}`,
    yDoc
  );
  provider.connect();

  return { yDoc, yText, provider };
}

export function useNoteYjsDoc(
  noteId: string,
  initialContent: string
): NoteYjsDoc {
  const docRef = useRef<NoteYjsDoc | null>(null);

  // Initialize synchronously on first render (browser only)
  if (docRef.current === null && typeof window !== "undefined") {
    docRef.current = createDoc(noteId, initialContent);
  }

  useEffect(() => {
    // noteId changed — tear down old doc, create new one
    if (docRef.current) {
      docRef.current.provider.disconnect();
      docRef.current.yDoc.destroy();
    }
    docRef.current = createDoc(noteId, initialContent);

    return () => {
      docRef.current?.provider.disconnect();
      docRef.current?.yDoc.destroy();
    };
  }, [noteId]); // intentionally only noteId — initialContent is the snapshot at mount time

  return docRef.current!;
}
