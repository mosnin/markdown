"use client";

import { useState, useRef, useCallback, useTransition } from "react";
import { cn } from "@/lib/utils";
import { updateNoteRetrievalAction } from "@/app/app/notes/actions";

// ─── Read hint options ────────────────────────────────────────────────────────

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

// ─── Retrieval priority slider ────────────────────────────────────────────────

interface RetrievalPrioritySliderProps {
  noteId: string;
  initialPriority: number;
  className?: string;
}

/**
 * Interactive 0–10 range input for retrieval_priority.
 * Saves are debounced 500 ms so rapid drags don't spam the server.
 */
export function RetrievalPrioritySlider({
  noteId,
  initialPriority,
  className,
}: RetrievalPrioritySliderProps) {
  const [value, setValue] = useState(initialPriority);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (next: number) => {
      setValue(next);
      setSaveState("saving");

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        startTransition(async () => {
          const result = await updateNoteRetrievalAction(noteId, {
            retrievalPriority: next,
          });
          setSaveState(result.ok ? "saved" : "error");
          if (result.ok) {
            setTimeout(() => setSaveState("idle"), 1500);
          }
        });
      }, 500);
    },
    [noteId]
  );

  const trackPercent = (value / 10) * 100;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/70">Retrieval priority</span>
        <span
          className={cn(
            "text-xs font-medium tabular-nums transition-colors",
            value === 0
              ? "text-muted-foreground/50"
              : value >= 7
                ? "text-green-600 dark:text-green-400"
                : "text-foreground/70"
          )}
        >
          {value}
          <span className="text-muted-foreground/40">/10</span>
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        aria-label={`Retrieval priority: ${value} out of 10`}
        onChange={(e) => handleChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, hsl(var(--primary)) ${trackPercent}%, hsl(var(--muted)) ${trackPercent}%)`,
        }}
        className={cn(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        )}
      />

      <div className="flex justify-between text-[9px] text-muted-foreground/40">
        <span>Low</span>
        <span>High</span>
      </div>

      {saveState === "saving" && (
        <p className="text-[10px] text-muted-foreground/50" aria-live="polite">Saving…</p>
      )}
      {saveState === "saved" && (
        <p className="text-[10px] text-green-600 dark:text-green-400" aria-live="polite">Saved</p>
      )}
      {saveState === "error" && (
        <p className="text-[10px] text-destructive" aria-live="polite">Save failed</p>
      )}
    </div>
  );
}

// ─── Read hint selector ───────────────────────────────────────────────────────

interface ReadHintSelectorProps {
  noteId: string;
  initialReadHint: string | null;
  className?: string;
}

/**
 * 2×2 icon radio grid for selecting the read_hint value.
 * Clicking the active option clears it (sets to null).
 */
export function ReadHintSelector({
  noteId,
  initialReadHint,
  className,
}: ReadHintSelectorProps) {
  const [selected, setSelected] = useState<ReadHintValue | null>(
    (initialReadHint as ReadHintValue) ?? null
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [, startTransition] = useTransition();

  function handleSelect(value: ReadHintValue) {
    const next = selected === value ? null : value;
    setSelected(next);
    setSaveState("saving");

    startTransition(async () => {
      const result = await updateNoteRetrievalAction(noteId, {
        readHint: next,
      });
      setSaveState(result.ok ? "saved" : "error");
      if (result.ok) {
        setTimeout(() => setSaveState("idle"), 1500);
      }
    });
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid grid-cols-2 gap-1.5">
        {READ_HINT_OPTIONS.map((option) => {
          const isActive = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              aria-pressed={isActive}
              title={option.description}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "border-primary/60 bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground/70 hover:border-border/80 hover:bg-accent/40 hover:text-foreground"
              )}
            >
              <span className="text-base leading-none" aria-hidden="true">
                {option.icon}
              </span>
              <span className="text-[10px] font-medium leading-snug">{option.label}</span>
              <span className="text-[9px] leading-snug text-muted-foreground/50 line-clamp-1">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <p className="text-[10px] text-muted-foreground/60">
          Tap again to clear.
        </p>
      )}

      {saveState === "saving" && (
        <p className="text-[10px] text-muted-foreground/50" aria-live="polite">Saving…</p>
      )}
      {saveState === "saved" && (
        <p className="text-[10px] text-green-600 dark:text-green-400" aria-live="polite">Saved</p>
      )}
      {saveState === "error" && (
        <p className="text-[10px] text-destructive" aria-live="polite">Save failed</p>
      )}
    </div>
  );
}
