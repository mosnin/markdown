"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AlertTriangle, Code2, Eye, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { type Note } from "@/server/domain/types/note";
import { saveNoteAction } from "@/app/app/notes/actions";
import {
  AutosaveStatus,
  type AutosaveState,
} from "@/components/product/autosave_status";
import { formatAbsoluteDate } from "@/lib/format_date";
import { useNotePresence } from "@/lib/hooks/use_note_presence";
import { useConcurrentEditWarning } from "@/lib/hooks/use_concurrent_edit_warning";
import { NotePresenceAvatars } from "@/components/product/note_presence_avatars";
import { NoteHistoryDialog } from "@/components/product/note_history_dialog";
import { useNoteEmbedding } from "@/hooks/use_note_embedding";
import { CrdtPresenceBar } from "@/components/product/crdt_presence_bar";
import { useYjsCursorBroadcast } from "@/lib/crdt/yjs_awareness";

const NoteCrdtEditor = dynamic(
  () =>
    import("@/components/product/note_crdt_editor").then(
      (m) => m.NoteCrdtEditor
    ),
  { ssr: false }
);

const EditorRelatedPanel = dynamic(
  () =>
    import("@/components/product/editor_related_panel").then(
      (m) => m.EditorRelatedPanel
    ),
  { ssr: false }
);

/**
 * Autosave debounce: 1500ms after the last content change.
 *
 * Every fired save calls saveNoteAction → update_note_and_create_version RPC,
 * which atomically creates a new immutable version. This is identical to the
 * manual save path — versioning, optimistic concurrency, and audit semantics
 * are fully preserved.
 */
const AUTOSAVE_DEBOUNCE_MS = 1500;

/**
 * Two view modes for the note editor:
 *
 *   document  — editable textarea with proportional font (default). Users write
 *               naturally without markdown syntax. Both modes edit the same content
 *               string — no conversion happens between modes.
 *
 *   markdown  — editable raw markdown textarea with monospace font, explicitly labeled
 *               as the exact source the AI model receives. Autosave and metadata
 *               editing work in both modes.
 */
export type NoteViewMode = "document" | "markdown";

interface NoteEditorProps {
  note: Note;
  /** Initial view mode — defaults to "document" (rendered, human reading experience). */
  initialMode?: NoteViewMode;
  /** Current user info for presence tracking. When absent, presence is disabled. */
  currentUser?: { userId: string; displayName: string };
  /** When provided, enables inline AI quick-action buttons in the selection popover. */
  workspaceId?: string;
}

