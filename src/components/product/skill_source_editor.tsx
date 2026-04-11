"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AutosaveStatus } from "@/components/product/autosave_status";
import { saveSkillAction } from "@/app/app/skills/actions";
import { type Skill } from "@/server/domain/types/skill";
import { cn } from "@/lib/utils";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const STATUS_CLEAR_DELAY_MS = 4000;
type AutosaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    markdown: "Markdown",
    json: "JSON",
    yaml: "YAML",
    xml: "XML",
    python: "Python",
    typescript: "TypeScript",
    javascript: "JavaScript",
    shell: "Shell",
    plain_text: "Text",
  };
  return labels[format] ?? format;
}

export function SkillSourceEditor({ skill }: { skill: Skill }) {
  const [content, setContent] = useState(skill.source_content);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const isSavingRef = useRef(false);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef(skill.source_content);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    setContent(skill.source_content);
    setAutosaveState("idle");
    setSaveError(null);
    lastSavedContentRef.current = skill.source_content;
  }, [skill.id, skill.current_version_id, skill.source_content]);

  const performSave = useCallback(async (contentToSave: string) => {
    if (isSavingRef.current) return;
    if (contentToSave === lastSavedContentRef.current) {
      setAutosaveState("idle");
      return;
    }
    isSavingRef.current = true;
    setAutosaveState("saving");
    setSaveError(null);
    const result = await saveSkillAction(skill.id, { sourceContent: contentToSave });
    isSavingRef.current = false;
    if (result.ok) {
      lastSavedContentRef.current = contentToSave;
      setAutosaveState("saved");
      setSavedAt(new Date());
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = setTimeout(() => setAutosaveState("idle"), STATUS_CLEAR_DELAY_MS);
    } else {
      setAutosaveState("error");
      setSaveError(result.error);
    }
  }, [skill.id]);

  function handleChange(value: string) {
    setContent(value);
    setAutosaveState("unsaved");
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => { performSave(value); }, AUTOSAVE_DEBOUNCE_MS);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
            {formatLabel(skill.canonical_format)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <AutosaveStatus state={autosaveState} savedAt={savedAt} />
          {autosaveState === "error" && (
            <button type="button" onClick={() => performSave(content)} className="text-xs text-destructive">
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn("h-full w-full resize-none bg-background p-4 font-mono text-sm leading-6 focus:outline-none")}
      />
      {saveError && <p className="border-t border-border bg-destructive/5 px-3 py-2 text-xs text-destructive">{saveError}</p>}
    </div>
  );
}
