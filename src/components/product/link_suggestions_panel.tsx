"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  generateLinkSuggestionsAction,
  acceptLinkSuggestionAction,
  dismissLinkSuggestionAction,
  fetchPendingSuggestionsAction,
  type LinkSuggestionRow,
} from "@/app/app/notes/[note_id]/link_suggestion_actions";

// ─── Relationship label map ─────────────────────────────────────────────────

const REL_LABEL: Record<string, string> = {
  related: "Related to",
  depends_on: "Depends on",
  parent_of: "Parent of",
  child_of: "Child of",
  reference_for: "Reference for",
  extends: "Extends",
  example_of: "Example of",
  sibling_of: "Sibling of",
  supersedes: "Supersedes",
  derived_from: "Derived from",
};

// ─── Component ──────────────────────────────────────────────────────────────

interface LinkSuggestionsPanelProps {
  noteId: string;
  initialSuggestions?: LinkSuggestionRow[];
}

export function LinkSuggestionsPanel({
  noteId,
  initialSuggestions = [],
}: LinkSuggestionsPanelProps) {
  const router = useRouter();
  const [suggestions, setSuggestions] =
    useState<LinkSuggestionRow[]>(initialSuggestions);
  const [isGenerating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // ── Generate suggestions ───────────────────────────────────────────────

  function handleGenerate() {
    setError(null);
    startGenerate(async () => {
      const result = await generateLinkSuggestionsAction(noteId);
      if (result.success) {
        setSuggestions(result.data);
      } else {
        setError(result.error);
      }
    });
  }

  // ── Accept a suggestion ────────────────────────────────────────────────

  function handleAccept(suggestionId: string) {
    setError(null);
    setSuggestions((prev) =>
      prev.map((s) =>
        s.id === suggestionId ? { ...s, status: "accepting" } : s
      )
    );
    startGenerate(async () => {
      const result = await acceptLinkSuggestionAction(suggestionId);
      if (result.success) {
        setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
        router.refresh();
      } else {
        setError(result.error);
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === suggestionId ? { ...s, status: "pending" } : s
          )
        );
      }
    });
  }

  // ── Dismiss a suggestion ───────────────────────────────────────────────

  function handleDismiss(suggestionId: string) {
    setError(null);
    setSuggestions((prev) =>
      prev.map((s) =>
        s.id === suggestionId ? { ...s, status: "dismissing" } : s
      )
    );
    startGenerate(async () => {
      const result = await dismissLinkSuggestionAction(suggestionId);
      if (result.success) {
        setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
      } else {
        setError(result.error);
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === suggestionId ? { ...s, status: "pending" } : s
          )
        );
      }
    });
  }

  const pending = suggestions.filter(
    (s) =>
      s.status === "pending" ||
      s.status === "accepting" ||
      s.status === "dismissing"
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-fast"
        >
          <Sparkles className="h-3 w-3" />
          Suggested links
          {pending.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">
              {pending.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-fast",
            "bg-primary/10 text-primary hover:bg-primary/20",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              Generate
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Collapsed state */}
      {collapsed ? null : (
        <>
          {/* Empty state */}
          {pending.length === 0 && !isGenerating && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Click &quot;Generate&quot; to get AI-suggested links for this note
              based on its content.
            </p>
          )}

          {/* Loading state */}
          {isGenerating && pending.length === 0 && (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analyzing note content for connections...
            </div>
          )}

          {/* Suggestion cards */}
          {pending.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              onAccept={handleAccept}
              onDismiss={handleDismiss}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ─── Suggestion card ────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: LinkSuggestionRow;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const isActing =
    suggestion.status === "accepting" || suggestion.status === "dismissing";
  const confidencePct = Math.round(suggestion.confidence * 100);

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-sm",
        isActing && "opacity-50"
      )}
    >
      {/* Top row: relationship badge + confidence */}
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
          {REL_LABEL[suggestion.suggested_relationship] ??
            suggestion.suggested_relationship}
        </Badge>
        <span className="text-[10px] text-muted-foreground/60">
          {confidencePct}% confidence
        </span>
      </div>

      {/* Target note title */}
      <p className="text-xs font-medium text-foreground truncate">
        {suggestion.target_note_title ?? suggestion.target_note_id.slice(0, 8)}
      </p>

      {/* Reason */}
      {suggestion.reason && (
        <p className="text-[11px] italic text-muted-foreground/70 leading-relaxed">
          {suggestion.reason}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => onAccept(suggestion.id)}
          disabled={isActing}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-fast",
            "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20",
            "dark:text-emerald-400 dark:hover:bg-emerald-500/20",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <Check className="h-3 w-3" />
          Accept
        </button>
        <button
          type="button"
          onClick={() => onDismiss(suggestion.id)}
          disabled={isActing}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-fast",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <X className="h-3 w-3" />
          Dismiss
        </button>
      </div>
    </div>
  );
}
