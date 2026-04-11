"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type File as FileObject } from "@/server/domain/types/file";
import { type SourceFormat } from "@/server/domain/constants/object_constants";
import { saveFileAction } from "@/app/app/files/actions";
import {
  AutosaveStatus,
  type AutosaveState,
} from "@/components/product/autosave_status";
import { FileLanguageBadge } from "@/components/product/file_language_badge";

/**
 * Autosave debounce for file content.
 *
 * Files use a slightly longer debounce than notes (2 s vs 1.5 s) because code
 * edits are often followed by further keystrokes. Still keeps the save window
 * short enough for safety.
 */
const AUTOSAVE_DEBOUNCE_MS = 2000;

interface FileEditorProps {
  file: FileObject;
}

/**
 * Code-only editor for the Files object type.
 *
 * Design contract:
 * - There is NO document view. Files are always shown as source.
 * - spellCheck, autoCorrect, and autoCapitalize are disabled.
 * - The editor is a plain textarea with monospace font — no rich editor library.
 * - Autosave fires AUTOSAVE_DEBOUNCE_MS after the last keystroke.
 * - Save state follows the same AutosaveState machine as NoteEditor.
 * - Each save calls saveFileAction → update_object_and_create_version RPC
 *   (new immutable version, optimistic concurrency, audit preserved).
 *
 * Notes remain separate: NoteEditor handles markdown with its own view modes.
 * FileEditor must NEVER offer a rendered preview or document mode.
 */
export function FileEditor({ file }: FileEditorProps) {
  const [content, setContent] = useState(file.source_content);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isSavingRef = useRef(false);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastSavedContent = useRef(file.source_content);

  // Reset all state when navigating to a different file
  useEffect(() => {
    setContent(file.source_content);
    setAutosaveState("idle");
    setSaveError(null);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
    lastSavedContent.current = file.source_content;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, file.current_version_id]);

  const isDirty = content !== lastSavedContent.current;

  const performSave = useCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setAutosaveState("saving");
    setSaveError(null);

    try {
      const result = await saveFileAction(file.id, { sourceContent: content });

      if (result.ok) {
        const now = new Date();
        setSavedAt(now);
        setAutosaveState("saved");
        lastSavedContent.current = content;

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
  }, [file.id, content]);

  // Autosave debounce
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
  }, [content, isDirty, performSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const formatLabel = file.canonical_format as SourceFormat;
  const lineCount = content.split("\n").length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-1.5">
        {/* Left: format badge + line count */}
        <div className="flex items-center gap-3">
          <FileLanguageBadge
            format={formatLabel}
            extension={file.file_extension}
          />
          <span className="text-[10px] text-muted-foreground/40">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        </div>

        {/* Right: save state + retry */}
        <div className="flex items-center gap-2">
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
              className="h-7 text-xs"
            >
              Retry
            </Button>
          )}
        </div>
      </div>

      {/* ── Code editor ───────────────────────────────────────────────────── */}
      <div className="relative flex flex-1 overflow-hidden">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore — autoCorrect is a valid HTML attribute; React types lag behind
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          aria-label={`${file.name} source editor`}
          aria-description={`Code editor for ${file.canonical_format} source. No document view — code only.`}
          className={cn(
            "flex-1 w-full resize-none bg-transparent",
            "px-8 py-6",
            "font-mono text-sm leading-6 text-foreground",
            "placeholder:text-muted-foreground/40 focus:outline-none",
            "tab-size-2"
          )}
          placeholder={`// ${file.name}`}
        />
      </div>
    </div>
  );
}
