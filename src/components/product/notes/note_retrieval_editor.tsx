"use client";

import { useState, useRef, useCallback, useTransition } from "react";
import { cn } from "@/lib/utils";
import { updateNoteRetrievalAction } from "@/app/app/notes/actions";

// ─── Retrieval Priority Slider ─────────────────────────────────────────────────

interface RetrievalPrioritySliderProps {
  noteId: string;
  initialPriority: number;
  className?: string;
}

/**
 * Interactive slider for note retrieval_priority (0–10).
 * Debounces updates 500ms after last change.
 * Shows a tooltip: "Higher priority = included first in AI context bundles"
 */
export function RetrievalPrioritySlider({
  noteId,
  initialPriority,
  className,
}: RetrievalPrioritySliderProps) {
  const [value, setValue] = useState(initialPriority);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startTransition] = useTransition();

  const debouncedSave = useCallback(
    (priority: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveState("saving");
      debounceRef.current = setTimeout(() => {
        startTransition(async () => {
          const result = await updateNoteRetrievalAction(noteId, { retrievalPriority: priority });
          setSaveState(result.ok ? "saved" : "error");
          if (result.ok) {
            setTimeout(() => setSaveState("idle"), 2000);
          }
        });
      }, 500);
    },
    [noteId]
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = Number(e.target.value);
    setValue(next);
    debouncedSave(next);
  }

  const trackPercent = (value / 10) * 100;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between">
        <label
          htmlFor={`retrieval-priority-${noteId}`}
          className="text-xs font-medium text-muted-foreground"
          title="Higher priority = included first in AI context bundles"
        >
          Retrieval Priority
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-foreground/70 min-w-[1.5rem] text-right">
            {value}
          </span>
          {saveState === "saving" && (
            <span className="text-[10px] text-muted-foreground/60">saving…</span>
          )}
          {saveState === "saved" && (
            <span className="text-[10px] text-green-500">saved</span>
          )}
          {saveState === "error" && (
            <span className="text-[10px] text-destructive">error</span>
          )}
        </div>
      </div>

      {/* Custom styled range input */}
      <div className="relative flex items-center h-5" title="Higher priority = included first in AI context bundles">
        {/* Track background */}
        <div className="relative w-full h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary/70 transition-all"
            style={{ width: `${trackPercent}%` }}
          />
        </div>
        <input
          id={`retrieval-priority-${noteId}`}
          type="range"
          min={0}
          max={10}
          step={1}
          value={value}
          onChange={handleChange}
          aria-label={`Retrieval priority: ${value} out of 10`}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-5"
        />
        {/* Tick marks */}
        <div className="absolute inset-x-0 top-4 flex justify-between px-0.5 pointer-events-none">
          {Array.from({ length: 11 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "text-[8px] leading-none",
                i === value ? "text-foreground/70 font-medium" : "text-muted-foreground/30"
              )}
            >
              {i === 0 || i === 5 || i === 10 ? i : ""}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/50 leading-relaxed mt-2">
        Higher priority = included first in AI context bundles
      </p>
    </div>
  );
}

// ─── Read Hint Visual Selector ─────────────────────────────────────────────────

const READ_HINT_OPTIONS = [
  {
    value: "core_reference",
    label: "Core Reference",
    icon: "📌",
    description: "Always included in context",
  },
  {
    value: "read_first",
    label: "Read First",
    icon: "🚩",
    description: "AI reads this before others",
  },
  {
    value: "supporting_context",
    label: "Background",
    icon: "📖",
    description: "Supporting context",
  },
  {
    value: "related",
    label: "Skip",
    icon: "👁",
    description: "Low-priority context",
  },
] as const;

type ReadHintValue = (typeof READ_HINT_OPTIONS)[number]["value"];

interface ReadHintSelectorProps {
  noteId: string;
  initialReadHint: string | null;
  className?: string;
}

/**
 * Visual radio group for selecting a note's read_hint.
 * Each option shows an icon + label. Clicking a selected option clears it (sets null).
 */
export function ReadHintSelector({
  noteId,
  initialReadHint,
  className,
}: ReadHintSelectorProps) {
  const [selected, setSelected] = useState<string | null>(initialReadHint);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [, startTransition] = useTransition();

  function handleSelect(value: ReadHintValue) {
    const next = selected === value ? null : value;
    setSelected(next);
    setSaveState("saving");
    startTransition(async () => {
      const result = await updateNoteRetrievalAction(noteId, { readHint: next });
      setSaveState(result.ok ? "saved" : "error");
      if (result.ok) {
        setTimeout(() => setSaveState("idle"), 2000);
      } else {
        // Revert on error
        setSelected(initialReadHint);
      }
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Read Hint</span>
        <div className="flex items-center gap-1.5">
          {selected && (
            <button
              type="button"
              onClick={() => handleSelect(selected as ReadHintValue)}
              className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              aria-label="Clear read hint"
            >
              Clear
            </button>
          )}
          {saveState === "saving" && (
            <span className="text-[10px] text-muted-foreground/60">saving…</span>
          )}
          {saveState === "saved" && (
            <span className="text-[10px] text-green-500">saved</span>
          )}
          {saveState === "error" && (
            <span className="text-[10px] text-destructive">error</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Read hint">
        {READ_HINT_OPTIONS.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => handleSelect(opt.value)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/50 bg-muted/20 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground"
              )}
            >
              <span className="text-base leading-none" aria-hidden="true">
                {opt.icon}
              </span>
              <span className="text-[11px] font-medium leading-tight">{opt.label}</span>
              <span className="text-[10px] leading-tight opacity-60">{opt.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
