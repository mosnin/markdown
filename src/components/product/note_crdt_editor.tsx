"use client";

import { useMemo, useRef } from "react";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { useTheme } from "next-themes";
import { useNoteYjsDoc } from "@/lib/crdt/use_note_yjs_doc";

/**
 * Document mode theme: prose-like proportional font, large leading.
 * Hoisted to module scope so the reference is stable across renders —
 * a fresh EditorView.theme() object each render causes CodeMirror to
 * tear down and rebuild its editor state.
 */
const documentTheme = EditorView.theme({
  "&": { fontFamily: "inherit", fontSize: "1rem", lineHeight: "2rem" },
  ".cm-content": { padding: "24px 32px", fontFamily: "inherit" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftWidth: "2px" },
});

/**
 * Markdown mode theme: monospace, smaller, syntax visible.
 * Same stability rationale as documentTheme above.
 */
const markdownTheme = EditorView.theme({
  "&": {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "0.875rem",
    lineHeight: "1.75rem",
  },
  ".cm-content": { padding: "24px 32px" },
});

interface NoteCrdtEditorProps {
  noteId: string;
  initialContent: string;
  mode: "document" | "markdown";
  onChange: (content: string) => void;
  /** Called on any keystroke — used to trigger the autosave debounce timer. */
  onEdit?: () => void;
}

export function NoteCrdtEditor({
  noteId,
  initialContent,
  mode,
  onChange,
  onEdit,
}: NoteCrdtEditorProps) {
  const { resolvedTheme } = useTheme();
  const { yText } = useNoteYjsDoc(noteId, initialContent);

  // Stable refs for onChange/onEdit so the extensions useMemo doesn't
  // rebuild every time the parent re-renders with a new closure reference.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  // UndoManager scoped to yText gives Ctrl+Z correct CRDT undo semantics.
  const undoManager = useMemo(() => new Y.UndoManager(yText), [yText]);

  const extensions = useMemo(
    () => [
      // CRDT binding — yCollab owns the editor content; we do NOT pass a
      // value prop to CodeMirror. Awareness is handled separately in Phase 4E.
      yCollab(yText, null, { undoManager }),
      markdown(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
          onEditRef.current?.();
        }
      }),
      mode === "document" ? documentTheme : markdownTheme,
    ],
    [yText, undoManager, mode]
    // onChange/onEdit intentionally omitted — accessed via stable refs above.
  );

  const theme = resolvedTheme === "dark" ? "dark" : "light";

  return (
    <div className="flex-1 overflow-auto">
      <CodeMirror
        // value is intentionally omitted — yCollab owns the document state.
        value={undefined}
        extensions={extensions}
        theme={theme}
        className={
          mode === "document"
            ? "note-crdt-editor note-crdt-editor--document"
            : "note-crdt-editor note-crdt-editor--markdown"
        }
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
        }}
      />
    </div>
  );
}
