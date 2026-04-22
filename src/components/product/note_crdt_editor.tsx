"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { useTheme } from "next-themes";
import { useNoteYjsDoc } from "@/lib/crdt/use_note_yjs_doc";
import {
  SlashCommandMenu,
  type SkillCommandOption,
} from "@/components/product/slash_command_menu";
import {
  runInlineCommandAction,
  listSkillsForSlashMenuAction,
  getInlineCommandStatusAction,
} from "@/app/app/notes/inline_command_actions";
import type { BuiltInCommandId } from "@/server/domain/types/inline_command";

/**
 * Document mode theme: prose-like proportional font, large leading.
 */
const documentTheme = EditorView.theme({
  "&": { fontFamily: "inherit", fontSize: "1rem", lineHeight: "2rem" },
  ".cm-content": { padding: "24px 32px", fontFamily: "inherit" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftWidth: "2px" },
});

/**
 * Markdown mode theme: monospace, smaller, syntax visible.
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

interface SlashMenuState {
  triggerPos: number;
  query: string;
  anchor: { top: number; left: number };
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

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  const cmRef = useRef<ReactCodeMirrorRef | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [skillCommands, setSkillCommands] = useState<SkillCommandOption[]>([]);
  const [streamingNotice, setStreamingNotice] = useState<string | null>(null);

  const undoManager = useMemo(() => new Y.UndoManager(yText), [yText]);

  // Lazy-fetch skill sub-agents the first time the slash menu opens.
  const hasFetchedSkillsRef = useRef(false);
  useEffect(() => {
    if (!slashMenu || hasFetchedSkillsRef.current) return;
    hasFetchedSkillsRef.current = true;
    listSkillsForSlashMenuAction().then((res) => {
      if (res.ok) setSkillCommands(res.data);
    });
  }, [slashMenu]);

  // Inspect the document around the caret to decide whether the menu
  // should be open, updated, or dismissed.
  const syncSlashMenuFromEditor = useCallback((view: EditorView) => {
    const sel = view.state.selection.main;
    const doc = view.state.doc;
    const caretPos = sel.head;

    let scan = caretPos;
    let slashPos = -1;
    const MAX_SCAN = 32;
    while (scan > 0 && caretPos - scan < MAX_SCAN) {
      const ch = doc.sliceString(scan - 1, scan);
      if (ch === "/") {
        const col = scan - 1 - doc.lineAt(scan - 1).from;
        const prev = scan - 1 > 0 ? doc.sliceString(scan - 2, scan - 1) : "";
        if (col === 0 || /\s/.test(prev)) {
          slashPos = scan - 1;
        }
        break;
      }
      if (/\s/.test(ch)) break;
      scan--;
    }

    if (slashPos === -1) {
      setSlashMenu(null);
      return;
    }

    const query = doc.sliceString(slashPos + 1, caretPos);
    if (!/^[a-z0-9_-]*$/i.test(query)) {
      setSlashMenu(null);
      return;
    }

    const coords = view.coordsAtPos(slashPos);
    if (!coords) {
      setSlashMenu(null);
      return;
    }

    setSlashMenu({
      triggerPos: slashPos,
      query,
      anchor: { top: coords.bottom + 4, left: coords.left },
    });
  }, []);

  const extensions = useMemo(
    () => [
      yCollab(yText, null, { undoManager }),
      markdown(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
          onEditRef.current?.();
        }
        if (update.docChanged || update.selectionSet) {
          syncSlashMenuFromEditor(update.view);
        }
      }),
      mode === "document" ? documentTheme : markdownTheme,
    ],
    [yText, undoManager, mode, syncSlashMenuFromEditor]
  );

  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const dispatchCommand = useCallback(
    async (
      selection:
        | { kind: "builtin"; id: BuiltInCommandId }
        | { kind: "skill"; id: string }
    ) => {
      const view = cmRef.current?.view;
      if (!view || !slashMenu) return;

      const triggerPos = slashMenu.triggerPos;
      const caretPos = view.state.selection.main.head;
      const commandId =
        selection.kind === "builtin" ? selection.id : `skill:${selection.id}`;

      const docText = view.state.doc.toString();
      const selStart = Math.max(0, triggerPos - 800);
      const selEnd = Math.min(docText.length, caretPos + 200);
      const context = docText.slice(selStart, selEnd);

      setSlashMenu(null);
      setStreamingNotice("Running…");

      view.dispatch({
        changes: { from: triggerPos, to: caretPos, insert: "" },
      });

      const res = await runInlineCommandAction({
        noteId,
        commandId,
        context,
        selectionStart: triggerPos,
        selectionEnd: caretPos,
      });

      if (!res.ok) {
        setStreamingNotice(null);
        console.error("[slash_command]", res.error);
        return;
      }

      // Poll for completion (v1; streaming-into-editor deferred to 7E).
      const deadline = Date.now() + 90_000;
      let output: string | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        const status = await getInlineCommandStatusAction(res.invocation_id);
        if (!status.ok) break;
        if (status.status === "completed") {
          output = status.output;
          break;
        }
        if (status.status === "failed" || status.status === "cancelled") break;
      }

      setStreamingNotice(null);

      if (output) {
        const currentView = cmRef.current?.view;
        if (currentView) {
          currentView.dispatch({
            changes: { from: triggerPos, to: triggerPos, insert: output },
            selection: { anchor: triggerPos + output.length },
          });
        }
      }
    },
    [noteId, slashMenu]
  );

  return (
    <div className="relative flex-1 overflow-auto">
      <CodeMirror
        ref={cmRef}
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
      <SlashCommandMenu
        anchor={slashMenu?.anchor ?? null}
        query={slashMenu?.query ?? ""}
        skillCommands={skillCommands}
        onSelect={dispatchCommand}
        onDismiss={() => setSlashMenu(null)}
      />
      {streamingNotice && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-foreground/80 px-3 py-1 text-[11px] text-background shadow-md">
          {streamingNotice}
        </div>
      )}
    </div>
  );
}
