"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AutosaveStatus } from "@/components/product/autosave_status";
import { AgentTypeBadge } from "@/components/product/agent_type_badge";
import { saveAgentAction } from "@/app/app/agents/actions";
import { type Agent } from "@/server/domain/types/agent";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTOSAVE_DEBOUNCE_MS = 2000;
const STATUS_CLEAR_DELAY_MS = 4000;

// ─── Autosave state ───────────────────────────────────────────────────────────

type AutosaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

// ─── Format label ─────────────────────────────────────────────────────────────

function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    markdown: "Markdown",
    json: "JSON",
    yaml: "YAML",
    toml: "TOML",
    xml: "XML",
    python: "Python",
    typescript: "TypeScript",
    javascript: "JavaScript",
    shell: "Shell",
    sql: "SQL",
    html: "HTML",
    css: "CSS",
    plain_text: "Plain text",
  };
  return labels[format] ?? format;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface AgentSourceEditorProps {
  agent: Agent;
}

/**
 * Canonical source editor for Agents.
 *
 * All formats — including markdown — use a plain code textarea.
 * Markdown agents are NOT rendered as documents; the textarea is the
 * single editing and inspection surface. This keeps Agents distinct from Notes.
 *
 * Autosave fires 2000ms after the last keystroke.
 */
export function AgentSourceEditor({ agent }: AgentSourceEditorProps) {
  const [content, setContent] = useState(agent.source_content);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const isSavingRef = useRef(false);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef(agent.source_content);

  // Reset when navigating to a different agent
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContent(agent.source_content);
    setAutosaveState("idle");
    setSaveError(null);
    lastSavedContentRef.current = agent.source_content;
  }, [agent.id, agent.current_version_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const performSave = useCallback(async (contentToSave: string) => {
    if (isSavingRef.current) return;
    if (contentToSave === lastSavedContentRef.current) {
      setAutosaveState("idle");
      return;
    }

    isSavingRef.current = true;
    setAutosaveState("saving");
    setSaveError(null);

    const result = await saveAgentAction(agent.id, { sourceContent: contentToSave });

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
  }, [agent.id]);

  function handleChange(value: string) {
    setContent(value);
    setAutosaveState("unsaved");

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      performSave(value);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function handleRetry() {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    performSave(content);
  }

  const lineCount = content.split("\n").length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <AgentTypeBadge agentType={agent.agent_type} subtle />
          <span
            className={cn(
              "inline-flex items-center rounded-md border border-border/50 bg-muted/30 px-2 py-0.5",
              "text-[10px] font-medium text-muted-foreground"
            )}
          >
            {formatLabel(agent.canonical_format)}
          </span>
          <span className="text-[11px] text-muted-foreground/50" aria-live="polite">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <AutosaveStatus state={autosaveState} savedAt={savedAt} />
          {autosaveState === "error" && (
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-fast"
              aria-label="Retry save"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      </div>

      {/* Source textarea */}
      <div className="flex-1 overflow-hidden">
        <textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
          aria-label="Agent source content"
          className={cn(
            "h-full w-full resize-none bg-background p-4",
            "font-mono text-sm leading-6 text-foreground",
            "placeholder:text-muted-foreground/40",
            "focus:outline-none",
            "disabled:opacity-50"
          )}
          placeholder={`# ${agent.name}\n\nEdit the canonical source for this agent…`}
        />
      </div>

      {saveError && (
        <div className="shrink-0 border-t border-border bg-destructive/5 px-4 py-2">
          <p className="text-xs text-destructive" role="alert">{saveError}</p>
        </div>
      )}
    </div>
  );
}