export function NoteEditor({ note, initialMode = "document", currentUser, workspaceId }: NoteEditorProps) {
  const { scheduleEmbed } = useNoteEmbedding(note.id);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.markdown_content);
  const [summary, setSummary] = useState(note.summary ?? "");
  const [tagsInput, setTagsInput] = useState(note.tags.join(", "));
  const [readHint, setReadHint] = useState(note.read_hint ?? "");
  const [mode, setMode] = useState<NoteViewMode>(initialMode);

  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Ref-based guard to prevent concurrent saves across stale closures (Bug 2)
  const isSavingRef = useRef(false);
  // Ref to track the status-fade timeout so we can cancel it before setting a new one (Bug 4)
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Presence & concurrent-edit awareness ────────────────────────────────────
  const presenceUsers = useNotePresence(
    note.id,
    {
      userId: currentUser?.userId ?? "",
      displayName: currentUser?.displayName ?? "",
    }
  );

  // CRDT awareness: tracks the local user on the note_crdt_awareness channel
  // so other sessions' CrdtPresenceBar can see us. Without this call, the
  // presence bar channel has no writers and always shows empty.
  useYjsCursorBroadcast(
    note.id,
    currentUser?.userId ?? "",
    currentUser?.displayName ?? ""
  );

  const {
    showWarning: showConcurrentWarning,
    savedBy: concurrentSavedBy,
    broadcastSave,
    dismiss: dismissConcurrentWarning,
  } = useConcurrentEditWarning(note.id, currentUser?.userId ?? "");

  const router = useRouter();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The snapshot of what was last successfully persisted to the database.
  // isDirty compares current state against this ref.
  const lastSavedSnapshot = useRef({
    title: note.title,
    content: note.markdown_content,
    summary: note.summary ?? "",
    tagsInput: note.tags.join(", "),
    readHint: note.read_hint ?? "",
  });

  // Bug 1: Reset all editor state when navigating to a different note
  useEffect(() => {
    setTitle(note.title);
    setContent(note.markdown_content);
    setSummary(note.summary ?? "");
    setTagsInput(note.tags.join(", "));
    setReadHint(note.read_hint ?? "");
    setAutosaveState("idle");
    setSaveError(null);
    // Cancel any pending debounce so it can't fire Note A's data into Note B
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    // Cancel any pending status-fade timeout
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
    // Reset the last saved snapshot to the new note's data
    lastSavedSnapshot.current = {
      title: note.title,
      content: note.markdown_content,
      summary: note.summary ?? "",
      tagsInput: note.tags.join(", "),
      readHint: note.read_hint ?? "",
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.current_version_id]);

  function parseTags(raw: string): string[] {
    return raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  // Reading refs during render is intentional here: lastSavedSnapshot tracks the
  // last persisted state for dirty-checking without causing re-renders on every
  // keystroke. The React Compiler rule is overly conservative for this pattern.
   
  const isDirty =
     
    title !== lastSavedSnapshot.current.title ||
     
    content !== lastSavedSnapshot.current.content ||
     
    summary !== lastSavedSnapshot.current.summary ||
     
    tagsInput !== lastSavedSnapshot.current.tagsInput ||
     
    readHint !== lastSavedSnapshot.current.readHint;

  /**
   * performSave — calls saveNoteAction with the current editor state.
   *
   * Uses the same update path as manual save: saveNoteAction →
   * update_note_and_create_version RPC → new immutable note_versions row.
   * Optimistic locking is handled by the RPC; this function does not bypass it.
   */
  const performSave = useCallback(async () => {
    // Bug 2: Use ref for guard to avoid stale-closure false negatives
    if (!title.trim() || isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setAutosaveState("saving");
    setSaveError(null);

    try {
      const result = await saveNoteAction(note.id, {
        title,
        markdownContent: content,
        summary: summary.trim() || null,
        tags: parseTags(tagsInput),
        readHint: readHint.trim() || null,
      });

      if (result.ok) {
        const now = new Date();
        setSavedAt(now);
        setAutosaveState("saved");
        scheduleEmbed(title, content);
        // Bug 3: Capture whether title changed before updating the snapshot, so
        // we can decide whether to call router.refresh() for sidebar sync.
        // Don't refresh after every autosave — it would clobber in-flight edits.
        const titleChanged = title !== lastSavedSnapshot.current.title;
        lastSavedSnapshot.current = { title, content, summary, tagsInput, readHint };
        if (titleChanged) {
          router.refresh();
        }
        // Broadcast save to other editors so they see a concurrent-edit warning.
        if (currentUser) {
          broadcastSave(currentUser.userId, currentUser.displayName, note.current_version_id ?? "");
        }
        // Bug 4: Cancel the previous status-fade timeout before scheduling a new one
        if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = setTimeout(() => {
          setAutosaveState((s: AutosaveState) => (s === "saved" ? "idle" : s));
        }, 4000);
      } else {
        setSaveError(result.error);
        setAutosaveState("error");
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
      setAutosaveState("error");
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [note.id, note.current_version_id, title, content, summary, tagsInput, readHint, router, broadcastSave, currentUser]);

  /**
   * Autosave debounce effect.
   *
   * Fires AUTOSAVE_DEBOUNCE_MS after the last content change.
   * Immediately signals "unsaved" so the user sees feedback while the timer runs.
   * When the timer fires, performSave() takes over and transitions to "saving".
   */
  useEffect(() => {
    if (!isDirty) return;
    setAutosaveState("unsaved");
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void performSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [title, content, summary, tagsInput, readHint, isDirty, performSave]);

  // Flush timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <div className="px-8 pb-3 pt-6">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled note"
          aria-label="Note title"
          className={cn(
            "w-full bg-transparent text-3xl font-bold tracking-tight text-foreground",
            "border-b-2 border-transparent pb-1",
            "transition-[border-color] duration-150",
            "focus:border-border focus:outline-none",
            "placeholder:text-muted-foreground/40"
          )}
        />
        {/* Metadata bar — created date, tags — visible below title */}
        {(note.created_at || note.tags.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {note.created_at && (
              <span className="text-xs text-muted-foreground">
                {/*
                 * Hydration-safe absolute date. The previous
                 * `toLocaleDateString(undefined, ...)` call used the
                 * system locale, so the server-rendered HTML and the
                 * client-rendered HTML could disagree — a guaranteed
                 * hydration mismatch on non-US systems. The shared
                 * helper pins `'en-US'` on both sides. See
                 * src/lib/format_date.ts.
                 */}
                {formatAbsoluteDate(note.created_at)}
              </span>
            )}
            {note.tags.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {note.tags.join(" · ")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Toolbar: mode toggle + save state ─────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-8 py-1.5">
        {/* Mode toggle */}
        <div
          className="flex items-center gap-1"
          role="tablist"
          aria-label="Note view mode"
        >
          <ModeButton
            mode="document"
            current={mode}
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Document"
            onClick={() => setMode("document")}
          />
          <ModeButton
            mode="markdown"
            current={mode}
            icon={<Code2 className="h-3.5 w-3.5" />}
            label="Markdown"
            onClick={() => setMode("markdown")}
          />
        </div>

        {/* Presence + Save state + retry */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            title="Version history"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            History
          </button>
          {presenceUsers.length > 0 && (
            <NotePresenceAvatars users={presenceUsers} />
          )}
          {currentUser && (
            <CrdtPresenceBar
              noteId={note.id}
              currentUserId={currentUser.userId}
            />
          )}
          <span
            className={cn(
              "transition-opacity duration-300",
              autosaveState === "idle" ? "opacity-0" : "opacity-100"
            )}
          >
            <AutosaveStatus
              state={autosaveState}
              savedAt={savedAt}
              error={saveError}
              className="text-xs text-muted-foreground"
            />
          </span>
          {autosaveState === "error" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void performSave()}
              disabled={isSaving}
              className="h-8 text-xs"
            >
              Retry
            </Button>
          )}
        </div>
      </div>

      {/* ── Concurrent edit warning ──────────────────────────────────────── */}
      {showConcurrentWarning && (
        <div className="flex items-center gap-2 border-b border-amber-300/50 bg-amber-50/40 px-8 py-2 dark:border-amber-600/30 dark:bg-amber-900/10">
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
            aria-hidden="true"
          />
          <p className="flex-1 text-xs text-amber-700 dark:text-amber-400">
            {concurrentSavedBy ?? "Someone"} just saved changes to this note.
            Reload to see their version.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => {
              dismissConcurrentWarning();
              router.refresh();
            }}
          >
            Reload
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={dismissConcurrentWarning}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* ── Content area ──────────────────────────────────────────────────── */}
      {/* Markdown mode source label — shown above the CRDT editor in markdown mode */}
      {mode === "markdown" && (
        <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-8 py-1.5">
          <Code2
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground/70">
            Raw markdown — the exact source the AI model receives
          </p>
        </div>
      )}
      <NoteCrdtEditor
        noteId={note.id}
        initialContent={note.markdown_content}
        mode={mode}
        onChange={setContent}
      />

      {/* ── Metadata — shown in markdown mode ─────────────────────────────── */}
      {mode === "markdown" && (
        <div className="border-t border-border">
          <details className="group" open>
            <summary className="flex cursor-pointer items-center justify-between px-8 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              Metadata
              <span className="text-[10px] uppercase tracking-wider opacity-60 group-open:hidden">
                expand
              </span>
            </summary>
            <div className="flex flex-col gap-3 px-8 pb-5 pt-2">
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="note-summary"
                >
                  Summary
                </label>
                <Input
                  id="note-summary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="One-line summary for context retrieval"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="note-tags"
                >
                  Tags{" "}
                  <span className="font-normal opacity-60">
                    (comma-separated)
                  </span>
                </label>
                <Input
                  id="note-tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="research, reading, ideas"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="note-hint"
                >
                  Read hint{" "}
                  <span className="font-normal opacity-60">
                    (optional guidance for AI retrieval)
                  </span>
                </label>
                <Input
                  id="note-hint"
                  value={readHint}
                  onChange={(e) => setReadHint(e.target.value)}
                  placeholder="e.g. Read this before generating anything in the Research box"
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </details>
        </div>
      )}

      {/* ── Related notes (on-device local search) ──────────────────────── */}
      <EditorRelatedPanel
        noteId={note.id}
        noteTitle={title}
        noteIndex={{}}
      />

      {/* ── Version history dialog ───────────────────────────────────────── */}
      <NoteHistoryDialog
        noteId={note.id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}

// ─── ModeButton ───────────────────────────────────────────────────────────────

function ModeButton({
  mode,
  current,
  icon,
  label,
  onClick,
}: {
  mode: NoteViewMode;
  current: NoteViewMode;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  const isActive = mode === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-fast",
        isActive
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
